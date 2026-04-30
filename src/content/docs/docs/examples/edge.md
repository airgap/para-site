---
title: Edge — ParaScript on Cloudflare Workers
description: A worked ParaScript example — Cloudflare Worker with reactive request-scoped state, per-route handlers, and edge-triggered rate limiting. No Node, no Bun runtime — runs on Workers' V8 isolates.
---

A Cloudflare Worker with reactive per-request state. Each request gets a small reactive scope; an edge-triggered `when` block fires the first time a rate-limit threshold is crossed; a derived signal computes a `Cache-Control` header from request metadata.

The pattern works the same way on Vercel Edge Functions, Deno Deploy, AWS Lambda@Edge, or anywhere else V8 runs without Node APIs.

## What you build

A Worker that:

- Routes `/api/*` requests to a JSON handler with reactive per-request state.
- Tracks per-IP request counts in a Durable Object (state stored as signals so the Worker can react to threshold crossings without polling).
- Returns a `Cache-Control` header derived from the response shape — public assets get long TTL, JSON gets none, errors get short.

## File layout

```
my-worker/
├── src/index.pts
├── wrangler.jsonc
├── package.json
└── tsconfig.json
```

## src/index.pts

```pts
export interface Env {
  RATE_LIMIT: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";

    // Per-request reactive scope
    signal status = 200;
    signal contentType = "application/json";
    signal bodyKind: "asset" | "json" | "error" = "json";

    // Derived: Cache-Control header from the response shape.
    signal cacheControl =
      bodyKind === "asset" ? "public, max-age=31536000, immutable" :
      bodyKind === "error" ? "public, max-age=10" :
                             "no-store";

    // Rate limit check via Durable Object
    const id = env.RATE_LIMIT.idFromName(ip);
    const stub = env.RATE_LIMIT.get(id);
    const limitRes ..= stub.fetch("https://internal/check");
    const { allowed, remaining } ..= limitRes.json<{ allowed: boolean; remaining: number }>();

    if (!allowed) {
      status = 429;
      bodyKind = "error";
      return new Response("rate limited", {
        status, headers: { "Cache-Control": cacheControl, "Retry-After": "60" }
      });
    }

    // Route dispatch
    const body = url.pathname.startsWith("/api/")
      ? JSON.stringify({ ok: true, path: url.pathname, remaining })
      : await env.RATE_LIMIT.idFromName("default").toString(); // demo asset path

    bodyKind = url.pathname.startsWith("/api/") ? "json" : "asset";

    return new Response(body, {
      status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "X-RateLimit-Remaining": String(remaining),
      }
    });
  },
};

// ---- Durable Object: per-IP rate limiter ----

export class RateLimiter {
  signal count = 0;
  signal windowStart = Date.now();
  signal overLimit = count > 100;     // derived

  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    // Fires once per false→true transition of the predicate. The DO logs
    // the first crossing — subsequent over-limit requests don't re-log.
    when overLimit {
      console.log(`rate limit crossed: ${count} requests in window`);
    }
  }

  async fetch(req: Request): Promise<Response> {
    // Reset window every minute
    if (Date.now() - windowStart > 60_000) {
      count = 0;
      windowStart = Date.now();
    }
    count++;

    return Response.json({
      allowed: !overLimit,
      remaining: Math.max(0, 100 - count),
    });
  }
}
```

## wrangler.jsonc

```jsonc
{
  "name": "my-worker",
  "main": "dist/index.js",
  "compatibility_date": "2026-04-30",
  "durable_objects": {
    "bindings": [{ "name": "RATE_LIMIT", "class_name": "RateLimiter" }],
  },
  "migrations": [{ "tag": "v1", "new_classes": ["RateLimiter"] }],
}
```

## package.json

```json
{
  "name": "my-worker",
  "type": "module",
  "scripts": {
    "build": "bun build src/index.pts --target browser --outfile dist/index.js",
    "dev": "bun build src/index.pts --watch --target browser --outfile dist/index.js & wrangler dev",
    "deploy": "bun run build && wrangler deploy"
  },
  "dependencies": { "parabun-browser-shims": "*" },
  "devDependencies": { "@cloudflare/workers-types": "*", "wrangler": "^4" }
}
```

`--target browser` is correct for Workers — the V8 isolate runtime has no Node APIs but does have web-platform globals. The shim package targets ES2022 and uses no Node-only APIs.

## What's happening

- **Per-request reactive scope** — `signal` declarations inside `fetch()` are local to that one request. Nothing leaks between requests; signals go out of scope when the response is returned.
- **`signal cacheControl = ...`** — auto-promotes to a derived signal because the RHS reads `bodyKind`. The header value computes lazily; if you read it once at the end of the handler, you get the value reflecting whatever `bodyKind` last was.
- **`..=` (await-assign)** — `const limitRes ..= stub.fetch(...)` desugars to `const limitRes = await stub.fetch(...)`. Saves the doubled `await` token in chains where every step is async.
- **Durable Object with signals** — the DO is long-lived, so its signals persist across requests *for the same key*. Each IP gets its own DO instance with its own `count` / `windowStart` / `overLimit` state. The `when overLimit { ... }` block fires once when the threshold is first crossed in a window, even if many subsequent requests stay over.
- **Edge-triggered cleanup** — without `when`, you'd write `if (overLimit && !wasOverLimit) { ... } wasOverLimit = overLimit;` by hand. The previous-value tracking is the part that's easy to get wrong.

## Without ParaScript

Plain TypeScript Workers code typically:

- Uses `Object` literals or class fields for request-scoped state. No declarative dependency tracking — if computing `cacheControl` from `bodyKind` needs to happen at the end, you write the conditional twice or stash the result.
- Tracks "first time over the rate limit" manually with a `Boolean` field on the DO. Easy to forget to reset; common source of "rate limit alert spam" bugs.
- Uses `await` everywhere even in long chains. The `..=` operator isn't life-changing on its own, but in a chain of 4 awaits in a row it visibly cleans up.

## Build &amp; deploy

```bash
bun install
bun run build              # → dist/index.js (Workers bundle)
bunx wrangler deploy
```

Works on Cloudflare Workers free tier. The shim package adds ~10 KB gzipped to the bundle. The whole reactive layer is tracked at parse time, so there's no startup-cost penalty for the syntax.

## Variants

- **Vercel Edge Functions**: same code; replace `wrangler` with `vercel` in `package.json`. Vercel honors web-platform handlers.
- **Deno Deploy**: change the entry to `Deno.serve(fetch)` style; the body of `fetch` stays identical. The shim package works on Deno.
- **AWS Lambda@Edge**: same `--target browser` build; wrap the export in the Lambda@Edge adapter shape.
