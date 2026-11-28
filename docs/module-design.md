---
title: "Module kit in t10-modkit: design"
audience: contributor
kind: design
status: current
summary: "Why the module and verifier packages live in t10-modkit, published by tag, and how the template consumes them."
---

# Module kit in t10-modkit: design

## Context

- **t10kit** (`t10-template/platform/kit/go/`, Go 1.26.1) has three packages:
  - `module`: `Module`, `Access`/`Auth`/`Fake`, `Service`, `Tool`, pages and web sign-in, about 1,600 lines;
  - `frame`: copied from `t10-modkit@0efa4a6`;
  - `verifier`: copied from `auth-server@95e9f9b`.

  Modules reach it with `replace t10kit => …` locally, and in Docker through a `kit` build context.
- **t10-modkit** (Go 1.27.4) is private on GitHub with no tags. It reaches 13 workspace repos as `third_party/t10-modkit` snapshots, kept equal by `scripts/check-modkit.sh`.
- **Both kits' copies have drifted from their sources:** `frame.go` and `verifier.go` differ from the current t10-modkit and auth-server versions.

## Goals / Non-Goals

**Goals:**

- One source for every piece of Go code that more than one business module uses.
- A template module builds from a tag, with nothing copied into the template.
- No change in what any module answers.

**Non-Goals:**

- Changing how workspace repos consume modkit (snapshots stay).
- Making foundation modules use `modkit/module`.

## Decisions

### 1. Publish t10-modkit; don't vendor it into the template

Make the repository public and tag releases, starting at `v0.1.0`.

- **Why:** this is the only option that leaves the template with no copy and projects with no credentials. It closes upstream U16. The code is Apache 2.0 (extracted from public t10-collab) and holds no tenant data, which a release check confirms (spec: distribution).
- **Alternatives considered:**
  - **Private with tags:** every project's CI and Docker build would need `GOPRIVATE` and a token.
  - **A synced snapshot in the template:** this keeps a copy, one sync step away from drifting.

### 2. `module` moves in, built on modkit's existing packages

`t10-modkit/module` takes t10kit's public API unchanged: `Module`, `Register`, `Person`, `PersonPage`, `View`, `Page`, `Styles`, `Access`, `Auth`, `Fake`, `Service`, `Tool`, `Args` and `Schema`. Its insides use modkit's own packages:

| Area | Package used |
|---|---|
| Error bodies | `httpjson` |
| Cookie sealing and the OAuth code flow | `websession` |
| Frame | `frame` |
| JSON-RPC handling for tools | `docsmcp` |
| Members | `people` |

- **Why:** a module changes only its imports, and each concern has one implementation.
- **Where the two disagree** (cookie names, error codes, frame markup), the module-service spec fixes what t10kit answers today, and modkit's package gains an option rather than changing behavior for its current users.
- **Alternative considered:** moving t10kit in as-is beside the modkit packages. Rejected, because it keeps two web sign-ins and two MCP servers in one repo.

### 3. The verifier gets one importable copy in modkit

`t10-modkit/verifier` is a copy of `auth-server/verifier`. `check-contracts.sh` compares the two the way it compares the other verifier copies.

- **Why:** auth-server's Go module is `t10-auth-server`, which can't be imported, and renaming it is a larger change.
- **Later:** once auth-server publishes the verifier itself, modkit's copy goes.

### 4. Frame: modkit's current one wins

Template pages move to modkit's current `frame`. Where the copy at `0efa4a6` differs, the change is visible in a module page. The module-service spec's frame scenario, comparing a module page with a property page, holds it.

### 5. Template mechanics

- **Scaffold:** `go.mod` requires `github.com/xiant10/t10-modkit vX.Y.Z` on `go 1.27.4`. The Dockerfile drops `COPY --from=kit` and `go mod edit -replace`, and uses `golang:1.27.4-alpine`.
- **Pin:** `platform/foundation/versions.env` gains `T10_MODKIT=vX.Y.Z`. `new-module.py` writes it into the scaffold, and `make check` warns on a module behind it.
- **Tests:** `make test-template` runs the template's own tests and builds a scaffolded module. It no longer tests a kit; modkit's CI does that.
- **Docs:** `platform/docs/module.md`, `guide.md` and `kit/README.md` (removed) point at t10-modkit's `docs/api.md`.

## Risks / Trade-offs

- **[Something private in modkit's history]** → A secret scan of the full history and a manual review before the visibility flip. If anything turns up, publish a fresh history from a reviewed tree rather than the old one.
- **[Projects can't build if GitHub or the Go proxy is down]** → Go's module proxy and checksum database cache public modules, and Docker's Go cache persists between builds. A project can still vendor (`go mod vendor`) if it must build offline.
- **[`module` behaves subtly differently after the rebuild on modkit packages]** → The kit's existing tests (`module_test.go`, `web_test.go`, `service_test.go`) move with it and must pass unchanged. kuaidan-sales's `make verify` on the release candidate is the acceptance test.
- **[Two ways to pin modkit: snapshots in the workspace, tags in projects]** → `check-modkit.sh` holds the snapshots equal to source. Moving the workspace to tags is the follow-up `modkit-by-tag`.

## Migration Plan

1. Land `module` and `verifier` in t10-modkit, with t10kit's tests passing there.
2. Review the content, flip the repository to public, and tag `v0.1.0`.
3. Cut t10-template `v0.11.0`, which switches to the tag and removes the kit, with migration notes.
4. In a throwaway copy of kuaidan-sales, run `make template-update`, follow the notes, and run `make verify`. Report the result to the user. kuaidan-sales itself takes the release only when its owner chooses to.

**Rollback:** a project stays on template `v0.10.1`. Tags are never moved, so a bad modkit release is fixed by a new tag.
