// Loads the per-bot config YAML from the cloned claude-bots directory. The
// image is generic; which bot it becomes is decided by the BOT_NAME env var
// + the matching `<bots_dir>/<BOT_NAME>.yml` file.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface McpServerConfig {
  type: "sse" | "http" | "stdio";
  url?: string;                    // for sse/http
  command?: string;                // for stdio
  args?: string[];                 // for stdio
  headers?: Record<string, string>; // for sse/http — values may reference ${ENV_VAR}
}

export interface BotConfig {
  name: string;
  description?: string;
  telegram_token_secret?: string;   // Infisical key name to fetch the token
  telegram_token?: string;          // literal token (fallback; prefer secret)
  allowed_user_ids: number[];
  model: string;
  max_turns: number;
  history_limit: number;
  allowed_tools: string[];
  system_prompt: string;
  mcp_servers?: Record<string, McpServerConfig>;
}

const DEFAULTS: Omit<BotConfig, "name" | "system_prompt" | "allowed_user_ids"> = {
  description: "",
  telegram_token_secret: undefined,
  telegram_token: undefined,
  model: "claude-sonnet-4-6",
  max_turns: 15,
  history_limit: 20,
  allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"],
};

// The bot configs repo is cloned alongside skills. We look in a few likely
// locations so the image works whether configs live in their own repo or
// alongside skills in the claude-skills repo.
function candidateConfigDirs(): string[] {
  const override = process.env.BOTS_CONFIG_DIR;
  if (override) return [override];
  return [
    "/root/.claude/claude-bots/bots",           // future dedicated repo
    "/root/.claude/claude-skills/bots",          // subfolder of skills repo (current)
  ];
}

export function loadBotConfig(name: string): BotConfig {
  const errors: string[] = [];
  for (const dir of candidateConfigDirs()) {
    const file = path.join(dir, `${name}.yml`);
    if (!fs.existsSync(file)) {
      errors.push(`not found: ${file}`);
      continue;
    }
    try {
      const raw = YAML.parse(fs.readFileSync(file, "utf-8")) || {};
      return validate({ ...DEFAULTS, ...raw, name });
    } catch (e: any) {
      throw new Error(`bot config parse failed at ${file}: ${e.message ?? e}`);
    }
  }
  throw new Error(
    `bot config '${name}' not found. Tried:\n  ${errors.join("\n  ")}\n` +
      `Set BOTS_CONFIG_DIR or place the YAML at one of the above paths.`,
  );
}

function validate(cfg: any): BotConfig {
  const required = ["name", "system_prompt", "allowed_user_ids"];
  for (const k of required) {
    if (cfg[k] === undefined || cfg[k] === null) {
      throw new Error(`bot config '${cfg.name ?? "?"}' missing required field: ${k}`);
    }
  }
  if (!Array.isArray(cfg.allowed_user_ids) || cfg.allowed_user_ids.length === 0) {
    throw new Error(`bot config '${cfg.name}': allowed_user_ids must be a non-empty array`);
  }
  if (cfg.mcp_servers) cfg.mcp_servers = interpolateMcpServers(cfg.mcp_servers);
  return cfg as BotConfig;
}

// Expand ${ENV_VAR} patterns in MCP headers so configs can reference secrets
// without embedding them in the public claude-bots repo.
function interpolateMcpServers(
  servers: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    const copy: McpServerConfig = { ...cfg };
    if (cfg.headers) {
      copy.headers = {};
      for (const [k, v] of Object.entries(cfg.headers)) {
        copy.headers[k] = v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, varName) => {
          const val = process.env[varName];
          if (!val) {
            console.warn(`[mcp] '${name}.headers.${k}' references env var ${varName} which is not set`);
            return "";
          }
          return val;
        });
      }
    }
    out[name] = copy;
  }
  return out;
}
