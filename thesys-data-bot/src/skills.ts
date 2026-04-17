// Discovers installed Claude Code skills at ~/.claude/skills/<name>/SKILL.md
// and makes them available for the Agent SDK to load. Each skill is a
// markdown file with YAML frontmatter (name + description) — the Agent SDK's
// built-in skill loader picks them up automatically when the skills dir is
// present. This file exists to surface skill info for logging + health checks.
import fs from "node:fs";
import path from "node:path";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

const SKILLS_DIR = process.env.SKILLS_DIR || path.join(process.env.HOME || "/root", ".claude/skills");

// Parse the `name:` and `description:` out of a SKILL.md's frontmatter.
function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = m[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*([\s\S]+?)(?=\n[a-z_]+:|$)/m)?.[1]?.trim();
  return { name, description };
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
        path: skillFile,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
