/**
 * The hosted API (`api/`), from any app's server or browser. Same outcomes as
 * `@cucu/media/server`, without each app scraping Bandcamp — and sharing its
 * rate limit — on its own.
 */

import type { ReadOutcome, StreamOutcome } from "../server/index.ts";

/** Where `api/` is deployed (Vercel project `diggers-utils`, team cucus). */
export const DEFAULT_BASE_URL = "https://diggers-utils.vercel.app";

export interface MediaClientOptions {
  /** Another deployment of `api/`, e.g. a preview. Defaults to `DEFAULT_BASE_URL`. */
  baseUrl?: string;
  /** Injected so tests never touch the network. Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** The API may queue a request a few seconds for Bandcamp, then fetch for up to 10s. */
const TIMEOUT_MS = 20_000;

export function createMediaClient({ baseUrl = DEFAULT_BASE_URL, fetch: doFetch = fetch }: MediaClientOptions = {}) {
  /** The outcome the API answered, or `fallback` when it didn't answer one. Never throws. */
  async function get<T extends { kind: string }>(path: string, params: Record<string, string>, fallback: T): Promise<T> {
    const url = new URL(path, baseUrl);
    url.search = new URLSearchParams(params).toString();
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = (await res.json()) as Partial<T>;
      return typeof body?.kind === "string" ? (body as T) : fallback;
    } catch {
      return fallback;
    }
  }

  return {
    /** See `readMedia` in `@cucu/media/server`. */
    readMedia: (url: string) => get<ReadOutcome>("/api/read", { url }, { kind: "unavailable" }),
    /** See `resolveBandcampStream` in `@cucu/media/server`. */
    resolveBandcampStream: (pageUrl: string, trackId: string) =>
      get<StreamOutcome>("/api/stream", { url: pageUrl, trackId }, { kind: "transient" }),
  };
}

export type MediaClient = ReturnType<typeof createMediaClient>;

/** The hosted API at `DEFAULT_BASE_URL`, ready to call. */
export const { readMedia, resolveBandcampStream } = createMediaClient();
