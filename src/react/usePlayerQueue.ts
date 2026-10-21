"use client";

/**
 * Queue + transport state for a list of media items, wired to `MediaEngine`.
 * Headless: returns state, actions and the props to spread on the engine; the
 * app draws the controls. Ported from advent's AdventCalendar (queue) and
 * Player (seek), minus shuffle and variants.
 */

import { useCallback, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from "react";
import type { MediaRef } from "../core/types.ts";
import type { MediaEngineHandle, MediaEngineProps, Progress } from "./MediaEngine.tsx";

export interface QueueItem {
  id: string;
  media: MediaRef;
}

export interface PlayerQueueOptions {
  /** Item selected (paused) before anything is played. Defaults to the first. */
  initialId?: string | null;
  refreshStream?: MediaEngineProps["refreshStream"];
}

/** Range input steps: fine enough for a phone-width scrubber. */
const SEEK_STEPS = 1000;

export function usePlayerQueue(items: QueueItem[], options: PlayerQueueOptions = {}) {
  const engineRef = useRef<MediaEngineHandle>(null);
  const [currentId, setCurrentId] = useState<string | null>(options.initialId ?? items[0]?.id ?? null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [progress, setProgress] = useState<Progress>({ played: 0, playedSeconds: 0, duration: 0 });
  const [seeking, setSeeking] = useState<number | null>(null);

  const index = items.findIndex((i) => i.id === currentId);
  const current = index >= 0 ? items[index] : null;

  /** Make `id` current without starting it. */
  const cue = useCallback((id: string) => {
    setCurrentId(id);
    setProgress({ played: 0, playedSeconds: 0, duration: 0 });
    setBuffering(false);
    setPlaying(false);
  }, []);

  const select = useCallback((id: string) => {
    setCurrentId(id);
    setProgress({ played: 0, playedSeconds: 0, duration: 0 });
    setBuffering(false);
    setPlaying(true);
  }, []);

  /** Play/pause the current item, or switch to `id` and play it. */
  const toggle = useCallback(
    (id?: string) => {
      if (id === undefined || id === currentId) setPlaying((p) => !p);
      else select(id);
    },
    [currentId, select],
  );

  const step = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const from = index >= 0 ? index : 0;
      select(items[(from + delta + items.length) % items.length].id);
    },
    [items, index, select],
  );
  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  // Wrapping onto the same item wouldn't restart it (same url, already "playing"): stop instead.
  const onEnded = useCallback(() => (items.length > 1 ? next() : setPlaying(false)), [items.length, next]);

  // Consecutive failures: once every item has failed in a row, stop instead of cycling forever.
  const failuresRef = useRef(0);
  const onProgress = useCallback((p: Progress) => {
    failuresRef.current = 0;
    setProgress(p);
  }, []);
  const onError = useCallback(() => {
    failuresRef.current += 1;
    if (failuresRef.current >= items.length) {
      failuresRef.current = 0;
      setPlaying(false);
    } else {
      next();
    }
  }, [items.length, next]);

  const commitSeek = (e: PointerEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
    if (seeking === null) return; // e.g. the keyup of the Tab that focused the scrubber
    const fraction = Number(e.currentTarget.value) / SEEK_STEPS;
    engineRef.current?.seekTo(fraction);
    setProgress((p) => ({ ...p, played: fraction, playedSeconds: fraction * p.duration }));
    setSeeking(null);
  };

  /** Props for an `<input type="range">` scrubber — pointer events, so touch works too. */
  const seekInputProps = {
    type: "range" as const,
    min: 0,
    max: SEEK_STEPS,
    step: 1,
    value: Math.round((seeking ?? progress.played) * SEEK_STEPS),
    onPointerDown: () => setSeeking(progress.played),
    onChange: (e: ChangeEvent<HTMLInputElement>) => setSeeking(Number(e.target.value) / SEEK_STEPS),
    onPointerUp: commitSeek,
    // A touch drag the browser takes over as a scroll ends here, not in pointerup.
    onPointerCancel: () => setSeeking(null),
    // Keyboard scrubbing has no pointerup: commit on key release.
    onKeyUp: commitSeek,
  };

  const engineProps: MediaEngineProps & { ref: typeof engineRef } = useMemo(
    () => ({
      ref: engineRef,
      media: current?.media ?? null,
      playing,
      onProgress: seeking === null ? onProgress : undefined,
      onEnded,
      onBuffering: setBuffering,
      // A dead item must never stall the queue: skip it.
      onError,
      refreshStream: options.refreshStream,
    }),
    [current, playing, seeking, onProgress, onEnded, onError, options.refreshStream],
  );

  return {
    current,
    currentId,
    playing,
    buffering,
    progress: seeking === null ? progress : { ...progress, played: seeking, playedSeconds: seeking * progress.duration },
    toggle,
    cue,
    select,
    next,
    previous,
    seekInputProps,
    engineProps,
  };
}
