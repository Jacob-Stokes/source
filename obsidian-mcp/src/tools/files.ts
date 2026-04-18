import { z } from "zod";
import type { ObsidianClient } from "../obsidian-client.js";
import { encodeVaultPath } from "../obsidian-client.js";

// Read/write/delete/move/bulk operations on vault files. Parent folders are
// auto-created on write, so there's no separate "create folder" tool needed.

const FilePath = z
  .string()
  .min(1)
  .describe("Vault-relative path, e.g. 'Home.md', 'Homelab/README.md', 'Scratch/briefing-2026-04-18.md'. Always include .md extension.");

const WriteItem = z.object({
  path: FilePath,
  content: z.string().describe("Full markdown content (frontmatter + body)."),
});

export const FilesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    path: FilePath,
  }),
  z.object({
    action: z.literal("write"),
    path: FilePath,
    content: z.string(),
    overwrite: z.boolean().default(true).describe("If false, fails on existing file."),
  }),
  z.object({
    action: z.literal("delete"),
    path: FilePath,
  }),
  z.object({
    action: z.literal("move"),
    from: FilePath,
    to: FilePath,
    overwrite: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("bulk_write"),
    files: z.array(WriteItem).min(1).max(50),
  }),
  z.object({
    action: z.literal("bulk_delete"),
    paths: z.array(FilePath).min(1).max(50),
  }),
]);

export type FilesInput = z.infer<typeof FilesInput>;

export const FILES_TOOL = {
  name: "obsidian_files",
  description:
    "Read/write/delete/move vault files with bulk variants. Parent folders auto-created on write. " +
    "Before writing, you should typically read 'Home.md' (the vault's orientation doc) to pick the " +
    "right top-level folder (Scratch/ for tests, Homelab/ for infra, Agents/ for agent stuff, etc.). " +
    "Paths are vault-relative and should include .md extensions. Examples: 'Journal/2026-04-18.md', " +
    "'Scratch/notes.md', 'Homelab/Decisions/008-something.md'. " +
    // Vault-name constant baked into the tool so agents don't drift when
    // constructing obsidian:// deep links in replies:
    "When constructing obsidian:// deep links in user-facing replies, the vault name is the EXACT " +
    "literal string 'thesys-vault' — all-lowercase, hyphenated. NOT 'Thesys Vault', NOT 'ThesysVault', " +
    "NOT URL-encoded. Template: obsidian://open?vault=thesys-vault&file=<URL_ENCODED_PATH_WITHOUT_.MD>. " +
    "Example: obsidian://open?vault=thesys-vault&file=Scratch%2Fnotes",
  inputSchema: FilesInput,
};

export async function handleFiles(client: ObsidianClient, input: FilesInput): Promise<any> {
  switch (input.action) {
    case "read": {
      const res = await client.get(`/api/files/${encodeVaultPath(input.path)}`);
      return { path: input.path, content: res?.content ?? res };
    }

    case "write": {
      const res = await client.put(`/api/files/${encodeVaultPath(input.path)}`, {
        content: input.content,
        overwrite: input.overwrite,
      });
      return { path: input.path, ...res };
    }

    case "delete": {
      await client.delete(`/api/files/${encodeVaultPath(input.path)}`);
      return { deleted: input.path };
    }

    case "move": {
      const res = await client.post(`/api/move`, {
        from: input.from,
        to: input.to,
        overwrite: input.overwrite,
      });
      return { from: input.from, to: input.to, ...res };
    }

    case "bulk_write": {
      const res = await client.post(`/api/bulk/write`, { files: input.files });
      return {
        total: input.files.length,
        ...res,
      };
    }

    case "bulk_delete": {
      const res = await client.post(`/api/bulk/delete`, { paths: input.paths });
      return {
        total: input.paths.length,
        ...res,
      };
    }
  }
}
