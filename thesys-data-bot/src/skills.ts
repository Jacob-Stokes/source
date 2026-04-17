// Reads ~/.claude/skills/<name>/SKILL.md and returns both the metadata
// (for logging / the /skills command) and the full content (for explicit
// injection into the system prompt). We don't rely on the Agent SDK's
// implicit skill-loading — we inject the content ourselves so the model
// always has it.
import fs from "node:fs";
import path from "node:path";

export interface SkillInfo {
  name: string;
  description: string;
  body: string; // markdown after the frontmatter
  path: string;
}

const SKILLS_DIR = process.env.SKILLS_DIR || path.join(process.env.HOME || "/root", ".claude/skills");

function parseFrontmatter(md: string): { name?: string; description?: string; body: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { body: md };
  const fm = m[1];
  const body = m[2];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*([\s\S]+?)(?=\n[a-z_]+:|$)/m)?.[1]?.trim();
  return { name, description, body };
}

export function discoverSkills(): SkillInfo[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const out: SkillInfo[] = [];
  for (const entry of fs.readdirSync(SKILLS_DIR)) {
    const skillFile = path.join(SKILLS_DIR, entry, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const md = fs.readFileSync(skillFile, "utf-8");
    const fm = parseFrontmatter(md);
    if (fm.name) {
      out.push({
        name: fm.name,
        description: fm.description || "",
        body: fm.body,
        path: skillFile,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Build a single concatenated block of all skills for the system prompt.
export function skillsBlock(skills: SkillInfo[]): string {
  if (skills.length === 0) return "";
  const sections = skills.map((s) => `## Skill: ${s.name}\n\n${s.body.trim()}`);
  return [
    "# Available skills",
    "",
    "The following skill documents are available to you. Read them carefully — they contain the auth patterns, API shapes, and conventions for Jacob's homelab. Use them BEFORE asking clarifying questions or guessing.",
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
}
