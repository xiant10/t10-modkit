---
title: "t10-modkit API"
audience: consumer
kind: reference
status: current
summary: "t10-modkit's packages, what each exports, and the rules for using them in a module."
---

# t10-modkit API

The reference for t10-modkit's packages: what each exports and the rules for using it. It's a library, with no service. Consumers carry a snapshot in `third_party/t10-modkit` (Go) or `web/src/kit/` (the web kit), made by the workspace's `scripts/sync-modkit.sh`; `make check` fails when one drifts, so change it here.

## Go packages

Module `t10-modkit`.

### `ids`

| Name | Does |
| --- | --- |
| `New(prefix string) string` | `prefix_` and 32 random hex characters, such as `usr_3fa9…` |

### `page`

Keyset cursors, so a row added between two reads can't repeat or skip one.

| Name | Does |
| --- | --- |
| `Encode(at time.Time, id string) string` | A cursor after the row with that time and ID |
| `Decode(cursor string) (at time.Time, id string, ok bool, err error)` | Read one back. `ok` is false for an empty cursor |
| `ErrBadCursor` | A cursor this package didn't make |

### `people`

Org reads from `auth-server`'s service routes (`/v1/org/…`), with the module's own service token. Business policy stays in each consumer.

```go
org := people.New(people.Options{URL: authURL, ClientID: "t10-knowledge", ClientSecret: secret})
m, err := org.Member(ctx, tenantID, userID)
if errors.Is(err, people.ErrUnavailable) { /* fail closed */ }
if !m.Active() { /* refuse */ }
```

| Name | Does |
| --- | --- |
| `Options{URL, ClientID, ClientSecret, HTTPClient}` | Where `auth-server` is, and this service's account. `HTTPClient` defaults to one with a short timeout |
| `New(Options) *Client` | |
| `(*Client).Member(ctx, tenant, user)` | One member, read fresh. Use this for authorization |
| `(*Client).Reports(ctx, tenant, user)` | Everyone beneath a manager, fresh |
| `(*Client).CachedReports(ctx, tenant, user, transitive)` | Reports for visibility, up to 60 seconds old. A failed read is an error, never an older answer. Not for authorization |
| `(*Client).UnitMembers(ctx, tenant, unit)` | A unit's direct active members, fresh. `ErrNotFound` means the unit was deleted; an empty list means it's empty |
| `(*Client).Members(ctx, tenant)` | Every member, including inactive and suspended ones. Any failed page fails the read |
| `(*Client).Search(ctx, tenant, q, unit, cursor, limit)` | Active members by display name, with the next cursor |
| `(*Client).Units(ctx, tenant)` | The tenant's org units |
| `(*Client).ServiceToken(ctx)` | This service's own token, renewed before it expires, for calls it makes as itself |
| `Member{UserID, Role, Status, UserStatus, ManagerUserID, OrgUnitID, DisplayName, Kind}` | `Active()`, `Departed()` (membership inactive), `Suspended()` (account suspended), `Agent()` (`Kind == "agent"`) |
| `Unit{ID, ParentID, Name, Kind}` | |
| `ValidID(id)`, `IsAgentID(id)`, `AgentPrefix` (`acc_`), `KindAgent` | ID checks |
| `ErrUnavailable`, `ErrNotFound` | `auth-server` couldn't answer; no such member or unit in this tenant |

Act on someone leaving only on an explicit `Departed()`, never on a failed or missing read.

### `websession`

Browser sign-in for a t10 web app's server: the authorization-code flow with PKCE against `auth-server`, sessions in the app's own Postgres table with tokens sealed at rest, refresh, tenant switching and sign-out. Workbench, the console and property's web app use it.

