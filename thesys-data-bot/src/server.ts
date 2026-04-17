// Telegram bot backed by the Claude Agent SDK. Single-user by default
// (allowlist). Rolling conversation in SQLite. Skills discovered from
// ~/.claude/skills/. Polling mode — no webhook / public URL required.
import { Telegraf } from "telegraf";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { ChatDB, Role } from "./db.js";
import { discoverSkills, skillsBlock } from "./skills.js";

const execFileP = promisify(execFile);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN env var required");

const ALLOWED_IDS = new Set(
  (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
);
if (ALLOWED_IDS.size === 0) {
  console.warn("⚠️  TELEGRAM_ALLOWED_USER_IDS empty — bot will reject every message.");
}

const MODEL = process.env.MODEL || "claude-haiku-4-5";
const DB_PATH = process.env.DB_PATH || "/data/chat.db";
const HISTORY_LIMIT = parseInt(process.env.HISTORY_LIMIT || "20", 10);
const MAX_TURNS = parseInt(process.env.MAX_TURNS || "15", 10);

// Self-contained skills: the container clones the claude-skills repo and
// periodically pulls it. No host bind-mount needed.
const SKILLS_REPO_URL = process.env.SKILLS_REPO_URL || "https://gitea.jacob.st/jacob-admin/claude-skills.git";
const SKILLS_REPO_DIR = process.env.SKILLS_REPO_DIR || "/root/.claude/claude-skills";
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
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `You are Jacob's daily helper bot, reached via Telegram on his phone. Keep replies tight — mobile screen, no walls of text, 1-3 short paragraphs max unless asked for detail.

# Skills — how to use them

You have access to Jacob's personal "skills" — each one is a reference manual for a specific part of his ecosystem (homelab auth, catalog, thesys, obsidian vault, pandoc, gitea, etc.). Their descriptions are visible to you; invoke the **Skill** tool by name to load the full content when you need it. Prefer invoking a skill over guessing. Specifically:

- If a task touches a jacob.st service, invoke \`homelab-jacob\` to bootstrap (env detection + auth + catalog lookup pattern).
- If the user asks about tasks/todos/projects/events/habits, invoke \`glossary-jacob\` first to confirm routing, then \`thesys-jacob\` for the API shape.
- If the user asks about the vault or writing notes, invoke \`obsidian-jacob\` (which also tells you to read \`Home.md\` first).
- Don't ask clarifying questions you could answer by invoking a skill. Load first, then act.

Tools available: **Bash, Read, Write, Grep, Glob, Skill**. Use them — don't describe what you would do, actually do it. Telegram shows "typing…" while you're working; the text you emit at the end of the loop is what the user sees.

# Domain routing — READ THIS FIRST for any question

Jacob's ecosystem has overlapping surfaces (both thesys AND obsidian have "notes"; both catalog AND beszel have "status"). **Never guess which service owns a topic — fetch the glossary.** See \`glossary-jacob\` below. At the start of every conversation (or before the first tool call on a new topic), fetch \`http://catalog:3000/api/glossary\` and use its \`routing\` map to pick the service to query. Respect the \`note\` field — it encodes the disambiguation rule.

Quick examples:
- "what open tasks" → routing.tasks.primary = thesys (NOT the Obsidian Process notes that have checkboxes)
- "what books" → routing.books.primary = grimmory
- "what articles" → routing.articles.primary = freshrss (disambiguate if "saved"/"clipped")
- "test note" / "write X" → obsidian, with folder chosen per Home.md (Scratch/ for tests)

# Behavior

- **Use skills proactively.** When Jacob mentions a service, container, secret, URL, or the vault, use the relevant skill (\`homelab-jacob\`, \`glossary-jacob\`, \`catalog-jacob\`, \`obsidian-jacob\`, \`host-ops-jacob\`, \`gitea-jacob\`, \`pandoc-jacob\`) BEFORE asking clarifying questions. Check first, ask second.
- If Jacob says "can you see X" or "is X running" — query the catalog. Don't ask him which X.
- If Jacob asks you to write to the vault — read \`Home.md\` at vault root first to pick the right folder, THEN write. Don't default to \`Homelab/Notes/\` for everything.
- Secrets: you never paste values into chat. Fetch them via isec or manual Infisical flow when needed for a tool call, but don't echo them back.
- When you used a tool or looked something up, briefly confirm what you found — don't pretend to know things you checked.
- If you genuinely don't know what to do, ask ONE focused clarifying question.

# Style

- Warm but not formal. Use normal capitalization — proper sentence case, not lowercase-start texting style. Think: smart friend who happens to be a techie, not a teen texting.
- Markdown formatting is fine (Telegram renders some).
- Prefer concrete over abstract. Numbers, URLs, container names, timestamps.
- Emoji sparingly — one at a time, only where it genuinely adds signal.
- If a tool call takes > few seconds, that's fine — Telegram shows "typing…" automatically.`;

// Load skills once at startup + log them
// Fetch/refresh the skills repo into the container's own filesystem, then
// log what we found. Bot stays up even if gitea is unreachable — it just
// starts with whatever was cached on disk (empty on first run).
{
  const status = await ensureSkillsRepo();
  const commit = await currentSkillsCommit();
  console.log(`skills repo: ${status} @ ${commit}`);
  const skills = discoverSkills();
  console.log(`${skills.length} skills available (SDK lazy-loads bodies on demand):`);
  for (const s of skills) console.log(`  - ${s.name} (${s.body.length} chars, loaded only when invoked)`);
  console.log(`system prompt (per-message): ${SYSTEM_PROMPT.length} chars — skills NOT injected, Skill tool loads on demand`);
}

// Background pull loop. Errors are logged and swallowed — a transient gitea
// outage shouldn't crash the bot. `discoverSkills()` re-reads on every message
// (see buildSystemPrompt), so a successful pull is visible on the next msg.
setInterval(async () => {
  const status = await ensureSkillsRepo();
  if (!status.startsWith("pull: Already up to date")) {
    const commit = await currentSkillsCommit();
    console.log(`skills ${status} @ ${commit}`);
  }
}, SKILLS_PULL_INTERVAL_MS);

// System prompt is just our persona + glossary + behavior rules. Skills are
// NOT injected here — the Agent SDK auto-discovers them from ~/.claude/skills
// and lazy-loads bodies on demand via the Skill tool. This keeps the prompt
// lean (~1-2k tokens vs 18k when we were eagerly injecting every skill body).
function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

const db = new ChatDB(DB_PATH);
const bot = new Telegraf(BOT_TOKEN);

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
  ctx.reply(`Hi. I'm Jacob's daily helper — ask me about the homelab, what's on today, or tell me to write to the vault. Use /reset to wipe this conversation, /help for commands, /skills to see what I know.`);
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
  ctx.reply(`model: ${MODEL}\nhistory window: ${HISTORY_LIMIT} turns`);
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
        allowedTools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"],
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
            // Pure-text assistant message — this is the final answer (or part of it)
            finalText += textBlocks;
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
      }
    }

    clearInterval(typingInterval);
    finalText = finalText.trim() || "(no response — likely hit max_turns or stopped mid-tool)";
    db.saveTurn(chatId, "assistant", finalText);
    // Stamp final_text on the query row so `queries` + `tool_calls` form a
    // self-contained trace even if the `turns` table later gets trimmed.
    db.finishQueryFinalText(queryId, finalText);
    db.trim(chatId);

    // Final edit: try Markdown parse_mode first; if it fails (unbalanced *, stray [, etc.)
    // fall back to plain text so the user still sees the answer.
    const firstChunk = finalText.slice(0, 4000);
    const tryEdit = async (mode?: "Markdown") => {
      await ctx.telegram.editMessageText(chatId, msgId, undefined, firstChunk, mode ? { parse_mode: mode } : {});
    };
    try {
      await tryEdit("Markdown");
    } catch {
      try { await tryEdit(); } catch { await ctx.reply(firstChunk); }
    }
    for (let i = 4000; i < finalText.length; i += 4000) {
      const part = finalText.slice(i, i + 4000);
      try {
        await ctx.reply(part, { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(part);
      }
    }
  } catch (e: any) {
    clearInterval(typingInterval);
    console.error(`[${chatId}] agent error:`, e);
    const errText = `⚠️ error: ${e.message ?? String(e)}`;
    await ctx.telegram.editMessageText(chatId, msgId, undefined, errText).catch(() => {
      ctx.reply(errText);
    });
  }
});

bot.launch();
console.log("thesys-data-bot: polling started");

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
