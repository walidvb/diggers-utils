/**
 * Bandcamp release pages → tracklist with playable streams.
 *
 * Ported from bandcamp-digger (src/lib/bandcamp.ts + BANDCAMP.md). Two traps:
 * (1) a fetch without browser-like headers gets a stripped page with no
 * `data-tralbum`; (2) the stripped page's `data-audiourl` attributes belong to
 * the footer's recommended releases — real, playable, and the wrong music.
 * Always read `data-tralbum`, never `data-audiourl`.
 *
 * Stream URLs are signed but long-lived (a 37-day-old one still played), so
 * callers store them and only come back here when playback fails.
 *
 * Rate limiting is the caller's job, through `throttle`: Bandcamp starts
 * failing requests spaced closer than ~2s, and one app's traffic must never get
 * the host flagged for every other app sharing it.
 */

import type { BandcampTrack } from "../core/types.ts";

export interface FetchOptions {
  /** Injected so tests never touch the network. Defaults to global fetch. */
  fetch?: typeof fetch;
  /**
   * Claims a slot to hit Bandcamp. Resolve `true` to go ahead, `false` when
   * the budget is spent — the call then returns `busy` without fetching.
   */
  throttle?: () => Promise<boolean>;
}

export interface Release {
  /** Which kind of page this was read from. */
  kind: "album" | "track";
  /** The page's canonical URL, as Bandcamp gives it. */
  url: string | null;
  /** The album page: this page on an album, the album a `/track/` page belongs to, null for a lone single. */
  albumUrl: string | null;
  artist: string;
  /** Album title on an album page; the track title on a `/track/` page. */
  album: string;
  tracks: BandcampTrack[];
  /** The track Bandcamp's own page loads first; null when nothing is publicly streamable. */
  defaultTrackId: string | null;
  artworkUrl: string | null;
}

export type ReleaseOutcome =
  | { kind: "ok"; release: Release }
  | { kind: "no-tracklist" }
  | { kind: "not-found" } // 404/410: the release was pulled — permanent, never retry
  | { kind: "transient" } // network error, 5xx, stripped page — retry later
  | { kind: "busy" }; // the throttle said no

interface RawTrackInfo {
  track_id?: number | string;
  title?: string;
  /** Page-relative, e.g. `/track/key`. */
  title_link?: string | null;
  track_num?: number | null;
  /** Set on compilations only. */
  artist?: string | null;
  duration?: number;
  file?: { "mp3-128"?: string } | null;
}

interface RawTralbum {
  /** Absolute canonical URL of the page. */
  url?: string;
  item_type?: string;
  /** `/track/` pages that are part of an album: page-relative. */
  album_url?: string | null;
  artist?: string;
  art_id?: number | string;
  /** Album pages: the track Bandcamp's own player starts on. */
  featured_track_id?: number | string | null;
  current?: RawTrackInfo & { art_id?: number | string };
  trackinfo?: RawTrackInfo[];
}

/** The full set from BANDCAMP.md. Browsers add the Sec-Fetch-* ones themselves; Node does not. */
export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

/** A release page is ~200 KB; past this, treat Bandcamp as unavailable rather than hang a request. */
const TIMEOUT_MS = 10_000;

const NAMED: Record<string, string> = { quot: '"', apos: "'", amp: "&", lt: "<", gt: ">" };

/** Attribute-value entity decoding: the five named ones plus numeric (`&#39;`, `&#x27;`). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (match, body: string) => {
    if (body[0] !== "#") return NAMED[body.toLowerCase()] ?? match;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

const artworkUrlFromId = (artId: number | string | undefined | null) =>
  artId === undefined || artId === null ? null : `https://f4.bcbits.com/img/a${artId}_10.jpg`;

/** `link` made absolute against the page it was read from; null when either is missing or nonsense. */
function absolute(link: string | null | undefined, base: string | undefined): string | null {
  if (!link) return null;
  try {
    return new URL(link, base).toString();
  } catch {
    return null;
  }
}

