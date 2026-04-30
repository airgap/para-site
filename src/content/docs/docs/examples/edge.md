---
title: Edge example
description: A Cloudflare Worker in ParaScript with per-request signal scope, a derived Cache-Control header, and a Durable Object rate limiter using a `when` block for once-per-window alerting.
---

A Cloudflare Worker with per-request signal scope. Includes a derived `Cache-Control` header, and a Durable Object rate limiter that uses a `when` block to log the first time a window crosses the threshold.

The same code shape works on Vercel Edge Functions, Deno Deploy, and AWS Lambda@Edge — anywhere V8 runs without Node APIs.

## Project layout

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

    signal status = 200;
    signal bodyKind: "asset" | "json" | "error" = "json";
    signal cacheControl =
      bodyKind === "asset" ? "public, max-age=31536000, immutable" :
      bodyKind === "error" ? "public, max-age=10" :
                             "no-store";

    const id = env.RATE_LIMIT.idFromName(ip);
    const stub = env.RATE_LIMIT.get(id);
    const limitRes ..= stub.fetch("https://internal/check");
    const { allowed, remaining } ..= limitRes.json<{ allowed: boolean; remaining: number }>();

    if (!allowed) {
      status = 429;
      bodyKind = "error";
      return new Response("rate limited", {
        status,
        headers: { "Cache-Control": cacheControl, "Retry-After": "60" },
      });
    }

    bodyKind = url.pathname.startsWith("/api/") ? "json" : "asset";

    return new Response(
      JSON.stringify({ ok: true, path: url.pathname, remaining }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": cacheControl,
          "X-RateLimit-Remaining": String(remaining),
        },
      },
    );
  },
};

export class RateLimiter {
  signal count = 0;
  signal windowStart = Date.now();
  signal overLimit = count > 100;

  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    when overLimit {
      console.log(`rate limit crossed: ${count} requests in window`);
    }
  }

  async fetch(req: Request): Promise<Response> {
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

### Notes on the source

- Signals declared inside `fetch` are scoped to one request. They go out of scope when the response is returned.
- `signal cacheControl = ...` is a derived signal; the RHS reads `bodyKind`. The header value reflects whatever `bodyKind` last was at the point it's read.
- `..=` is await-assign in declaration position. `const limitRes ..= stub.fetch(...)` desugars to `const limitRes = await stub.fetch(...)`.
- The `RateLimiter` Durable Object holds long-lived per-IP signals. The `when overLimit { ... }` block fires once per false→true transition of the predicate, which corresponds to the first request of a window that crosses the threshold. Subsequent over-limit requests do not re-fire the body until `count` drops back below 100 and rises again.

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
    "build": "parabun build src/index.pts --target browser --outfile dist/index.js",
    "deploy": "parabun run build && wrangler deploy"
  },
  "dependencies": { "parabun-browser-shims": "*" },
  "devDependencies": { "@cloudflare/workers-types": "*", "wrangler": "^4" }
}
```

`--target browser` is correct for Workers — the V8 isolate runtime has web-platform globals but no Node APIs.

## Build and deploy

```bash
parabun install
parabun run deploy
```
