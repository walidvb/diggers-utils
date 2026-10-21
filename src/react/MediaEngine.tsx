"use client";

/**
 * Headless player for YouTube, SoundCloud, Bandcamp and audio-file items: renders an
 * invisible react-player and reports progress. Bring your own controls.
 *
 * Pinned to react-player v2 — v3 dropped SoundCloud. Behaviour ported from
 * advent (src/app/advent/Player.tsx); stream refresh on error ported from
 * bandcamp-digger (src/hooks/usePlayer.ts).
 */

import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type ReactPlayerType from "react-player";
import type { OnProgressProps } from "react-player/base";
import type { MediaRef } from "../core/types.ts";

// v2 renders nothing on the server and mounts its player on the client, so it
// is loaded client-only (see `mounted` below) to keep hydration clean.
const ReactPlayer = lazy(() => import("react-player"));

// youtube-nocookie serves the same player without setting cookies the moment a
// track starts. The IFrame API *script* still comes from youtube.com —
// react-player hardcodes it. `forceAudio`: Bandcamp streams have no file
// extension, so v2 falls back to its FilePlayer, which would render a <video>.
const PLAYER_CONFIG = {
  youtube: { embedOptions: { host: "https://www.youtube-nocookie.com" } },
  file: { forceAudio: true },
};

export interface Progress {
  /** 0–1 */
  played: number;
  playedSeconds: number;
  /** Seconds; 0 until the provider knows. */
  duration: number;
}

export interface MediaEngineProps {
  media: MediaRef | null;
  playing: boolean;
  onProgress?: (progress: Progress) => void;
  onEnded?: () => void;
  onBuffering?: (buffering: boolean) => void;
  /** Called when an item can't be played, after any stream refresh was tried. */
  onError?: (error: unknown) => void;
  /**
   * Bandcamp only: mint a fresh stream for an item whose stored one failed.
   * Resolve the new URL, or null if there is none. Tried once per item.
   */
  refreshStream?: (media: MediaRef) => Promise<string | null>;
}

export interface MediaEngineHandle {
  seekTo: (fraction: number) => void;
}

const keyOf = (m: MediaRef) => `${m.provider}|${m.url}|${m.providerTrackId ?? ""}`;

export const MediaEngine = forwardRef<MediaEngineHandle, MediaEngineProps>(function MediaEngine(
  { media, playing, onProgress, onEnded, onBuffering, onError, refreshStream },
  ref,
) {
  const playerRef = useRef<ReactPlayerType | null>(null);
  const [mounted, setMounted] = useState(false);
  // A refreshed stream for the current item, and which item it (or a refresh attempt) belongs to.
  const [refreshed, setRefreshed] = useState<{ key: string; url: string | null } | null>(null);
  const triedRef = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);

  useImperativeHandle(ref, () => ({
    seekTo: (fraction) => playerRef.current?.seekTo(fraction, "fraction"),
  }));

  const key = media ? keyOf(media) : null;
  const playableUrl = !media
    ? undefined
    : media.provider === "bandcamp"
      ? ((refreshed?.key === key ? refreshed.url : null) ?? media.streamUrl ?? undefined)
      : media.url;

  // Duration is read off the player on every tick rather than from
  // `onDuration`: v2 fires that once per url, and on SoundCloud the widget's
  // PLAY event beats its own duration lookup, so it reports the previous
  // track's length and never corrects itself.
  const handleProgress = useCallback(
    (state: OnProgressProps) =>
      onProgress?.({
        played: state.played,
        playedSeconds: state.playedSeconds,
        duration: playerRef.current?.getDuration() ?? 0,
      }),
    [onProgress],
  );

  // The item on now, so a slow refresh doesn't act on one the user has since left.
  const currentKeyRef = useRef(key);
  useEffect(() => {
    currentKeyRef.current = key;
  }, [key]);

  const handleError = useCallback(
    async (error: unknown) => {
      if (!media || !key) return;
      // Stored Bandcamp signatures last weeks, not forever: mint a new one,
      // once per item — a second failure is reported, never looped.
      if (media.provider === "bandcamp" && refreshStream && triedRef.current !== key) {
        triedRef.current = key;
        const fresh = await refreshStream(media).catch(() => null);
        // The same URL back (e.g. a server-side cooldown) would just sit there, errored.
        if (fresh && fresh !== playableUrl) {
          setRefreshed({ key, url: fresh });
          return;
        }
        if (currentKeyRef.current !== key) return;
      }
      onError?.(error);
    },
    [media, key, playableUrl, refreshStream, onError],
  );

  // An item with nothing to play (a pulled Bandcamp release) fails like a
  // broken one, or the queue would sit on it in silence. Reported once per
  // item and play, through the latest `handleError`.
  const handleErrorRef = useRef(handleError);
  useEffect(() => {
    handleErrorRef.current = handleError;
  });
  useEffect(() => {
    if (mounted && key && !playableUrl && playing) void handleErrorRef.current(new Error("Nothing to play"));
  }, [mounted, key, playableUrl, playing]);

  if (!mounted || !playableUrl) return null;

  return (
    <div style={{ display: "none" }} aria-hidden>
      <Suspense fallback={null}>
        {/* One player for the whole queue: swapping `url` rather than
            remounting lets react-player reuse the provider's player when
            consecutive items share a provider. */}
        <ReactPlayer
          url={playableUrl}
          config={PLAYER_CONFIG}
          playing={playing}
          playsinline
          onReady={(player: ReactPlayerType) => {
            playerRef.current = player;
          }}
          onProgress={handleProgress}
          onEnded={onEnded}
          onBuffer={() => onBuffering?.(true)}
          onBufferEnd={() => onBuffering?.(false)}
          onError={handleError}
          width="1000"
          height="1000"
        />
      </Suspense>
    </div>
  );
});
