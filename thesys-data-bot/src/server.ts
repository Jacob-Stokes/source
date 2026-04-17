// Telegram bot backed by the Claude Agent SDK. Single-user by default
// (allowlist). Rolling conversation in SQLite. Skills discovered from
// ~/.claude/skills/. Polling mode — no webhook / public URL required.
import { Telegraf } from "telegraf";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ChatDB, Role } from "./db.js";
import { discoverSkills, skillsBlock } from "./skills.js";

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
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `You are Jacob's daily helper bot, reached via Telegram on his phone. Keep replies tight — mobile screen, no walls of text, 1-3 short paragraphs max unless asked for detail.

# Glossary (words Jacob uses for his homelab)

- "thesys" = Jacob's personal everything-app, running at thesys.jacob.st. Not a typo for "thesis".
- "grimmory" = his self-hosted ebook library at books.jacob.st.
- "catalog" = the service inventory at catalog.jacob.st — query it FIRST to find anything.
- "vault" or "obsidian" = his Obsidian vault at obsidian.jacob.st.
- "homelab" = the whole jacob.st fleet: resolution + adventure hosts, ~34 services.
- "resolution" / "adventure" = his two hosts. Resolution is the primary, adventure is the DigitalOcean droplet.
- "infisical" = where all secrets live (secrets.jacob.st).
- "windmill" = where automation scripts run.
- "coder" = where AI Tasks spin up dev containers.
- "pandoc" = the document-conversion API at pandoc.jacob.st.

# Behavior

- **Use skills proactively.** When Jacob mentions a service, container, secret, URL, or the vault, use the relevant skill (homelab-jacob, catalog-jacob, obsidian-jacob, host-ops-jacob, gitea-jacob, pandoc-jacob) BEFORE asking clarifying questions. Check first, ask second.
- If Jacob says "can you see X" or "is X running" — query the catalog. Don't ask him which X.
- If Jacob asks you to write to the vault — write it. Follow obsidian-jacob conventions (wikilinks, no edits to Services/ frontmatter, PascalCase folders / kebab-case files).
- Secrets: you never paste values into chat. Fetch them via isec or manual Infisical flow when needed for a tool call, but don't echo them back.
- When you used a tool or looked something up, briefly confirm what you found — don't pretend to know things you checked.
- If you genuinely don't know what to do, ask ONE focused clarifying question.

# Style

- Lowercase-start ok, casual tone, markdown formatting is fine (Telegram renders some).
- Prefer concrete over abstract. Numbers, URLs, container names, timestamps.
- If a tool call takes > few seconds, that's fine — Telegram shows "typing…" automatically.`;

// Load skills once at startup + log them
const skills = discoverSkills();
console.log(`loaded ${skills.length} skills:`);
for (const s of skills) console.log(`  - ${s.name} (${s.body.length} chars)`);

// Full system prompt = persona + glossary/behavior + every skill's full body.
// We inject skill bodies explicitly rather than relying on the Agent SDK's
// auto-loading, which may or may not find them depending on version.
const FULL_SYSTEM = [SYSTEM_PROMPT, skillsBlock(skills)].filter(Boolean).join("\n\n");
console.log(`system prompt: ${FULL_SYSTEM.length} chars`);

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
  const lines = skills.length === 0
    ? ["(no skills loaded)"]
    : skills.map((s) => `• ${s.name} — ${s.description.split("\n")[0].slice(0, 140)}`);
  ctx.reply(lines.join("\n"));
});

bot.command("model", (ctx) => {
  ctx.reply(`model: ${MODEL}\nhistory window: ${HISTORY_LIMIT} turns`);
});

// Any non-command text → agent turn.
bot.on("message", async (ctx) => {
  const msg = (ctx.message as any).text;
  if (!msg || typeof msg !== "string") return;           // skip non-text (photos etc.) for v1
  if (msg.startsWith("/")) return;                        // let command handlers deal with slash cmds

  const chatId = ctx.chat.id;
  await ctx.sendChatAction("typing");

  // Build the conversation: past turns + this new user message.
  db.saveTurn(chatId, "user", msg);
  const history = db.getRecentTurns(chatId, HISTORY_LIMIT);
  const conversationPrompt = history
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n\n");

  try {
    let response = "";
    const stream = query({
      prompt: conversationPrompt,
      options: {
        model: MODEL,
        systemPrompt: FULL_SYSTEM,
        maxTurns: 5,
        // Enable the built-in tool set that skills expect (Bash for curl, Read/Write
        // for file ops). Skills loaded from ~/.claude/skills are auto-discovered
        // by the SDK.
        allowedTools: ["Bash", "Read", "Write", "Grep", "Glob"],
      },
    });

    for await (const chunk of stream) {
      // Only stream final text — ignore intermediate tool_use/tool_result blocks.
      if ((chunk as any).type === "assistant") {
        const content = (chunk as any).message?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === "text") response += c.text;
          }
        } else if (typeof content === "string") {
          response += content;
        }
      }
    }

    response = response.trim() || "(empty response)";
    db.saveTurn(chatId, "assistant", response);
    db.trim(chatId);

    // Telegram message limit is 4096 chars; chunk if needed.
    for (let i = 0; i < response.length; i += 4000) {
      await ctx.reply(response.slice(i, i + 4000));
    }
  } catch (e: any) {
    console.error("agent error:", e);
    await ctx.reply(`⚠️ error: ${e.message ?? String(e)}`);
  }
});

bot.launch();
console.log("thesys-data-bot: polling started");

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
