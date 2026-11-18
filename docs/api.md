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
| `Menu` | The account menu, with `Initial()` |
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

## The web kit

`web/` is the TypeScript and React every t10 web app shares; [`web/README.md`](../web/README.md) explains each part.

| File | Exports |
| --- | --- |
| `api.ts` | `postJSON`, `ApiError`, `newTurnId`, `onSignedOut`, `announceSignedOut`, `onModuleGone` |
| `session.ts` | `watchSession`, `signIn`, `signInHref`, `keepDraftsFor`, `SignInReason` |
| `preferences.ts` | `useSavedPreferences` |
| `theme.ts` | `useTheme`, `applyTheme`, `setTheme`, `Theme` |
| `i18n.tsx` | `I18nProvider`, `useI`, `I`, `Language`. Each app passes its own catalog |
| `frame.tsx` | `Frame`, `Rail`, `AccountMenu`, `SectionLinks`, `OtherPlaces`, `groupSections`, `sectionCount`, `accountHref`, `focusMenuButton`, `maskIcon`, `Icon`, `NavSection`, `NavGroup`, `NAV`, `RailApp`, `CONSOLE`, `WORKBENCH` |
| `command.tsx` | `Palette`, `SearchButton`, `useSearchShortcut`, `SHORTCUT`, `Bell`, `BellItem`, `PaletteEntry` |
| `ask.tsx` | `AskPanel`, `AskButton`, `AskTransport`, `AskMessage` |
| `ui.tsx` | `Dialog`, `Menu`, `Segmented`, `Setting`, `Skeleton`, `Empty`, `Avatar`, `CopyButton`, `Logo`, `LanguageSwitch`, `ErrorBoundary`, `FeedbackProvider`, `useFeedback` |
| `storage.ts` | `load`, `save` |
| `layout.ts` | `useMedia`, `navigateOptions`, `RESULTS` |
| `app.css` | The tokens and components |

An app's server answers the routes the kit calls: `GET`, `PUT /api/preferences`, `GET /auth/session`, `POST /auth/logout`, `POST /auth/tenant`, and its own `GET /v1/me/nav` through the module proxy.