| Name | Does |
| --- | --- |
| `NewManager(Options) (*Manager, error)` | `Options{Pool, Key, Auth, AuthPublicURL, PublicURL, Secure, Name, Table, MaxAge, ReplaceOnSignIn}`. `Name` prefixes the cookies (`wb` gives `wb_session`), and `Table` is the schema-qualified sessions table |
| `(*Manager).Begin(w, next, tenant) string` | Start signing in; answers the address to redirect to |
| `(*Manager).BeginStepUp(w, next) string` | Sign in again for a fresh second factor |
| `(*Manager).Complete(ctx, w, r) (next string, err error)` | Finish at the callback and set the session |
| `(*Manager).Identify(ctx, r) (Identity, error)` | The signed-in `Identity{UserID, Access}`, refreshing the access token when needed |
| `(*Manager).SwitchTenant(ctx, r, tenant)` | Move the session to another tenant |
| `(*Manager).Alive(ctx, r)` | Whether the sign-in still stands at `auth-server` |
| `(*Manager).SignOut(ctx, w, r) string`, `Logout(ctx, w, r)` | End this session; `SignOut` answers where to send the browser to end the person's other web sessions |
| `(*Manager).OnPublicHost(w, r) bool` | Redirects a request on another host name to the public one |
| `(*Manager).Prune(ctx)` | Delete expired sessions |
| `AuthClient` | `Redeem`, `Refresh`, `Revoke`, and `Call(ctx, method, path, bearer, body)` for any `auth-server` route |
| `SignInHints(target, reason, lang)`, `SafeNext(next)`, `IsSecure(publicURL)` | Helpers |
| `ErrSignedOut`, `ErrTenantRequired`, `ErrTenantDenied`, `ErrMFARequired`, `ErrUnavailable` | Why `Identify` or `Complete` failed. Map them to `401 signed_out`, `403 tenant_denied`, `403 mfa_required` and `503` |

### `frame`

The frame of every server-drawn page, such as the console and `auth-server`'s account page, matching the web kit's.

| Name | Does |
| --- | --- |
| `Templates` | Defines `frame-apps`, `frame-account` and `frame-icon`. Parse it into the page's template set, which must have a `t` function |
| `CSS` | The rail, Apps list and account menu, in the web kit's tokens |
| `Homes`, `Tenant`, `App`, `Link` | `auth-server`'s `GET /v1/me/homes` |
| `Places(homes, tenant, current, zh) []Place` | The Apps list, in the same order in every app |
| `Menu` | The account menu, with `Initial()`. It offers no language or theme: those are on the account page |
| `AccountLink(account, back)` | The account page, coming back to `back` |
| `ValidTheme(theme)` | `system`, `light` or `dark` |

### `docsmcp`

Serves the image's own docs to coding agents over MCP at `/docs/mcp`, as the workspace's [docs contract](../../contracts/docs/README.md) describes. It serves only docs whose front matter says `audience: consumer` and that aren't records, because the route takes no token.

```go
// docs/docs.go in the module's repo, so the binary carries its docs.
package docs

import "embed"

//go:embed *.md openapi.yaml
var FS embed.FS
```

```go
h, err := docsmcp.New(docsmcp.Options{
	Component: "t10-collab", Summary: "Work items, offers and lists…", Version: version,
	Docs: docs.FS, AgentTools: func() []docsmcp.Tool { … },
})
mux.Handle(docsmcp.Route, h)
```

| Name | Does |
| --- | --- |
| `Route` | `/docs/mcp` |
| `Options{Component, Summary, Version, Docs, AgentTools}` | The image's name, one sentence on what it offers, the commit it was built from, its `docs/` folder, and optionally its agent tools |
| `New(Options) (*Handler, error)` | Reads every doc once. Broken front matter or a broken `openapi.yaml` is an error, so a test that calls `New` keeps the docs servable |
| `(*Handler).ServeHTTP` | MCP over Streamable HTTP: one JSON-RPC message per `POST`, no session, no token. Refuses other methods with `405` and a browser's request with `403` |
| `(*Handler).Docs() []Doc` | What it serves, in overview order |
| `(*Handler).Wrap(next) http.Handler` | Answers `Route` with the docs and passes everything else to `next`, so `main` mounts the docs in front of the image's own handler |
| `DocsOnly(os.Args, h) (bool, error)` | Serves only `Route` when the command runs as `<command> docs <addr>`, with no database, for the contract's suite. Call it first in `main` |
| `(*Handler).ServeStdio(in, out)` | The same messages over stdio, one per line, for a command-line tool |
| `(*Handler).Answer(method, params)` | One request in process: the result, or a JSON-RPC error code and message. `t10-docs` uses it for the docs it carries |
| `Tool{Name, Description, Action, InputSchema}` | One agent tool, as `docs_agent_tools` lists it |

