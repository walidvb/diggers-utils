import type { Provider } from "./providers.ts";

/** One track on a Bandcamp release, as the release page describes it. */
export interface BandcampTrack {
  trackId: string;
  title: string;
  /** The track's own page — a link that names exactly this track, even when it came off an album. */
  url: string | null;
  /** Position on the release, from 1. */
  trackNum: number | null;
  /** Only on compilations, where tracks credit different artists; null means the release's artist. */
  artist: string | null;
  /** Signed `mp3-128` URL; null when Bandcamp offers no public stream (purchase-only). */
  streamUrl: string | null;
  durationSec: number | null;
}

/** What reading a link yields. Every text field is a suggestion the user may correct. */
export interface MediaInfo {
  provider: Provider;
  /** Canonical URL (see `normalizeUrl`). */
  url: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  durationSec: number | null;
  /** Only for Bandcamp: the release's tracklist, so an album link can be narrowed to one track. */
  bandcamp?: {
    album: string;
    /** The release's artist ("Various Artists" on a compilation); `artist` above is the picked track's. */
    artist: string;
    /** The album page; null for a single that isn't on one. */
    albumUrl: string | null;
    tracks: BandcampTrack[];
    /** The track Bandcamp's own page loads first; null when nothing is streamable. */
    defaultTrackId: string | null;
  };
}

/** Everything the player needs to play one item. */
export interface MediaRef {
  provider: Provider;
  /** The page URL (YouTube/SoundCloud play this directly), or the audio file's. */
  url: string;
  /** Bandcamp only: the release's track id, used to mint a fresh stream when this one dies. */
  providerTrackId?: string | null;
  /** Bandcamp only: the stream actually played. */
  streamUrl?: string | null;
}
