import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { renderUI } from "./ui";
import { validateKey, createKey, listKeys, revokeKey } from "./keys";

const app = new Hono();

// Libraries are driven by LIBRARY_<NAME>=<base_path> env vars
// e.g. LIBRARY_FICTION=/data/fiction, LIBRARY_POETRY=/data/poetry
// base_path must contain books/metadata.db and config/app.db
// Optionally LIBRARY_<NAME>_URL=https://fiction.jacob.st for discovery by external apps
const libraries: Record<string, { metadata: string; app: string; books: string; url: string | null }> = {};

for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("LIBRARY_") && !key.endsWith("_URL") && value) {
    const name = key.replace("LIBRARY_", "").toLowerCase();
    const urlKey = `LIBRARY_${name.toUpperCase()}_URL`;
    libraries[name] = {
      metadata: `${value}/books/metadata.db`,
      app: `${value}/config/app.db`,
      books: `${value}/books`,
      url: process.env[urlKey] ?? null,
    };
  }
}

if (Object.keys(libraries).length === 0) {
  console.warn("No LIBRARY_* env vars found. No library routes will be registered.");
}

function getDb(library: string) {
  const paths = libraries[library];
  const db = new Database(paths.metadata, { readonly: true });
  try {
    db.exec(`ATTACH DATABASE '${paths.app}' AS appdb`);
  } catch {
    // app.db optional
  }
  return db;
}

const BOOK_QUERY = `
  SELECT
    b.id, b.title, b.pubdate, b.path, b.has_cover, b.series_index,
    b.timestamp as added,
    b.uuid,
    GROUP_CONCAT(DISTINCT a.name) as authors,
    GROUP_CONCAT(DISTINCT t.name) as tags,
    s.name as series,
    p.name as publisher,
    c.text as description,
    GROUP_CONCAT(DISTINCT d.format) as formats
  FROM books b
  LEFT JOIN books_authors_link bal ON b.id = bal.book
  LEFT JOIN authors a ON bal.author = a.id
  LEFT JOIN books_tags_link btl ON b.id = btl.book
  LEFT JOIN tags t ON btl.tag = t.id
  LEFT JOIN books_series_link bsl ON b.id = bsl.book
  LEFT JOIN series s ON bsl.series = s.id
  LEFT JOIN books_publishers_link bpl ON b.id = bpl.book
  LEFT JOIN publishers p ON bpl.publisher = p.id
  LEFT JOIN comments c ON b.id = c.book
  LEFT JOIN data d ON b.id = d.book
  GROUP BY b.id
`;

function formatBook(row: any, libraryUrl: string | null = null) {
  const formats: string[] = row.formats ? row.formats.split(",") : [];
  const hasEpub = formats.some((f) => f.toUpperCase() === "EPUB");

  const urls = libraryUrl
    ? {
        web: `${libraryUrl}/book/${row.id}`,
        read: hasEpub ? `${libraryUrl}/read/${row.id}/epub` : null,
        download: Object.fromEntries(
          formats.map((f) => {
            const fl = f.toLowerCase().replace("kepub", "kepub.epub");
            return [f, `${libraryUrl}/download/${row.id}/${fl}/${row.id}.${fl}`];
          })
        ),
      }
    : null;

  return {
    id: row.id,
    title: row.title,
    authors: row.authors ? row.authors.split(",") : [],
    tags: row.tags ? row.tags.split(",") : [],
    series: row.series || null,
    series_index: row.series_index,
    publisher: row.publisher || null,
    description: row.description || null,
    formats,
    pubdate: row.pubdate,
    added: row.added,
    has_cover: Boolean(row.has_cover),
    uuid: row.uuid,
    path: row.path,
    urls,
  };
}