### `pgdb`

Opens a service's Postgres pool and applies its embedded migrations. A service keeps a few lines of its own in `internal/db`: its schema, its lock key and the embed.

```go
//go:embed migrations/*.sql
var migrations embed.FS

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	return pgdb.Migrate(ctx, pool, pgdb.Migrations{FS: migrations, Schema: "collab", Lock: 7410_0002})
}
```

| Name | Does |
| --- | --- |
| `Open(ctx, url, maxConns)` | A pool, pinged once. `maxConns` zero keeps pgx's default |
| `Migrations{FS, Schema, Lock}` | The files at `migrations/*.sql`, the schema that holds `schema_migrations`, and the advisory lock key |
| `Migrate(ctx, pool, Migrations)` | Applies, in name order, every file not yet in `<schema>.schema_migrations`, each in its own transaction, under the lock so replicas take turns. A recorded name is the file's path, such as `migrations/0001_init.sql`, so files are never renamed |
| `IsUniqueViolation(err, constraint)` | Whether `err` broke that unique index |

Lock keys only need to differ within one database, but each service has its own so a shared database stays safe: auth-server `7410_0001`, t10-collab `0002`, workbench `0003`, t10-agent-control `0005`, t10-console and t10-automations `0008`, t10-knowledge `0010`, t10-property `0011`.

### `telemetry`

