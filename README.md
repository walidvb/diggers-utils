# @cucu/media

Music links for apps that store tracks from YouTube, SoundCloud and Bandcamp
and play them back in one queue.

| Entry point | What it does | Runs on |
| --- | --- | --- |
| `@cucu/media/core` | Provider detection (`detectProvider`), URL parsing and canonicalisation (`parseUrl`, `normalizeUrl`), shared types | anywhere |
| `@cucu/media/server` | Reading a pasted link: oEmbed for YouTube/SoundCloud, release pages and fresh stream URLs for Bandcamp (`readMedia`, `fetchRelease`, `resolveBandcampStream`) | server |
| `@cucu/media/client` | The same `readMedia` / `resolveBandcampStream`, answered by the hosted API instead of scraping locally | anywhere |
| `@cucu/media/react` | Headless player (`MediaEngine`, an invisible react-player) and queue/transport hook (`usePlayerQueue`) — bring your own controls | client |

Nothing here imports app code: network access (`fetch`) and Bandcamp rate
limiting (`throttle`) are injected. Keep Bandcamp requests ≥2s apart across
everything that shares a host — the throttle is the caller's job.

## Hosted API

`api/` deploys to Vercel as-is (no framework, no build step). Every app
reading Bandcamp through it shares one place that talks to Bandcamp, so the
spacing and the CDN cache cover all of them.

| Endpoint | Answers |
| --- | --- |
| `GET /api/read?url=…` | `ReadOutcome` — cached a day at the edge |
| `GET /api/stream?url=…&trackId=…` | `StreamOutcome` — a fresh stream, cached an hour |

The body is always the outcome; the status mirrors its kind (200 ok, 404
not-found, 422 unsupported/unplayable, 502 unavailable, 503 busy with
`Retry-After`). Only lasting outcomes are cached. CORS is open, so a browser
can call it too.

It's deployed at `https://diggers-utils.vercel.app` (Vercel project
`diggers-utils`, team cucus), which the client calls by default:

```ts
import { readMedia, resolveBandcampStream } from "@cucu/media/client";

const outcome = await readMedia(pasted);
```

`createMediaClient({ baseUrl })` points at another deployment, e.g. a preview.

Bandcamp spacing on the API is per function instance: concurrent instances
each keep their own 2s spacing.

## Install

```bash
pnpm add github:walidvb/diggers-utils#v0.1.1 react-player@2.16.1
```

`react`, `react-dom` and `react-player` are peer dependencies. react-player is
pinned to **v2**: v3 dropped SoundCloud and the other non-YouTube providers.

The package ships TypeScript source (no build step), so the consumer's bundler
must compile it. In Next.js:

```ts
// next.config.ts
const nextConfig = { transpilePackages: ["@cucu/media"] };
```

Its imports name the real files (`./providers.ts`), so a consumer that
type-checks it needs `"allowImportingTsExtensions": true` in its tsconfig —
allowed alongside `noEmit`, which Next.js projects already have.

## Develop

```bash
pnpm install
pnpm typecheck
pnpm test
```

Relative imports carry a `.js` extension (`./bandcamp.js`, `../server/index.js`):
Vercel runs `api/` as plain Node ESM, which resolves neither extensionless
nor directory imports.

Tests run against saved Bandcamp pages in `test/fixtures` and never touch the
network.
