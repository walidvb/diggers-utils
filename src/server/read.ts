import { detectProvider, normalizeUrl, parseUrl } from "../core/providers.ts";
import type { MediaInfo } from "../core/types.ts";
import { fetchRelease, type FetchOptions } from "./bandcamp.ts";
import { lookupOembed } from "./oembed.ts";

export type ReadOutcome =
  | { kind: "ok"; info: MediaInfo }
  | { kind: "unsupported" } // not a YouTube / SoundCloud / Bandcamp track link
  | { kind: "not-found" } // Bandcamp release pulled (404/410)
  | { kind: "unplayable" } // Bandcamp release with nothing publicly streamable
  | { kind: "unavailable" } // Bandcamp or a short link didn't answer usefully — try again later
  | { kind: "busy" }; // the throttle said no

/** What the SoundCloud app shares. The player can't load these; the track page they redirect to it can. */
const SHORT_HOSTS = new Set(["on.soundcloud.com"]);

const isShortLink = (url: string) => SHORT_HOSTS.has(parseUrl(url)?.hostname.toLowerCase() ?? "");

/**
 * A short link's canonical target; any other link as is. Null when the short
 * link doesn't redirect to a supported link (dead, or SoundCloud didn't answer).
 */
export async function expandShortLink(raw: string, options: { fetch?: typeof fetch } = {}): Promise<string | null> {
  if (!isShortLink(raw)) return raw;
  const short = parseUrl(raw)!;
  const doFetch = options.fetch ?? fetch;
  try {
    const res = await doFetch(short, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(6000) });
    const location = res.headers.get("location");
    const target = location ? normalizeUrl(new URL(location, short).toString()) : null;
    return target && !isShortLink(target) ? target : null;
  } catch {
    return null;
  }
}

/**
 * What a pasted link is. YouTube/SoundCloud always succeed (a failed oEmbed
 * lookup just leaves the text fields empty for the user to fill); Bandcamp
 * needs its page, because the stream lives there.
 */
export async function readMedia(pasted: string, options: FetchOptions = {}): Promise<ReadOutcome> {
  if (!detectProvider(pasted)) return { kind: "unsupported" };
  const raw = await expandShortLink(pasted, options);
  if (!raw) return { kind: "unavailable" };

  const provider = detectProvider(raw);
  const url = normalizeUrl(raw);
  if (!provider || !url) return { kind: "unsupported" };

  if (provider !== "bandcamp") {
    const meta = await lookupOembed(provider, url, options);
    return {
      kind: "ok",
      info: {
        provider,
        url,
        title: meta?.title ?? "",
        artist: meta?.artist ?? "",
        artworkUrl: meta?.artworkUrl || null,
        durationSec: null, // oEmbed has none; the player reports it once playing
      },
    };
  }

  const outcome = await fetchRelease(url, options);
  switch (outcome.kind) {
    case "ok": {
      const { release } = outcome;
      if (!release.defaultTrackId) return { kind: "unplayable" };
      const track = release.tracks.find((t) => t.trackId === release.defaultTrackId)!;
      return {
        kind: "ok",
        info: {
          provider,
          url,
          title: track.title,
          artist: track.artist ?? release.artist,
          artworkUrl: release.artworkUrl,
          durationSec: track.durationSec,
          bandcamp: {
            album: release.album,
            artist: release.artist,
            albumUrl: release.albumUrl,
            tracks: release.tracks,
            defaultTrackId: release.defaultTrackId,
          },
        },
      };
    }
    case "no-tracklist":
      return { kind: "unplayable" };
    case "not-found":
      return { kind: "not-found" };
    case "busy":
      return { kind: "busy" };
    case "transient":
      return { kind: "unavailable" };
  }
}
