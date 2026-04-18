// Generic Telegram bot backed by the Claude Agent SDK. Which bot this
// process becomes is decided by BOT_NAME — the matching YAML config in
// the cloned claude-bots repo supplies the persona, model, allowlist,
// and Telegram-token-secret name. Rolling conversation in SQLite.
// Skills discovered from ~/.claude/skills/ via the SDK. Polling mode
// — no webhook / public URL required.
import { Telegraf } from "telegraf";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { ChatDB, Role } from "./db.js";
import { discoverSkills, skillsBlock } from "./skills.js";
import { loadBotConfig, BotConfig } from "./config.js";
import { fetchSecret } from "./infisical.js";

const execFileP = promisify(execFile);

// Active-query tracker so we can tell the user when their turn dies from
// an uncaught Agent SDK timeout (p-timeout throws from setTimeout callbacks,
// bypassing try/catch). Keyed by chat_id → Telegram message_id of the
// placeholder we posted at the start of the run.
const activeQueries = new Map<number, { msgId: number; startedAt: number; queryId: number }>();

async function notifyAndClear(reason: string) {
  if (activeQueries.size === 0) return;
  const entries = Array.from(activeQueries.entries());
  activeQueries.clear();
  for (const [chatId, info] of entries) {
    const sec = Math.round((Date.now() - info.startedAt) / 1000);
    const text = `⚠️ turn died after ${sec}s — ${reason}. No reply was produced.`;
    try {
      await botInstance.telegram.editMessageText(chatId, info.msgId, undefined, text);
    } catch {
      try { await botInstance.telegram.sendMessage(chatId, text); } catch { /* give up */ }
    }
  }
}

// Declared up here so the exception handlers can reach it; bound below.
let botInstance: Telegraf;

// Uncaught-exception safety net: catch p-timeout, tell the affected chat(s),
// keep the process alive.
process.on("uncaughtException", (e) => {
  console.error("[uncaughtException]", e);
  const reason = /timed out/i.test(String(e?.message ?? e))
    ? "Agent SDK 90-second timeout (prompt too big or LLM too slow on this turn)"
    : `uncaught error: ${e?.message ?? e}`;
  notifyAndClear(reason).catch(() => {});
});
process.on("unhandledRejection", (e: any) => {
  console.error("[unhandledRejection]", e);
  notifyAndClear(`unhandled rejection: ${e?.message ?? e}`).catch(() => {});
});

const BOT_NAME = process.env.BOT_NAME;
if (!BOT_NAME) throw new Error("BOT_NAME env var required — set it to the YAML filename (without .yml) in claude-bots/");

const DB_PATH = process.env.DB_PATH || "/data/chat.db";

// Self-contained skills + bot configs: the container clones both repos on
// startup and periodically pulls. No host bind-mounts needed.
const SKILLS_REPO_URL = process.env.SKILLS_REPO_URL || "https://gitea.jacob.st/jacob-admin/claude-skills.git";
const SKILLS_REPO_DIR = process.env.SKILLS_REPO_DIR || "/root/.claude/claude-skills";
const BOTS_REPO_URL = process.env.BOTS_REPO_URL || "https://gitea.jacob.st/jacob-admin/claude-bots.git";
const BOTS_REPO_DIR = process.env.BOTS_REPO_DIR || "/root/.claude/claude-bots";
const BOTS_REPO_OPTIONAL = process.env.BOTS_REPO_OPTIONAL !== "false"; // soft-fail if bots repo missing; configs may live in skills/bots/
const SKILLS_PULL_INTERVAL_MS = parseInt(process.env.SKILLS_PULL_INTERVAL_MS || "300000", 10); // 5 min
// Export so `discoverSkills()` reads from the clone's `skills/` subdir.
process.env.SKILLS_DIR = path.join(SKILLS_REPO_DIR, "skills");

async function git(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileP("git", args, { timeout: 30_000 });
}

