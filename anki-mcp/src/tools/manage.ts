// Single `anki_manage` tool with discriminated action union. Keeps the
// agent-facing tool surface small (one tool vs 20 atomic ones) while
// covering the important AnkiConnect actions.

import { z } from "zod";
import type { AnkiClient } from "../anki-client.js";

export const MANAGE_TOOL = {
  name: "anki_manage",
  description: [
    "Manage Anki flashcards via AnkiConnect. Single tool for multiple actions —",
    "specify `action` and supply the fields relevant to that action. Common:",
    "• add_note — create a card. Requires deck_name, model_name, fields {Front, Back, ...}, optional tags.",
    "• find_notes — search notes with Anki search syntax (e.g. 'deck:Default tag:todo').",
    "• get_note_info — details for specific note IDs.",
    "• update_note_fields — edit the fields of an existing note.",
    "• delete_notes — remove notes by ID.",
    "• list_decks — list all deck names.",
    "• list_models — list note-type (model) names.",
    "• model_field_names — get the fields of a specific note type.",
    "• sync — trigger Anki sync to AnkiWeb.",
  ].join(" "),
} as const;

export const ManageInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_note"),
    deck_name: z.string().describe("Target deck (will create if missing when allow_duplicate=true)."),
    model_name: z.string().describe("Note type (e.g. 'Basic', 'Cloze'). Use list_models to discover."),
    fields: z.record(z.string()).describe("Map of field name → content. Must match model's fields."),
    tags: z.array(z.string()).optional(),
    allow_duplicate: z.boolean().optional().describe("If true, create deck if missing + allow duplicate fronts."),
  }),
  z.object({
    action: z.literal("find_notes"),
    query: z.string().describe("Anki search syntax — see https://docs.ankiweb.net/searching.html"),
  }),
  z.object({
    action: z.literal("get_note_info"),
    note_ids: z.array(z.number()).min(1),
  }),
  z.object({
    action: z.literal("update_note_fields"),
    note_id: z.number(),
    fields: z.record(z.string()),
  }),
  z.object({
    action: z.literal("delete_notes"),
    note_ids: z.array(z.number()).min(1),
  }),
  z.object({ action: z.literal("list_decks") }),
  z.object({ action: z.literal("list_models") }),
  z.object({
    action: z.literal("model_field_names"),
    model_name: z.string(),
  }),
  z.object({ action: z.literal("sync") }),
]);

export async function handleManage(client: AnkiClient, input: z.infer<typeof ManageInput>) {
  switch (input.action) {
    case "add_note": {
      const note = {
        deckName: input.deck_name,
        modelName: input.model_name,
        fields: input.fields,
        tags: input.tags ?? [],
        options: {
          allowDuplicate: !!input.allow_duplicate,
          duplicateScope: "deck",
          duplicateScopeOptions: {
            deckName: input.deck_name,
            checkChildren: false,
            checkAllModels: false,
          },
        },
      };
      const id = await client.invoke<number>("addNote", { note });
      return { note_id: id, deck: input.deck_name, model: input.model_name };
    }
    case "find_notes":
      return { note_ids: await client.invoke<number[]>("findNotes", { query: input.query }) };
    case "get_note_info":
      return { notes: await client.invoke<any[]>("notesInfo", { notes: input.note_ids }) };
    case "update_note_fields":
      await client.invoke("updateNoteFields", { note: { id: input.note_id, fields: input.fields } });
      return { ok: true, note_id: input.note_id };
    case "delete_notes":
      await client.invoke("deleteNotes", { notes: input.note_ids });
      return { deleted: input.note_ids.length };
    case "list_decks":
      return { decks: await client.invoke<string[]>("deckNames") };
    case "list_models":
      return { models: await client.invoke<string[]>("modelNames") };
    case "model_field_names":
      return {
        model: input.model_name,
        fields: await client.invoke<string[]>("modelFieldNames", { modelName: input.model_name }),
      };
    case "sync":
      await client.invoke("sync");
      return { ok: true, synced: true };
  }
}
