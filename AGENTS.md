# AGENTS.md

For coding agents working in this repo. Shared Go and web plumbing for t10 modules and web apps: people, ids, page, websession, frame, docsmcp, pgdb, telemetry, httpjson, and the web kit.

## Build and test

```bash
make lint      # go vet, gofmt
make test      # needs nothing running; database tests skip
make db-up     # the throwaway Postgres on 55432 that every t10 repo's tests share
make test-db   # every test, against it, one package at a time
make ci        # what CI runs
```

## Read first

- `docs/api.md`
- `web/README.md`

## Rules

- Consumers carry snapshots, never an import of this checkout: after a change, run the workspace's `scripts/sync-modkit.sh` and commit the snapshot in each consumer. Its web-kit loop overwrites `web/src/kit` in workbench and t10-property, so check that diff first.
- No business rule belongs here, only cross-cutting code.
- Its docs have no server: `t10-docs` serves them.
- A route change updates `docs/api.md` (and `docs/openapi.yaml` where there is one) in the same change.
- Every doc under `docs/` starts with front matter: `title`, `audience` (consumer, contributor or operator), `kind` (guide, reference, design or record), `status` and `summary`. Plans, reviews and validation logs go in `docs/records/`. The workspace's `make check` (`scripts/check-docs.py`) holds this and checks relative links.
- This repo is its own project inside the t10 workspace: it builds with nothing from the workspace. The workspace's `ARCHITECTURE.md` is the high-level design, and wins where they disagree.