async function ensureSkillsRepo(): Promise<string> {
  const dotGit = path.join(SKILLS_REPO_DIR, ".git");
  let result: string;
  if (fs.existsSync(dotGit)) {
    try {
      const { stdout } = await git("-C", SKILLS_REPO_DIR, "pull", "--ff-only");
      result = `pull: ${stdout.trim().split("\n").slice(-1)[0] || "ok"}`;
    } catch (e: any) {
      return `pull failed: ${e.message ?? e}`;
    }
  } else {
    fs.mkdirSync(path.dirname(SKILLS_REPO_DIR), { recursive: true });
    try {
      await git("clone", "--depth", "1", SKILLS_REPO_URL, SKILLS_REPO_DIR);
      result = "cloned";
    } catch (e: any) {
      return `clone failed: ${e.message ?? e}`;
    }
  }
  // The Agent SDK's lazy skill loader looks at ~/.claude/skills/<name>/SKILL.md.
  // Our repo puts them at <SKILLS_REPO_DIR>/skills/, so we symlink for the SDK.
  const sdkSkillsPath = path.join(process.env.HOME || "/root", ".claude/skills");
  const target = path.join(SKILLS_REPO_DIR, "skills");
  try {
    if (fs.existsSync(sdkSkillsPath) || fs.lstatSync(sdkSkillsPath)) fs.unlinkSync(sdkSkillsPath);
  } catch { /* doesn't exist, fine */ }
  try {
    fs.symlinkSync(target, sdkSkillsPath, "dir");
  } catch (e: any) {
    // Already symlinked or other non-fatal condition — ignore
  }
  return result;
}

