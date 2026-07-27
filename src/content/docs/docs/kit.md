---
title: "@lyku/para-kit"
description: The fullstack projection for Para sync — emits escape-analyzed server artifacts from .pui declarations, hosts them, and bridges SyncEnvelopes over SSE. SvelteKit-shaped, web-standard underneath.
---

```ts
import { createServerSourceHost, createSyncEndpoint, createSseTransport } from "@lyku/para-kit";
```

The build + runtime glue that turns [`.pui` sync declarations](/docs/sync/)
into a running app (the spec's **P9** projection): `para-kit emit` writes
the server artifacts and manifest, a host runs them, and one endpoint
streams `SyncEnvelope`s to the browser over SSE. The handlers are
SvelteKit-shaped but built on pure web standards
(`Request`/`Response`/`ReadableStream`), so they run anywhere those exist.

## The loop

```
.pui ──para-kit emit──▶ *.server-sources.pts + para-sync-manifest.js
                            ▼
        createServerSourceHost(serverSources, { transport })
                            ▼   one createServerSource per LIVE key
        createSyncEndpoint({ transport, host })      ← routes/para-sync/+server.ts
                            ▼   SSE: baseline + every publish
        createSseTransport({ url, eventSource })
                            ▼   the para-sync dumb-pipe contract
        the .pui binding — synced(subKey(declId, params), Schema)
```

## `para-kit emit`

```sh
para-kit emit src            # artifacts + manifest (+ endpoint, once)
para-kit emit src --check    # CI drift gate — fails if anything is stale
```

Walks the tree for `.pui` files, runs the same escape analysis the
preprocessor runs inline (same `moduleId`, so **client subscription keys
equal host keys by construction**), and writes:

- `<name>.server-sources.pts` next to each `.pui` — the readable, ejectable
  server module (`__paraServerSources`: one `{ name, declId, schema, params,
  policy, run }` per declaration). Regenerated boundary files — re-run
  `emit`, don't hand-edit.
- one flat app manifest (`$lib/para-sync-manifest.js`).
- the conventional endpoint route — written **once**, never regenerated:
  yours to edit from the first byte.

## Runtime pieces

**`createServerSourceHost(serverSources, { transport })`** — lazily starts
one [`createServerSource`](/docs/sync/#server-sources--createserversource)
per *live* subscription key: N clients on one key share one timer and one
sequence stream; distinct params are distinct channels.
`host.seedFor(declId, params)` runs/ensures a source and returns its current
envelope — the SSR seed for a `+page.server.ts` load.

**`createSyncEndpoint({ transport, host, onIntent })`** — `GET` reads
`?key=…&key=…`, ensures any server sources behind them, sends each current
envelope as the baseline, then streams every transport publish for those
keys. It subscribes *before* seeding, so no publish is lost in the gap.
`POST` delegates [§13.1 intents](/docs/sync/#writes--mutate-queue-transactions)
to your `onIntent` (501 without one).

**`createSseTransport({ url, eventSource })`** — the client read-side
transport. Key-set changes coalesce into one reconnect per microtask; a
**late joiner** on an already-open key is replayed the last envelope
(idempotent — envelopes carry sequences); `publish` throws, because the
read path is one-directional: writes cross as POST intents.

```js
import { configureSynced } from "@lyku/para-sync";
import { createSseTransport } from "@lyku/para-kit";

configureSynced({
  transport: createSseTransport({
    url: "/para-sync",
    eventSource: (u) => new EventSource(u),
  }),
});
```

## Spec

[Ch. 11 §2, projection P9](/spec/11-modules-projections-and-build/) — nine
projections, one spine — and the server-source semantics in
[ch. 08 §13.8](/spec/08-data-sync-and-authority/).
