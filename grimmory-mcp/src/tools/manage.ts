import { z } from "zod";
import type { GrimmoryClient } from "../grimmory-client.js";

export const MANAGE_TOOL = {
  name: "grimmory_manage",
  description: [
    "Query and update Jacob's Grimmory ebook library. Actions:",
    "• list_libraries — all libraries (Fiction, Non-Fiction, Poetry, etc.)",
    "• search — full-text search across libraries (optionally scoped to one).",
    "• list_books — recent books (optionally by library).",
    "• get_book — details for a specific book ID.",
    "• update_read_status — mark a book read/unread or update progress.",
  ].join(" "),
} as const;

export const ManageInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_libraries") }),
  z.object({
    action: z.literal("search"),
    query: z.string().min(1),
    library_id: z.string().optional().describe("Restrict to a single library."),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  z.object({
    action: z.literal("list_books"),
    library_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
    sort: z.string().optional().describe("e.g. 'added:desc', 'title:asc'"),
  }),
  z.object({
    action: z.literal("get_book"),
    book_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("update_read_status"),
    book_id: z.string().min(1),
    status: z.enum(["unread", "in_progress", "read"]).optional(),
    progress: z.number().min(0).max(1).optional().describe("0.0 to 1.0"),
  }),
]);

export async function handleManage(client: GrimmoryClient, input: z.infer<typeof ManageInput>) {
  switch (input.action) {
    case "list_libraries":
      return await client.get("/api/v1/libraries");
    case "search": {
      const params = new URLSearchParams();
      params.set("q", input.query);
      params.set("size", String(input.limit));
      if (input.library_id) params.set("libraryId", input.library_id);
      return await client.get(`/api/v1/books/search?${params.toString()}`);
    }
    case "list_books": {
      const params = new URLSearchParams();
      params.set("size", String(input.limit));
      if (input.library_id) params.set("libraryId", input.library_id);
      if (input.sort) params.set("sort", input.sort);
      return await client.get(`/api/v1/books?${params.toString()}`);
    }
    case "get_book":
      return await client.get(`/api/v1/books/${encodeURIComponent(input.book_id)}`);
    case "update_read_status":
      return await client.put(`/api/v1/books/${encodeURIComponent(input.book_id)}/read-progress`, {
        status: input.status,
        progress: input.progress,
      });
  }
}
