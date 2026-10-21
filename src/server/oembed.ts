/**
 * Title, artist and artwork for YouTube and SoundCloud links via oEmbed —
 * no key, no quota. Ported from advent (src/lib/track-metadata.ts).
 *
 * Everything here is a suggestion: a failed, slow or empty lookup is a normal
 * outcome and the user types the fields themselves. Nothing here throws.
 */

import type { Provider } from "../core/providers.ts";

export interface OembedMetadata {
  title: string;
  artist: string;
  artworkUrl: string;
}

const ENDPOINTS: Partial<Record<Provider, string>> = {
  youtube: "https://www.youtube.com/oembed",
  soundcloud: "https://soundcloud.com/oembed",
};

/** How long someone waits before we give up and let them type it. */
const TIMEOUT_MS = 6000;

type OembedResponse = { title?: string; author_name?: string; thumbnail_url?: string };

export async function lookupOembed(
  provider: Provider,
  url: string,
  options: { fetch?: typeof fetch } = {},
): Promise<OembedMetadata | null> {
  const endpoint = ENDPOINTS[provider];
  if (!endpoint) return null;
  const doFetch = options.fetch ?? fetch;
  try {
    const res = await doFetch(`${endpoint}?format=json&url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A private, deleted or mistyped link is a 401/403/404 here. Nothing to say.
    if (!res.ok) return null;
    const metadata = splitOembed((await res.json()) as OembedResponse);
    return metadata.title || metadata.artist || metadata.artworkUrl ? metadata : null;
  } catch {
    return null;
  }
}

/**
 * oEmbed has no "artist" — only the uploader's title and account, so the
 * artist is read out of the title. SoundCloud writes "Awake by Tycho"; YouTube
 * uploaders write "Artist - Track (Official Video)", where the channel is often
 * a label. Both are guesses, which is why every field stays editable.
 */
export function splitOembed({ title = "", author_name = "", thumbnail_url = "" }: OembedResponse): OembedMetadata {
  const author = author_name.trim();
  let name = title.trim();
  let artist = author;

  const suffix = ` by ${author}`;
  if (author && name.toLowerCase().endsWith(suffix.toLowerCase())) {
    name = name.slice(0, -suffix.length).trim();
  } else {
    // Exactly one dash: "Artist - Track". Two or more and we guess wrong as
    // often as right, so leave it whole.
    const parts = name.split(/\s+[-–—]\s+/);
    if (parts.length === 2 && parts[0] && parts[1]) {
      artist = parts[0].trim();
      name = parts[1].trim();
    }
  }
  return { title: name, artist, artworkUrl: thumbnail_url.trim() };
}