async function currentSkillsCommit(): Promise<string> {
  try {
    const { stdout } = await git("-C", SKILLS_REPO_DIR, "rev-parse", "--short", "HEAD");
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

// Injects a gitea PAT into the clone URL for private repos. Accepts either
// BOTS_REPO_TOKEN (literal) or BOTS_REPO_TOKEN_SECRET (Infisical key name).
// Public repos leave the URL untouched.
async function authedBotsUrl(): Promise<string> {
  const url = BOTS_REPO_URL;
  let token = process.env.BOTS_REPO_TOKEN;
  if (!token && process.env.BOTS_REPO_TOKEN_SECRET) {
    try {
      token = await fetchSecret(process.env.BOTS_REPO_TOKEN_SECRET);
    } catch (e: any) {
      console.error(`[bots-auth] infisical fetch failed: ${e.message ?? e}`);
    }
  }
  if (!token) return url;
  // Inject token into URL: https://<token>@host/path
  return url.replace(/^https?:\/\//, (scheme) => `${scheme}${encodeURIComponent(token!)}@`);
}

// Claude-bots repo clone/pull — same shape as skills, but tolerates the
// repo not existing yet AND supports auth for private repos.
async function ensureBotsRepo(): Promise<string> {
  const dotGit = path.join(BOTS_REPO_DIR, ".git");
  if (fs.existsSync(dotGit)) {
    // If the remote URL on disk has stale/missing auth, rewrite it before pull.
    const fresh = await authedBotsUrl();
    try {
      await git("-C", BOTS_REPO_DIR, "remote", "set-url", "origin", fresh);
    } catch { /* non-fatal */ }
    try {
      const { stdout } = await git("-C", BOTS_REPO_DIR, "pull", "--ff-only");
      return `pull: ${stdout.trim().split("\n").slice(-1)[0] || "ok"}`;
    } catch (e: any) {
      return `pull failed: ${e.message ?? e}`;
    }
  }
  fs.mkdirSync(path.dirname(BOTS_REPO_DIR), { recursive: true });
  try {
    const cloneUrl = await authedBotsUrl();
    await git("clone", "--depth", "1", cloneUrl, BOTS_REPO_DIR);
    return "cloned";
  } catch (e: any) {
    const msg = `clone failed: ${e.message ?? e}`;
    if (BOTS_REPO_OPTIONAL) return `${msg} (optional, continuing)`;
    throw new Error(msg);
  }
}
// ── Startup: clone repos, load bot config, resolve Telegram token ─────────

// 1. Clone/pull skills and bots repos first (configs come from the cloned bots repo).
{
  const skillsStatus = await ensureSkillsRepo();
  const skillsCommit = await currentSkillsCommit();
  console.log(`skills repo: ${skillsStatus} @ ${skillsCommit}`);
  const botsStatus = await ensureBotsRepo();
  console.log(`bots repo: ${botsStatus}`);
}

// 2. Load the per-bot YAML config (BOT_NAME picks which file).
const config: BotConfig = loadBotConfig(BOT_NAME);
console.log(`loaded bot config: ${config.name} — model=${config.model}, max_turns=${config.max_turns}, allowlist=${config.allowed_user_ids.length} user(s)`);

// 3. Resolve the Telegram token. Priority:
//    (a) explicit TELEGRAM_BOT_TOKEN env var (override / back-compat)
//    (b) Infisical fetch using config.telegram_token_secret
//    (c) literal config.telegram_token (for bootstrap / testing only)
const BOT_TOKEN = await (async (): Promise<string> => {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) {
    console.log("Telegram token: from TELEGRAM_BOT_TOKEN env var");
    return envToken;
  }
  if (config.telegram_token_secret) {
    console.log(`Telegram token: fetching Infisical key '${config.telegram_token_secret}'`);
    return await fetchSecret(config.telegram_token_secret);
  }
  if (config.telegram_token) {
    console.log("Telegram token: from config.telegram_token (literal)");
    return config.telegram_token;
  }
  throw new Error(
    `bot '${config.name}' has no Telegram token source. Set one of: ` +
      `TELEGRAM_BOT_TOKEN env, config.telegram_token_secret (Infisical key), or config.telegram_token (literal).`,
  );
})();

const ALLOWED_IDS = new Set(config.allowed_user_ids);
const MODEL = config.model;
const HISTORY_LIMIT = config.history_limit;
const MAX_TURNS = config.max_turns;
const SYSTEM_PROMPT = config.system_prompt;

// 4. Startup diagnostic: list discovered skills (not injected; SDK lazy-loads).
{
  const skills = discoverSkills();
  console.log(`${skills.length} skills available (SDK lazy-loads bodies on demand):`);
  for (const s of skills) console.log(`  - ${s.name} (${s.body.length} chars)`);
  console.log(`system prompt (per-message): ${SYSTEM_PROMPT.length} chars`);
}

// Background pull loop — refresh BOTH repos. Errors are logged and swallowed.
// Skill + bot-config changes land on the next message (per-msg config re-read
// is not yet wired; bot-config changes require restart for now).
setInterval(async () => {
  const skillsStatus = await ensureSkillsRepo();
  if (!skillsStatus.startsWith("pull: Already up to date")) {
    const commit = await currentSkillsCommit();
    console.log(`skills ${skillsStatus} @ ${commit}`);
  }
  const botsStatus = await ensureBotsRepo();
  if (!botsStatus.startsWith("pull: Already up to date") && !botsStatus.startsWith("clone failed")) {
    console.log(`bots ${botsStatus}`);
  }
}, SKILLS_PULL_INTERVAL_MS);

// System prompt is just our persona + glossary + behavior rules. Skills are
// NOT injected here — the Agent SDK auto-discovers them from ~/.claude/skills
// and lazy-loads bodies on demand via the Skill tool. This keeps the prompt
// lean (~1-2k tokens vs 18k when we were eagerly injecting every skill body).
function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

// ── Custom-URL-scheme link extraction (obsidian://, etc.) ──
//
// Telegram's Markdown/MarkdownV2 parsers only render [text](url) as a tappable
// link for http/https/tg URL schemes. Any other scheme (obsidian://, ton://,
// etc.) renders as plain text — the URL is stripped entirely. Workaround:
// detect these links in the agent's output, remove them from the message body,
// and attach them as inline-keyboard buttons (which DO support any scheme).

const CUSTOM_SCHEMES = ["obsidian", "tg", "ton"]; // URL schemes Telegram Markdown won't render as links
const CUSTOM_LINK_RE = new RegExp(
  `\\[([^\\]]+)\\]\\((${CUSTOM_SCHEMES.join("|")})://([^)]+)\\)`,
  "g",
);

interface Btn { text: string; url: string; }

function extractCustomSchemeLinks(text: string): { cleaned: string; buttons: Btn[] } {
  const buttons: Btn[] = [];
  const cleaned = text.replace(CUSTOM_LINK_RE, (_m, label: string, scheme: string, rest: string) => {
    const url = `${scheme}://${rest}`;
    // Label the button with an app emoji + the original link text.
    const emoji = scheme === "obsidian" ? "📓 " : scheme === "tg" ? "💬 " : "🔗 ";
    buttons.push({ text: `${emoji}${label}`, url });
    // Keep the label inline as plain text so the message still reads naturally.
    return label;
  });
  return { cleaned, buttons };
}

// Telegram inline keyboards allow multiple rows; 1-2 buttons per row looks best.
function chunkButtons(btns: Btn[]): Btn[][] {
  const rows: Btn[][] = [];
  for (let i = 0; i < btns.length; i += 2) {
    rows.push(btns.slice(i, i + 2));
  }
  return rows;
}

const db = new ChatDB(DB_PATH);
const bot = new Telegraf(BOT_TOKEN);
botInstance = bot;

// Allowlist middleware — silently drop any stranger.
bot.use(async (ctx, next) => {
  const id = ctx.from?.id;
  if (!id || !ALLOWED_IDS.has(id)) {
    console.log(`drop: user ${id} not in allowlist`);
    return;
  }
  await next();
});

bot.command("start", (ctx) => {
  ctx.reply(`Hi. I'm ${config.name} — ${config.description || "your assistant"}.\nUse /help for commands, /skills to see what I know, /reset to wipe history.`);
});

bot.command("help", (ctx) => {
  ctx.reply(
    [
      "Commands:",
      "/reset — clear this chat's history",
      "/skills — list loaded skills",
      "/model — show which model I'm using",
      "",
      "Anything else: just ask.",
    ].join("\n"),
  );
});

bot.command("reset", (ctx) => {
  const n = db.clear(ctx.chat.id);
  ctx.reply(`wiped ${n} turns.`);
});

bot.command("skills", (ctx) => {
  const skills = discoverSkills();
  const lines = skills.length === 0
    ? ["(no skills loaded)"]
    : skills.map((s) => `• ${s.name} — ${s.description.split("\n")[0].slice(0, 140)}`);
  ctx.reply(lines.join("\n"));
});

bot.command("model", (ctx) => {
  ctx.reply(`bot: ${config.name}\nmodel: ${MODEL}\nhistory window: ${HISTORY_LIMIT} turns\nmax turns: ${MAX_TURNS}`);
});

bot.command("refresh", async (ctx) => {
  await ctx.reply("pulling skills…");
  const before = await currentSkillsCommit();
  const status = await ensureSkillsRepo();
  const after = await currentSkillsCommit();
  const skills = discoverSkills();
  const changed = before !== after;
  await ctx.reply(
    [
      `skills repo: ${status}`,
      `commit: ${before} → ${after}${changed ? " ✅ new commits" : " (no change)"}`,
      `loaded ${skills.length} skills: ${skills.map((s) => s.name).join(", ")}`,
    ].join("\n"),
  );
});

// Any non-command text → agent turn.
bot.on("message", async (ctx) => {
  const msg = (ctx.message as any).text;
  if (!msg || typeof msg !== "string") return;           // skip non-text (photos etc.) for v1
  if (msg.startsWith("/")) return;                        // let command handlers deal with slash cmds

  const chatId = ctx.chat.id;
  const t0 = Date.now();
  console.log(`[${chatId}] msg in: ${msg.slice(0, 80)}`);
  await ctx.sendChatAction("typing");
  const typingInterval = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4500);

  // Send an italic placeholder that'll be edited as work progresses, then
  // replaced with the final answer at the end. Markdown parse mode so _italic_
  // and *bold* render; fall back to plain text if the final message has
  // unparseable entities.
  const placeholder = await ctx.reply("_thinking…_", { parse_mode: "Markdown" });
  const msgId = placeholder.message_id;

  db.saveTurn(chatId, "user", msg);
  const queryId = db.startQuery(chatId, msg);
  // Track so uncaughtException can tell the user this turn died, not just silence it.
  activeQueries.set(chatId, { msgId, startedAt: t0, queryId });
  const toolInputById = new Map<string, { tool: string; input: any; idx: number }>();
  let toolIdx = 0;
  const history = db.getRecentTurns(chatId, HISTORY_LIMIT);
  const conversationPrompt = history
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n\n");

  // Telegram edits are rate-limited (~1/sec per message). Throttle to 1.2s and
  // drop intermediate updates — only ever show the latest state.
  let lastEditAt = 0;
  let lastShown = "";
  let editInFlight = false;
  const edit = (text: string, mode: "Markdown" | undefined = "Markdown") => {
    const now = Date.now();
    if (editInFlight || text === lastShown || now - lastEditAt < 1200) return;
    editInFlight = true;
    lastEditAt = now;
    lastShown = text;
    const display = text.length > 4000 ? text.slice(-4000) : text;
    ctx.telegram
      .editMessageText(chatId, msgId, undefined, display || "_thinking…_", { parse_mode: mode })
      .catch(() => {
        // retry once without parse_mode in case Markdown couldn't parse
        ctx.telegram.editMessageText(chatId, msgId, undefined, display || "thinking…").catch(() => {});
      })
      .finally(() => { editInFlight = false; });
  };

  try {
    // Phase model: during the tool-calling loop, the user sees an italic
    // status line — "thinking… running bash (checking catalog)". Intermediate
    // assistant text ("Let me check X...") is NOT shown, only logged. When
    // the agent finishes, we replace the status placeholder with the final
    // answer in one edit — rendered as Markdown.
    let finalText = "";        // accumulated text from pure-text assistant messages
    let currentMsgText = "";   // text buffer for the in-flight assistant message
    let currentHasTool = false; // does the in-flight message contain a tool_use?
    let status = "thinking…";   // what the user sees inside the italic placeholder
    let toolCalls = 0;

    const render = () => edit(`_${status}_`);

    const stream = query({
      prompt: conversationPrompt,
      options: {
        model: MODEL,
        systemPrompt: buildSystemPrompt(),
        maxTurns: MAX_TURNS,
        includePartialMessages: true,
        // settingSources: ["user"] enables the SDK's lazy skill loader, which
        // injects only SKILL.md frontmatter descriptions into the system prompt
        // and loads the full body on demand when the agent invokes the Skill tool.
        settingSources: ["user"],
        allowedTools: config.allowed_tools,
        // MCP servers — typed tool endpoints the bot can call instead of
        // Bash+curl. Each server advertises its own tools; SDK adds them to
        // the available tool list automatically (names prefixed mcp__<server>__<tool>).
        mcpServers: config.mcp_servers as any,
      },
    });

    for await (const chunk of stream) {
      const chunkType = (chunk as any).type;

      if (chunkType === "stream_event") {
        const event = (chunk as any).event;
        if (event?.type === "message_start") {
          // New assistant message — reset per-message buffer
          currentMsgText = "";
          currentHasTool = false;
        } else if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
          currentHasTool = true;
          toolCalls++;
          const name = event.content_block.name;
          status = name === "Bash" ? `🔧 running bash (call #${toolCalls})…` : `🔧 ${name} (call #${toolCalls})…`;
          render();
        } else if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
          currentMsgText += event.delta.text;
        }
        continue;
      }

      if (chunkType === "assistant") {
        const content = (chunk as any).message?.content;
        if (Array.isArray(content)) {
          const hasTool = content.some((c: any) => c.type === "tool_use");
          const textBlocks = content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
          if (hasTool) {
            // Preamble text that accompanied a tool call — log, don't show.
            for (const c of content) {
              if (c.type === "tool_use") {
                toolIdx++;
                toolInputById.set(c.id, { tool: c.name, input: c.input, idx: toolIdx });
                const cmd = c.name === "Bash"
                  ? ` ${String(c.input?.command ?? "").replace(/\s+/g, " ").slice(0, 140)}`
                  : "";
                console.log(`[${chatId}] tool_use #${toolIdx}: ${c.name}${cmd}`);
              }
            }
          } else {
            // Pure-text assistant message. Claude often emits preamble text
            // ("Now let me do X") as its own no-tool_use message followed by
            // a separate tool_use message, so we CANNOT safely accumulate —
            // we'd concatenate preamble from N turns into one blob. Overwrite
            // instead: the LAST pure-text message before `result` wins. In a
            // normal flow that's the actual final answer; in an error flow
            // (max_turns etc.) the result handler below replaces it anyway.
            if (textBlocks) finalText = textBlocks;
          }
        }
        currentMsgText = "";
        currentHasTool = false;
      } else if (chunkType === "user") {
        // Tool result returned — persist to DB paired with its tool_use
        const content = (chunk as any).message?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === "tool_result") {
              const matched = toolInputById.get(c.tool_use_id);
              if (matched) {
                const inputStr = JSON.stringify(matched.input).slice(0, 2000);
                const resultText = typeof c.content === "string"
                  ? c.content
                  : Array.isArray(c.content)
                    ? c.content.map((b: any) => b.text ?? JSON.stringify(b)).join("\n")
                    : JSON.stringify(c.content ?? "");
                const preview = String(resultText).slice(0, 2000);
                db.saveToolCall(queryId, chatId, matched.idx, matched.tool, inputStr, preview, !!c.is_error);
              }
            }
          }
        }
        status = "got result, thinking…";
        render();
      } else if (chunkType === "result") {
        const r = chunk as any;
        const u = r.usage ?? {};
        const durationMs = Date.now() - t0;
        console.log(
          `[${chatId}] result: turns=${r.num_turns ?? "?"} stop=${r.subtype ?? "?"} ` +
          `cost=$${(r.total_cost_usd ?? 0).toFixed(4)} ms=${durationMs} ` +
          `in=${u.input_tokens ?? "?"} out=${u.output_tokens ?? "?"} ` +
          `cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0}`,
        );
        db.finishQuery(queryId, {
          num_turns: r.num_turns,
          stop_reason: r.subtype,
          cost_usd: r.total_cost_usd,
          duration_ms: durationMs,
          tokens_in: u.input_tokens,
          tokens_out: u.output_tokens,
          cache_read: u.cache_read_input_tokens,
          cache_create: u.cache_creation_input_tokens,
        });
        // On non-success stop reasons (max_turns, error_*), overwrite finalText
        // with a clear banner. Don't leak whatever partial text was sitting in
        // the buffer — it's almost never the user-facing answer.
        if (r.subtype && r.subtype !== "success" && r.subtype !== "end_turn") {
          const reason = r.subtype === "error_max_turns"
            ? `hit max_turns (${r.num_turns ?? "?"}) without reaching a final answer`
            : `stopped: ${r.subtype}`;
          finalText = `⚠️ ${reason}. Ran ${toolIdx} tool call(s) over ${Math.round(durationMs / 1000)}s; no final reply produced. Try a simpler query or split it in two.`;
        }
      }
    }

    clearInterval(typingInterval);
    // Normal completion — clear from the active-query tracker so a later
    // uncaughtException doesn't falsely attribute an error to this chat.
    activeQueries.delete(chatId);
    finalText = finalText.trim() || "(no response — likely hit max_turns or stopped mid-tool)";
    db.saveTurn(chatId, "assistant", finalText);
    // Stamp final_text on the query row so `queries` + `tool_calls` form a
    // self-contained trace even if the `turns` table later gets trimmed.
    db.finishQueryFinalText(queryId, finalText);
    db.trim(chatId);

    // Telegram's Markdown parser rejects custom URL schemes (obsidian://,
    // tg://, etc.) inside [text](url) links — strips them from the rendered
    // text. Workaround: extract them and attach as inline-keyboard buttons,
    // which DO support any URL scheme. Keep the label inline where the link
    // was, so the body still reads naturally.
    const { cleaned: cleanedText, buttons } = extractCustomSchemeLinks(finalText);
    const firstChunk = cleanedText.slice(0, 4000);
    const reply_markup = buttons.length > 0
      ? { inline_keyboard: chunkButtons(buttons) }
      : undefined;

    const tryEdit = async (mode?: "Markdown") => {
      await ctx.telegram.editMessageText(chatId, msgId, undefined, firstChunk, {
        ...(mode ? { parse_mode: mode } : {}),
        ...(reply_markup ? { reply_markup } : {}),
      });
    };
    try {
      await tryEdit("Markdown");
    } catch {
      try { await tryEdit(); } catch { await ctx.reply(firstChunk, reply_markup ? { reply_markup } : {}); }
    }
    for (let i = 4000; i < cleanedText.length; i += 4000) {
      const part = cleanedText.slice(i, i + 4000);
      try {
        await ctx.reply(part, { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(part);
      }
    }
  } catch (e: any) {
    clearInterval(typingInterval);
    activeQueries.delete(chatId);
    console.error(`[${chatId}] agent error:`, e);
    const errText = `⚠️ error: ${e.message ?? String(e)}`;
    await ctx.telegram.editMessageText(chatId, msgId, undefined, errText).catch(() => {
      ctx.reply(errText);
    });
  }
});

bot.launch();
console.log(`${config.name}: polling started`);

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
