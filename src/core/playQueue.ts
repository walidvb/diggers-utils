/**
 * What plays when: the track on now, the tracks queued by hand (played first, in the order
 * they're put), then the rest of a source list (what it's "playing from"), and what was heard
 * before. Pure: every transition takes a state and returns the next one; `usePlayQueue` drives
 * the engine from it.
 */

/** Where to carry on once a source runs out: a fresh list each time (a new shuffle, say). */
export interface PlayQueueThen<T> {
  source: string;
  list: () => T[];
}

export interface PlayQueueState<T extends { id: string }> {
  now: T | null;
  /** Nothing has been played yet: `now` is only cued. */
  started: boolean;
  /** The source list, its name, how far into it playing has got, and what comes after it. */
  from: T[];
  source: string | null;
  fromAt: number;
  then: PlayQueueThen<T> | null;
  queued: T[];
  /** Tracks gone back from with Previous: they head what's next. */
  ahead: T[];
  /** Tracks actually heard, most recent last: Previous goes back through them. */
  played: T[];
  /** Ids played from the queue while on this source: not played again when it reaches them. */
  skip: string[];
}

export function emptyPlayQueue<T extends { id: string }>(): PlayQueueState<T> {
  return { now: null, started: false, from: [], source: null, fromAt: -1, then: null, queued: [], ahead: [], played: [], skip: [] };
}

const has = <T extends { id: string }>(list: T[], id: string) => list.some((t) => t.id === id);
const without = <T extends { id: string }>(list: T[], id: string) => list.filter((t) => t.id !== id);

/** What follows the queue: tracks gone back from, then the rest of the source (minus what's on, queued or played already). */
export function rest<T extends { id: string }>(s: PlayQueueState<T>): T[] {
  const after = s.from.slice(s.fromAt + 1).filter((t) => t.id !== s.now?.id && !has(s.queued, t.id) && !has(s.ahead, t.id) && !s.skip.includes(t.id));
  return [...s.ahead.filter((t) => !has(s.queued, t.id)), ...after];
}

/** Next up: the first queued track, else the first of the rest. */
export const upNext = <T extends { id: string }>(s: PlayQueueState<T>): T | null => s.queued[0] ?? rest(s)[0] ?? null;

/** What's on now goes into what played before, if it was actually heard. */
const leave = <T extends { id: string }>(s: PlayQueueState<T>, heard: boolean): T[] => (heard && s.now ? [...s.played, s.now] : s.played);

export interface Move {
  /** What's on now was actually heard (it played some of itself). */
  heard: boolean;
  /** Start it (else only cue it). Default true. */
  start?: boolean;
}

/** Play `t` from `list`, a new source: what was gone back from no longer applies. */
export function playFrom<T extends { id: string }>(
  s: PlayQueueState<T>,
  list: T[],
  t: T,
  { heard, start = true, source = null, then = null }: Move & { source?: string | null; then?: PlayQueueThen<T> | null },
): PlayQueueState<T> {
  return {
    ...s,
    now: t,
    started: s.started || start,
    played: leave(s, heard),
    from: list,
    source,
    fromAt: list.findIndex((x) => x.id === t.id),
    then,
    queued: without(s.queued, t.id),
    ahead: [],
    skip: [],
  };
}

/** Cue the first track of `list` when nothing is on yet. */
export function cue<T extends { id: string }>(s: PlayQueueState<T>, list: T[], opts: { source?: string | null; then?: PlayQueueThen<T> | null } = {}) {
  return s.now || !list.length ? s : playFrom(s, list, list[0], { heard: false, start: false, ...opts });
}

/**
 * What's next now comes from `list`, starting at `at`, without touching what's on (or what's
 * queued): the rest follows what's being looked at. When nothing's on yet, `list[at]` is cued.
 */
export function follow<T extends { id: string }>(
  s: PlayQueueState<T>,
  list: T[],
  at: number,
  { source = null, then = null }: { source?: string | null; then?: PlayQueueThen<T> | null } = {},
): PlayQueueState<T> {
  if (!s.now) return list[at] ? playFrom(s, list, list[at], { heard: false, start: false, source, then }) : s;
  return { ...s, from: list, source, fromAt: at - 1, then, ahead: [], skip: [] };
}

/**
 * Play `t`, already in the queue, the tracks gone back from or the rest: a queued one leaves the
 * queue (and won't play again from the source); one further on skips what's in between.
 */
export function jump<T extends { id: string }>(s: PlayQueueState<T>, t: T, { heard, start = true }: Move): PlayQueueState<T> {
  const base = { ...s, now: t, started: s.started || start, played: leave(s, heard) };
  if (has(s.queued, t.id)) return { ...base, queued: without(s.queued, t.id), skip: has(s.from, t.id) ? [...s.skip, t.id] : s.skip };
  const back = s.ahead.findIndex((x) => x.id === t.id);
  if (back >= 0) return { ...base, ahead: s.ahead.slice(back + 1) };
  const at = s.from.findIndex((x) => x.id === t.id);
  return at >= 0 ? { ...base, ahead: [], fromAt: at } : base;
}

/** On to what's next; when the source runs out, on to what comes after it. Null: nothing left. */
export function advance<T extends { id: string }>(s: PlayQueueState<T>, move: Move): PlayQueueState<T> | null {
  const t = upNext(s);
  if (t) return jump(s, t, move);
  const list = s.then?.list() ?? [];
  const first = list.find((x) => x.id !== s.now?.id) ?? null;
  return first && s.then ? playFrom(s, list, first, { ...move, source: s.then.source, then: s.then }) : null;
}

/** Back to the last track heard; the one left heads what's next. */
export function previous<T extends { id: string }>(s: PlayQueueState<T>): PlayQueueState<T> | null {
  const back = s.played.at(-1);
  if (!back) return null;
  return {
    ...s,
    now: back,
    started: true,
    played: s.played.slice(0, -1),
    queued: without(s.queued, back.id),
    ahead: s.now ? [s.now, ...without(s.ahead, s.now.id)] : s.ahead,
  };
}

/** `t` into the queue before the queued track `before`, or last; moved if it's queued already. */
export function enqueue<T extends { id: string }>(s: PlayQueueState<T>, t: T, before: string | null = null): PlayQueueState<T> {
  if (t.id === s.now?.id || before === t.id) return s;
  const queued = without(s.queued, t.id);
  const i = before === null ? -1 : queued.findIndex((x) => x.id === before);
  const at = i < 0 ? queued.length : i;
  return { ...s, queued: [...queued.slice(0, at), t, ...queued.slice(at)], ahead: without(s.ahead, t.id) };
}

export const clearQueue = <T extends { id: string }>(s: PlayQueueState<T>): PlayQueueState<T> => ({ ...s, queued: [] });
