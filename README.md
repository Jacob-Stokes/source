# source

Monorepo for small services I own the source of. Each subdirectory with a
`Dockerfile` is auto-built by GitHub Actions into a separate image at
`ghcr.io/jacob-stokes/<folder>:latest` (and `:sha-<short>`).

| Service | Image | Description |
|---|---|---|
| `calibreweb-api/` | `ghcr.io/jacob-stokes/calibreweb-api` | Read-only Hono API for Calibre-Web Automated libraries. |
| `catalog-service/` | `ghcr.io/jacob-stokes/catalog-service` | Service inventory + REST API for jacob.st (joins Beszel + cloudflared + Cloudflare Access + per-service catalog.yml hints). |

## Adding a new service

1. Create a new top-level folder.
2. Drop a `Dockerfile` in it.
3. Optional: `.env.example`, `package.json`, `src/`, etc.
4. Push. CI discovers the folder, builds the image, pushes to GHCR.

No workflow edits needed — the matrix discovers folders dynamically.

## Local development

Each service should be runnable on its own. Look at its `.env.example` and
`Dockerfile` for the contract. Compose files live in the `homelab` repo
(jacob.st docker-services), they only reference these images — they do not
contain source.

## Mirror

Primary: `github.com/Jacob-Stokes/source` (CI here).
Mirror:  `gitea.jacob.st/jacob-admin/source` (backup; pushed manually).
