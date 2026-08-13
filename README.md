# Integro SDK — TypeScript

Generated TypeScript client for the [Integro](https://integro.social) API.

**Do not edit this repository.** Every file is machine-generated from the
Integro API definition and force-synced on every release; each sync commit
names the source revision. Pull requests cannot be accepted — every file is
replaced on the next sync — but issues are welcome here.

## Install

```sh
npm install github:integro-social/integro_typescript_sdk
```

The package ships TypeScript source (`main: ./index.ts`), so consume it from a
TS-aware toolchain (Vite, Next, tsx, bun, ...).

## Quickstart

The default API host is `https://api.integro.social`.

```ts
import { routes } from "integro_sdk/routes";
import Tapi from "integro_sdk/runtime";

const client = Tapi.builder()
  .withRoutes(routes)
  .withHost("https://api.integro.social")
  .withDefaultHeaders({ Authorization: `Bearer integro_...` }) // API key from the dashboard
  .build();

// Requires `ViewUsers` — every route's doc comment carries its permission
// contract.
const res = await client.user.count();
if (res.ok) console.log(`${res.data} users`);
```

React apps should build over `integro_sdk/runtime/react` instead — the same
builder, but every route additionally gets `.useHook` / `.useSse` / `.useWs`.

## Auth

Every request sends `Authorization: Bearer <token>`, where the token is an
Integro API key (`integro_...`, issued in the dashboard) or a user session
token. Set it at build time with `.withDefaultHeaders(...)` or later with
`client.setHeaders(...)`.

Inbound event webhooks are signed with `X-Integro-Signature`
(`sha256=<hex>`, HMAC-SHA256 over the raw body with the secret shown when the
webhook is configured).

## Layout

- `routes/` — one namespace per domain (`message`, `post`, `group`, ...); each
  route's doc comment carries the endpoint description and the exact
  permissions it requires.
- `types/` — request/response types mirroring the server's validated newtypes,
  one type per file.
- `runtime/` — the HTTP/SSE/WebSocket engine the routes run on (`runtime` is
  React-free; `runtime/react` adds the hooks).
- `PermissionCatalog.ts` — the permission groups and pt-BR labels.

## Versioning

The package version mirrors the Integro API version at the source
revision named by the latest sync commit.