function toTrack(t: RawTrackInfo, pageUrl: string | undefined): BandcampTrack {
  return {
    trackId: String(t.track_id),
    title: t.title ?? "",
    url: absolute(t.title_link, pageUrl),
    trackNum: typeof t.track_num === "number" ? t.track_num : null,
    artist: t.artist || null,
    streamUrl: t.file?.["mp3-128"] ?? null,
    durationSec: typeof t.duration === "number" ? t.duration : null,
  };
}

/**
 * An already-parsed `data-tralbum` blob as a release. Keeps tracks without a
 * public stream (`streamUrl: null`) so the tracklist matches Bandcamp's page.
 */
export function parseTralbum(blob: RawTralbum): Release | null {
  let tracks = (blob.trackinfo ?? []).filter((t) => t.track_id != null).map((t) => toTrack(t, blob.url));

  // A standalone /track/ page's `trackinfo` is sometimes empty, or missing the
  // track itself — its data lives in `current`. Fold it in.
  const current = blob.current?.track_id != null ? toTrack(blob.current, blob.url) : null;
  if (current && !tracks.some((t) => t.trackId === current.trackId)) tracks = [current, ...tracks];

  if (tracks.length === 0) return null;

  // The track Bandcamp's own page starts on: the page's own track, else the
  // album's featured one, else the first with a public stream.
  const playable = tracks.filter((t) => t.streamUrl);
  const pick = (id: string | undefined) => (id ? playable.find((t) => t.trackId === id) : undefined);
  const defaultTrack =
    pick(current?.trackId) ?? pick(blob.featured_track_id?.toString()) ?? playable[0] ?? null;

  const kind = blob.item_type === "track" ? "track" : "album";
  return {
    kind,
    url: blob.url ?? null,
    albumUrl: kind === "album" ? (blob.url ?? null) : absolute(blob.album_url, blob.url),
    artist: blob.artist ?? "",
    album: blob.current?.title ?? tracks[0].title,
    tracks,
    defaultTrackId: defaultTrack?.trackId ?? null,
    artworkUrl: artworkUrlFromId(blob.current?.art_id ?? blob.art_id),
  };
}

/** The `data-tralbum` blob out of a release page's HTML, or null (stripped page, or not a release). */
export function extractTralbum(html: string): RawTralbum | null {
  const match = /data-tralbum="([^"]*)"/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(decodeEntities(match[1])) as RawTralbum;
  } catch {
    return null;
  }
}

/** Fetch a release page and read its tracklist. Never throws. */
export async function fetchRelease(url: string, options: FetchOptions = {}): Promise<ReleaseOutcome> {
  const doFetch = options.fetch ?? fetch;
  if (options.throttle && !(await options.throttle())) return { kind: "busy" };

  let res: Response;
  try {
    res = await doFetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "transient" };
  }
  if (res.status === 404 || res.status === 410) return { kind: "not-found" };
  if (!res.ok) return { kind: "transient" };

  let html: string;
  try {
    html = await res.text();
  } catch {
    return { kind: "transient" };
  }
  const blob = extractTralbum(html);
  if (!blob) return { kind: "transient" }; // most likely a stripped page — worth retrying later

  const release = parseTralbum(blob);
  return release ? { kind: "ok", release } : { kind: "no-tracklist" };
}

export type StreamOutcome =
  | { kind: "ok"; streamUrl: string }
  | { kind: "unplayable" } // the track is gone from the release, or has no public stream
  | Exclude<ReleaseOutcome, { kind: "ok" } | { kind: "no-tracklist" }>;

/**
 * A freshly signed stream for one track of a release — for when a stored one
 * stopped playing. Re-fetches the page; signatures are minted per page load.
 */
export async function resolveBandcampStream(
  pageUrl: string,
  trackId: string,
  options: FetchOptions = {},
): Promise<StreamOutcome> {
  const outcome = await fetchRelease(pageUrl, options);
  if (outcome.kind === "no-tracklist") return { kind: "unplayable" };
  if (outcome.kind !== "ok") return outcome;
  const streamUrl = outcome.release.tracks.find((t) => t.trackId === trackId)?.streamUrl;
  return streamUrl ? { kind: "ok", streamUrl } : { kind: "unplayable" };
}
