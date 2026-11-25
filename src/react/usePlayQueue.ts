"use client";

/**
 * A play queue (see core/playQueue) wired to `MediaEngine`: what's on, Queued, the rest of what
 * it's playing from, and what played before. It decides what plays next, so a track ending,
 * Next and errors all go through it; `usePlayerQueue` does the transport (play, pause, seek).
 * Headless: spread `engineProps` on one `MediaEngine`, draw the rest.
 */

import { useMemo, useRef, useState } from "react";
import {
  advance,
  clearQueue,
  cue as cueIn,
  emptyPlayQueue,
  enqueue as enqueueIn,
  follow as followIn,
  jump,
  playFrom as playFromIn,
  previous as previousIn,
  rest as restOf,
  upNext,
  type PlayQueueState,
  type PlayQueueThen,
} from "../core/playQueue.ts";
import type { MediaEngineProps, Progress } from "./MediaEngine.tsx";
import { usePlayerQueue, type QueueItem } from "./usePlayerQueue.ts";

export interface PlayQueueOptions<T extends QueueItem> {
  /** A fresh stream for `item`, whose stored one stopped playing (Bandcamp's expire), or null. */
  refreshStream?: (item: T) => Promise<string | null>;
}

/** Where a source comes from, and what to play once it runs out. */
export interface PlayFrom<T> {
  source?: string;
  then?: PlayQueueThen<T> | null;
}

export function usePlayQueue<T extends QueueItem>({ refreshStream }: PlayQueueOptions<T> = {}) {
  const [s, setS] = useState<PlayQueueState<T>>(emptyPlayQueue);
  // Every track the queue knows, so the transport can find what's on (and go back to what was).
  const items = useMemo(() => {
    const seen = new Map<string, T>();
    for (const t of [s.now, ...s.played, ...s.ahead, ...s.queued, ...s.from]) if (t && !seen.has(t.id)) seen.set(t.id, t);
    return [...seen.values()];
  }, [s.now, s.played, s.ahead, s.queued, s.from]);
  const player = usePlayerQueue(items);

  // Whether what's on has actually played some (so it counts as heard), and how many tracks in a
  // row have failed (once every one has, it stops instead of cycling).
  const heard = useRef(false);
  const failures = useRef(0);

  /** Make `next` the state; start (or only cue) what's on in it. */
  const commit = (next: PlayQueueState<T> | null, start = true) => {
    if (!next?.now) return;
    heard.current = false;
    setS(next);
    if (start) player.select(next.now.id);
    else player.cue(next.now.id);
  };
  const move = () => ({ heard: heard.current });

  const playFrom = (list: T[], t: T, { source, then }: PlayFrom<T> = {}) =>
    commit(playFromIn(s, list, t, { ...move(), source: source ?? null, then: then ?? null }));
  /** Cue the first of `list` (loaded, not started) when nothing is on yet. */
  const cue = (list: T[], { source, then }: PlayFrom<T> = {}) => {
    if (!s.now) commit(cueIn(s, list, { source: source ?? null, then: then ?? null }), false);
  };
  /** What's next comes from `list`, from `at` on (nothing on yet: `list[at]` is cued). */
  const follow = (list: T[], at: number, { source, then }: PlayFrom<T> = {}) => {
    const n = followIn(s, list, at, { source: source ?? null, then: then ?? null });
    if (s.now) setS(n);
    else commit(n, false);
  };
  /** A track already in Queued or the rest: on to it. */
  const play = (t: T) => commit(jump(s, t, move()));
  const next = () => {
    const n = advance(s, move());
    if (n) commit(n);
    else if (player.playing) player.toggle();
  };
  const previous = () => commit(previousIn(s));
  const toggle = () => {
    if (!s.started) setS({ ...s, started: true });
    player.toggle();
  };

  const { onProgress } = player.engineProps;
  const engineProps: MediaEngineProps & { ref: typeof player.engineProps.ref } = {
    ...player.engineProps,
    onEnded: next,
    onError: () => {
      failures.current += 1;
      if (failures.current >= items.length) {
        failures.current = 0;
        if (s.now) player.cue(s.now.id);
        return;
      }
      // Skipped; before the first tap, only the cue moves (nothing starts on its own).
      commit(advance(s, { heard: false, start: s.started }), s.started);
    },
    onProgress:
      onProgress &&
      ((p: Progress) => {
        failures.current = 0;
        if (p.playedSeconds > 0) heard.current = true;
        onProgress(p);
      }),
    refreshStream: refreshStream
      ? async (media) => {
          const t = items.find((x) => x.media === media);
          return t ? refreshStream(t) : null;
        }
      : undefined,
  };

  return {
    now: s.now,
    /** Something has been played (else `now` is only cued). */
    started: s.started,
    source: s.source,
    /** What it carries on with once the rest runs out (its source name), if anything. */
    after: s.then?.source ?? null,
    queued: s.queued,
    /** What follows Queued: tracks gone back from, then the rest of what it's playing from. */
    rest: useMemo(() => restOf(s), [s]),
    hasNext: upNext(s) !== null || s.then !== null,
    hasPrevious: s.played.length > 0,
    playing: s.started && player.playing,
    buffering: player.buffering,
    progress: player.progress,
    seekInputProps: player.seekInputProps,
    engineProps,
    playFrom,
    cue,
    follow,
    play,
    toggle,
    next,
    previous,
    /** Into Queued before the queued track `before`, or last; several (an album's tracks) keep their order. */
    enqueue: (t: T | T[], before: string | null = null) =>
      setS((prev) => (Array.isArray(t) ? t : [t]).reduce((acc, x) => enqueueIn(acc, x, before), prev)),
    clear: () => setS(clearQueue),
  };
}

export type PlayQueue<T extends QueueItem> = ReturnType<typeof usePlayQueue<T>>;