Request traces over OTLP/HTTP, as [ARCHITECTURE.md](../../ARCHITECTURE.md#telemetry) asks of every service. Spans carry routes and identifiers, never a query string or a body. With no endpoint it does nothing.

| Name | Does |
| --- | --- |
| `Setup(ctx, service, endpoint, options...)` | Names the service, sets the W3C propagator and starts the exporter at `endpoint` + `/v1/traces`. Returns a shutdown that flushes. A bad endpoint logs and leaves tracing off; it never stops the service. Options reach the tracer provider |
| `Wrap(pattern, handler, options...)` | Traces one route, registered on a mux so the span is named by its pattern, and marks `t10.session.id` from `X-Session-ID` |
| `WrapAll(handler)` | The same around a whole mux: each span is renamed after the route that matched |
| `Inject(ctx, header)` | Puts the trace into an outgoing request as `traceparent` |
| `Continue(ctx, traceparent, name)` | A span under a traceparent that came inside a message, as MCP sends it |
| `WithSession(handler)`, `SpanValue(s)` | The session marking on its own, and the check that a value is an identifier, not free text |
| `Service()`, `Tracer()` | The name given to `Setup`, and its tracer |

### `ontology`

A module's ontology, as the workspace's [`contracts/ontology/README.md`](../../contracts/ontology/README.md) defines it: the descriptor at `GET /v1/ontology`, the object, action, undo and proposal routes, and the generated agent tools, all built from one set of declarations so they can't drift. It owns plumbing and never truth: it opens no database connection and decides no authority, and every read and write goes through functions the module supplies, which apply its own scope, field rules and command path. It's generic over the module's own caller type, so `Registry[auth.Caller]` and `Registry[module.Caller]` fit alike.

```go
reg := ontology.New(ontology.Options[Caller]{
	Module: "crm", Prefix: "crm", Version: 1, Restricted: []string{"deal.set_discount"},
	Authenticate: auth, Who: who, Can: can, Tenant: tenantLayer, // Tenant only where tenants configure a schema
	Proposals: proposals.Postgres{Pool: pool, Schema: "crm"}, Undo: undo.Postgres{Pool: pool, Schema: "crm"},
})
ontology.AddObject(reg, ontology.ObjectType[Caller, *Deal]{Name: "deal", Search: …, Get: …, View: …})
ontology.AddAction(reg, ontology.ActionType[Caller, *Deal]{Name: "deal.set_stage", On: "deal", Agent: ontology.Propose, Apply: …})
if err := reg.Check(); err != nil { … } // at startup and in a test
ontology.Mount(mux, reg.Routes())
```

| Name | Does |
| --- | --- |
| `New(Options[C])`, `Options` | A registry. `Authenticate` reads a request's caller and whether its token is a person's or delegated; `Who` names the person; `Can` checks a business permission; `Tenant` answers the caller's tenant layer |
| `AddObject(reg, ObjectType[C, R])` | An object type over the module's reads. `R` is its record type. `Search` answers up to `Limit+1` records after `After`, scope first; `Get` answers `ErrNotFound` for a record the caller can't reach; `View` is what the caller may see; `Follow` pages a link; `Sources` names a derived value's records |
| `AddAction(reg, ActionType[C, R])` | An action over the module's command path: `Available` (a reason code or ""), `Validate`, `Apply` and, for an undo action, `Revert`. `R` is the record type of the type it acts on, `struct{}` for a create |
| `reg.AddEvent(kind, on)` | An event kind the module posts |
| `reg.Check()` | Every mistake in the declarations: the contract's rules on the core (titles, refs, interfaces, `undoable` needing undo and idempotent, `restricted` being `never`, no param setting a derived property) and missing functions or stores |
| `reg.Core()`, `reg.Describe(ctx, c)` | The core, and the caller's descriptor with its tenant layer, which is refused when it does more than add |
| `CheckCore(d)`, `CheckTenant(core, layer)` | The same rules as `contracts/ontology/descriptor.ts`, for a module's own tests, such as of a pack before it's published |
| `reg.Routes()`, `reg.ProposalRoutes()`, `Mount(mux, routes)` | The contract's routes, each traced by its pattern. Every one but `/v1/ontology` refuses a delegated token with `401 person_token_required` |
| `reg.Tools()`, `Tool[C]` | The generated MCP tools, as `docsmcp.Tool` values with a `Run`: `<prefix>_describe`, `_search`, `_get` and `_propose`, and `_act` when the core has an `undoable` action. The module's MCP server checks the grant holds `Tool.Action`, builds the person's caller narrowed by the grant, and calls `Run`. Results are marked as data, sensitive values masked, and filters or sorts on them refused |
| `reg.GetObject`, `Search`, `Follow`, `Resolve`, `Validate`, `Apply`, `Undo`, `Propose`, `Proposals`, `Confirm`, `Dismiss` | What the routes and tools call, for a module's own handlers and tests |
| `DecodeSearch(body, props, defaultSort, agent)`, `Query`, `Filter`, `Sort`, `Position` | The filter grammar, typed against a type's properties: what `Search` gets |
| `Error`, `Fail(status, code, message)`, `ErrNotFound`, `ErrForbidden`, `ErrWrongState`, `ErrStaleRevision`, `ErrUndoConflict`, `ErrFilterNotAllowed`, … | Refusals with the contract's status and code. A module returns them, or its own `*Error` with the same code, and the routes and tools answer them as they are |
| `IsAgent(ctx)`, `Masked` | Whether a call came through the tools, and what an agent sees in place of a sensitive value |
| `ProposalStore`, `UndoStore`, `ProposalLife`, `ProposalLimit` | Where drafts, undo entries and idempotent answers live, the module's own database. Drafts last 7 days, 50 open per person |

The flows are the registry's: confirming applies under the person's current rights with `via: "proposal"`; only the person an action was applied for can undo it, within its window, once; an idempotent action's replay answers the first result after checking rights again. Each store keeps the same rules.

| Package | Does |
| --- | --- |
| `ontology/proposals` | `Memory`, and `Postgres{Pool, Schema}` over `<schema>.ontology_proposals`. `Migrations(schema, lock)` is its migration for `pgdb.Migrate`, in the module's own schema with the module's lock key |
| `ontology/undo` | `Memory`, and `Postgres{Pool, Schema}` over `<schema>.ontology_undo` and `ontology_replays`, with `Migrations(schema, lock)` |
| `ontology/client` | The Go client: `Client{Modules, Versions}` with `Load`, `Describe`, `Search`, `Get`, `Links`, `Resolve` (grouped by module, in the order given, naming the modules that didn't answer), `Validate`, `Apply`, `Undo`, `Proposals`, `Confirm`, `Dismiss`. It calls with the person's own token for this request, and refuses a delegated token (`act` or `grant` claim) or a service's own (no session) with `person_token_required` before sending. Errors keep their status and code |

`ontology/testdata/ledgermod` is a small in-memory test module shaped like a sales module: private rows per rep, a pack as its tenant layer, a ledger with derived `stage`, `score` and `band`, `record.add` at `undoable`. The package's tests run every scenario the workspace's specs name for sales against it, and `ledgermod/stub` serves it over HTTP for the workspace's conformance suite. `ontology/testdata/client/fixture.json` is answers recorded from it, which both clients replay (`ONTOLOGY_RECORD=1 go test ./ontology/client` records it again).

### `httpjson`

The JSON bodies of t10's APIs, and the one error body they answer with: `{"error": "<snake_case code>", "message": "<optional sentence>"}`. OAuth endpoints and OpenAI-compatible routes keep the shape their protocol fixes.

| Name | Does |
| --- | --- |
| `Write(w, status, body)` | JSON with `Cache-Control: no-store` |
| `Error(w, status, code, message)` | The error body. An empty message is left out |
| `ErrorBody{Error, Message}` | The error body, for clients and tests |
| `Decode(w, r, into)` | Reads one JSON value. On a bad body it answers `400 invalid_request`, or `413 too_large` past a limit the route set with `http.MaxBytesReader`, and returns false |

## The web kit

`web/` is the TypeScript and React every t10 web app shares; [`web/README.md`](../web/README.md) explains each part.

| File | Exports |
| --- | --- |
| `api.ts` | `postJSON`, `ApiError`, `newTurnId`, `onSignedOut`, `announceSignedOut`, `onModuleGone` |
| `session.ts` | `watchSession`, `signIn`, `signInHref`, `keepDraftsFor`, `SignInReason` |
| `preferences.ts` | `useSavedPreferences` |
| `theme.ts` | `useTheme`, `applyTheme`, `applySavedTheme` (the saved preferences' only), `Theme` |
| `i18n.tsx` | `I18nProvider`, `useI18n`, `useApplyLanguage` (the saved preferences' only), `Language`, `LANGUAGES`. Each app passes its own catalog |
| `frame.tsx` | `Frame`, `Rail`, `AccountMenu`, `SectionLinks`, `OtherPlaces`, `groupSections`, `sectionCount`, `accountHref`, `focusMenuButton`, `maskIcon`, `Icon`, `NavSection`, `NavGroup`, `NAV`, `RailApp`, `CONSOLE`, `WORKBENCH` |
| `command.tsx` | `Palette`, `SearchButton`, `useSearchShortcut`, `SHORTCUT`, `Bell`, `BellItem`, `PaletteEntry` |
| `ask.tsx` | `AskPanel`, `AskButton`, `AskTransport`, `AskMessage` |
| `ui.tsx` | `Dialog`, `Menu`, `Segmented`, `Setting`, `Skeleton`, `Empty`, `Avatar`, `CopyButton`, `Logo`, `ErrorBoundary`, `FeedbackProvider`, `useFeedback` |
| `storage.ts` | `load`, `save` |
| `layout.ts` | `useMedia`, `navigateOptions`, `RESULTS` |
| `ontology.ts` | `OntologyClient` (`load`, `describe`, `search`, `get`, `links`, `resolve`, `validate`, `apply`, `undo`, `proposals`, `confirm`, `dismiss`, the Go client's operations), `workbenchModules`, `splitRef`, `propertiesOf`, `paramsOf`, `typeLabel`, `actionLabel`, `propertyLabel`, `formatValue`, `allowedActions`, `paramValue`, and the contract's types. Calls go through Workbench's `/api/modules/{id}` or the app's own `/api`, so the page holds no token; errors are `ApiError` with the module's status and code |
| `ontology-ui.tsx` | `RefChip` (a reference that didn't resolve is plain text, with no link), `ObjectCard`, `ObjectTable`, `ActionForm`, `ProposalCard`: any module's objects, actions and drafts, drawn from its descriptor in the reader's language, showing only allowed actions. Their words (Confirm, Dismiss, Cancel, For you to confirm, and the error codes) come from the app's catalog |
| `app.css` | The tokens and components |

An app's server answers the routes the kit calls: `GET`, `PUT /api/preferences`, `GET /auth/session`, `POST /auth/logout`, `POST /auth/tenant`, and its own `GET /v1/me/nav` through the module proxy.