function libraryRoute(library: string) {
  const router = new Hono();
  const libUrl = libraries[library].url;

  router.get("/books", (c) => {
    const db = getDb(library);
    const limit = parseInt(c.req.query("limit") ?? "50");
    const offset = parseInt(c.req.query("offset") ?? "0");
    const sort = c.req.query("sort") ?? "title";
    const order = c.req.query("order") === "desc" ? "DESC" : "ASC";
    const validSorts: Record<string, string> = {
      title: "b.title", added: "b.timestamp", pubdate: "b.pubdate", author: "b.author_sort",
    };
    const sortCol = validSorts[sort] ?? "b.title";
    const rows = db.query(`${BOOK_QUERY} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`).all(limit, offset);
    const total = (db.query("SELECT COUNT(*) as count FROM books").get() as any).count;
    db.close();
    return c.json({ total, limit, offset, books: rows.map((r: any) => formatBook(r, libUrl)) });
  });

  router.get("/books/search", (c) => {
    const q = c.req.query("q");
    if (!q) return c.json({ error: "Missing query param: q" }, 400);
    const db = getDb(library);
    const rows = db.query(`${BOOK_QUERY} HAVING b.title LIKE ? OR authors LIKE ? ORDER BY b.title ASC`).all(`%${q}%`, `%${q}%`);
    db.close();
    return c.json({ query: q, count: rows.length, books: rows.map((r: any) => formatBook(r, libUrl)) });
  });

  router.get("/books/recent", (c) => {
    const limit = parseInt(c.req.query("limit") ?? "10");
    const db = getDb(library);
    const rows = db.query(`${BOOK_QUERY} ORDER BY b.timestamp DESC LIMIT ?`).all(limit);
    db.close();
    return c.json({ books: rows.map((r: any) => formatBook(r, libUrl)) });
  });

  router.get("/books/:id", (c) => {
    const db = getDb(library);
    const row = db.query(`${BOOK_QUERY} HAVING b.id = ?`).get(parseInt(c.req.param("id")));
    db.close();
    if (!row) return c.json({ error: "Book not found" }, 404);
    return c.json(formatBook(row, libUrl));
  });

  router.get("/books/:id/cover", async (c) => {
    const db = getDb(library);
    const book = db.query("SELECT path, has_cover FROM books WHERE id = ?").get(parseInt(c.req.param("id"))) as any;
    db.close();
    if (!book) return c.json({ error: "Book not found" }, 404);
    if (!book.has_cover) return c.json({ error: "No cover available" }, 404);
    const coverPath = `${libraries[library].books}/${book.path}/cover.jpg`;
    const file = Bun.file(coverPath);
    if (!(await file.exists())) return c.json({ error: "Cover file not found" }, 404);
    return new Response(file, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
  });

  router.get("/authors", (c) => {
    const db = getDb(library);
    const rows = db.query(`SELECT a.id, a.name, a.sort, COUNT(bal.book) as book_count FROM authors a LEFT JOIN books_authors_link bal ON a.id = bal.author GROUP BY a.id ORDER BY a.sort ASC`).all();
    db.close();
    return c.json({ count: rows.length, authors: rows });
  });

  router.get("/authors/:id/books", (c) => {
    const db = getDb(library);
    const author = db.query("SELECT id, name, sort FROM authors WHERE id = ?").get(parseInt(c.req.param("id")));
    if (!author) { db.close(); return c.json({ error: "Author not found" }, 404); }
    const rows = db.query(`${BOOK_QUERY} HAVING bal.author = ? ORDER BY b.title ASC`).all(parseInt(c.req.param("id")));
    db.close();
    return c.json({ author, count: rows.length, books: rows.map((r: any) => formatBook(r, libUrl)) });
  });

  router.get("/series", (c) => {
    const db = getDb(library);
    const rows = db.query(`SELECT s.id, s.name, s.sort, COUNT(bsl.book) as book_count FROM series s LEFT JOIN books_series_link bsl ON s.id = bsl.series GROUP BY s.id ORDER BY s.sort ASC`).all();
    db.close();
    return c.json({ count: rows.length, series: rows });
  });

  router.get("/series/:id/books", (c) => {
    const db = getDb(library);
    const series = db.query("SELECT id, name, sort FROM series WHERE id = ?").get(parseInt(c.req.param("id")));
    if (!series) { db.close(); return c.json({ error: "Series not found" }, 404); }
    const rows = db.query(`${BOOK_QUERY} HAVING bsl.series = ? ORDER BY b.series_index ASC`).all(parseInt(c.req.param("id")));
    db.close();
    return c.json({ series, count: rows.length, books: rows.map((r: any) => formatBook(r, libUrl)) });
  });

  router.get("/tags", (c) => {
    const db = getDb(library);
    const rows = db.query(`SELECT t.id, t.name, COUNT(btl.book) as book_count FROM tags t LEFT JOIN books_tags_link btl ON t.id = btl.tag GROUP BY t.id ORDER BY t.name ASC`).all();
    db.close();
    return c.json({ count: rows.length, tags: rows });
  });

  router.get("/stats", (c) => {
    const db = getDb(library);
    const total = (db.query("SELECT COUNT(*) as n FROM books").get() as any).n;
    const authors = (db.query("SELECT COUNT(*) as n FROM authors").get() as any).n;
    const series = (db.query("SELECT COUNT(*) as n FROM series").get() as any).n;
    const tags = (db.query("SELECT COUNT(*) as n FROM tags").get() as any).n;
    const formats = db.query(`SELECT format, COUNT(*) as count FROM data GROUP BY format ORDER BY count DESC`).all();
    db.close();
    return c.json({ total_books: total, total_authors: authors, total_series: series, total_tags: tags, formats });
  });

  return router;
}

const api = new Hono();

// Auth middleware — library data routes require X-API-Key
// Open: /health, /keys, /dashboard/*
api.use("*", async (c, next) => {
  const path = c.req.path.replace(/^\/api/, "");
  const isOpen = path === "/health" || path.startsWith("/keys") || path.startsWith("/dashboard");
  if (isOpen) return next();
  const key = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (!key || !validateKey(key)) {
    return c.json({ error: "Invalid or missing API key" }, 401);
  }
  return next();
});

// Health check — no auth needed, verifies API is up and exposes library metadata
api.get("/health", (c) =>
  c.json({
    status: "ok",
    libraries: Object.fromEntries(
      Object.entries(libraries).map(([name, lib]) => [name, { url: lib.url }])
    ),
  })
);

// Dashboard stats — no auth, used by the UI
api.get("/dashboard/stats", (c) => {
  const result: Record<string, any> = {};
  for (const name of Object.keys(libraries)) {
    try {
      const db = getDb(name);
      const total = (db.query("SELECT COUNT(*) as n FROM books").get() as any).n;
      const authors = (db.query("SELECT COUNT(*) as n FROM authors").get() as any).n;
      const formats = db.query("SELECT format, COUNT(*) as count FROM data GROUP BY format ORDER BY count DESC").all();
      db.close();
      result[name] = { status: "ok", url: libraries[name].url, total_books: total, total_authors: authors, formats };
    } catch (e) {
      result[name] = { status: "error", url: libraries[name].url, error: String(e) };
    }
  }
  return c.json(result);
});

// Key management routes (called from the UI)
api.get("/keys", (c) => c.json(listKeys()));
api.post("/keys", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = (body.name ?? "").trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  return c.json(createKey(name), 201);
});
api.delete("/keys/:id", (c) => {
  const ok = revokeKey(parseInt(c.req.param("id")));
  return ok ? c.json({ deleted: true }) : c.json({ error: "Key not found" }, 404);
});

// Dynamically register a route per library under /api
for (const name of Object.keys(libraries)) {
  api.route(`/${name}`, libraryRoute(name));
  console.log(`Registered library route: /api/${name}`);
}

app.route("/api", api);

// UI at root
app.get("/", (c) => c.html(renderUI()));

export default { port: 3000, fetch: app.fetch };
