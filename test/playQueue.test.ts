import { describe, expect, it } from "vitest";
import { advance, clearQueue, cue, emptyPlayQueue, enqueue, follow, jump, playFrom, previous, rest, upNext, type PlayQueueState } from "../src/core";

type T = { id: string };
const tracks = (ids: string) => ids.split("").map((id) => ({ id }));
const ids = (list: T[]) => list.map((t) => t.id).join("");
const [A, B, C, D, E] = tracks("ABCDE");
const all = [A, B, C, D, E];
const heard = { heard: true };

const on = (s: PlayQueueState<T> | null) => s?.now?.id;

describe("play queue", () => {
  it("cues the first track without starting, once", () => {
    const s = cue(emptyPlayQueue<T>(), all);
    expect([on(s), s.started, ids(rest(s))]).toEqual(["A", false, "BCDE"]);
    expect(cue(s, tracks("XY"))).toBe(s);
  });

  it("plays on from a track in the source, earlier ones skipped", () => {
    const s = playFrom(emptyPlayQueue<T>(), all, C, heard);
    expect([on(s), ids(rest(s))]).toEqual(["C", "DE"]);
  });

  it("plays queued tracks first, in order, and keeps them through a new source", () => {
    let s = playFrom(emptyPlayQueue<T>(), all, A, heard);
    s = enqueue(enqueue(s, E), D);
    expect(ids(s.queued)).toBe("ED");
    s = playFrom(s, tracks("XYZ"), tracks("X")[0], heard);
    expect(ids(s.queued)).toBe("ED");
    expect(on(advance(s, heard))).toBe("E");
  });

  it("only records tracks actually heard (not a cued or failed one)", () => {
    let s = cue(emptyPlayQueue<T>(), all);
    s = jump(s, C, { heard: false });
    expect(s.played).toEqual([]);
    s = advance(s, { heard: false })!; // C failed
    expect([on(s), s.played]).toEqual(["D", []]);
    s = advance(s, heard)!;
    expect(ids(s.played)).toBe("D");
  });

  it("doesn't start on its own when what's cued fails", () => {
    const s = advance(cue(emptyPlayQueue<T>(), all), { heard: false, start: false })!;
    expect([on(s), s.started]).toEqual(["B", false]);
  });

  it("goes back without touching the queue; the track left plays next", () => {
    let s = playFrom(emptyPlayQueue<T>(), all, A, heard);
    s = advance(s, heard)!; // B
    s = enqueue(s, E);
    s = previous(s)!;
    expect([on(s), ids(s.queued), ids(rest(s))]).toEqual(["A", "E", "BCD"]);
    s = advance(s, heard)!;
    expect(on(s)).toBe("E");
    expect(on(advance(s, heard))).toBe("B");
  });

  it("going back to a queued track takes it out of the queue", () => {
    let s = playFrom(emptyPlayQueue<T>(), all, A, heard);
    s = advance(s, heard)!; // B
    s = enqueue(s, A);
    s = previous(s)!;
    expect([on(s), ids(s.queued)]).toEqual(["A", ""]);
  });

  it("dropping a queued track on itself leaves it where it was", () => {
    let s = playFrom(emptyPlayQueue<T>(), all, A, heard);
    s = enqueue(enqueue(enqueue(s, B), C), D);
    expect(ids(enqueue(s, B, "B").queued)).toBe("BCD");
    expect(ids(enqueue(s, D, "B").queued)).toBe("DBC");
  });

  it("won't queue what's on", () => {
    const s = playFrom(emptyPlayQueue<T>(), all, A, heard);
    expect(enqueue(s, A)).toBe(s);
  });

  it("doesn't play a queued track again when the source reaches it", () => {
    let s = playFrom(emptyPlayQueue<T>(), all, A, heard);
    s = enqueue(s, D);
    s = advance(s, heard)!; // D, from the queue
    expect(ids(rest(s))).toBe("BCE");
    s = advance(s, heard)!;
    expect([on(s), ids(rest(s))]).toEqual(["B", "CE"]);
  });

  it("carries on with what comes after the source, then stops when there's nothing", () => {
    const then = { source: "shuffle", list: () => tracks("ZYX") };
    let s = playFrom(emptyPlayQueue<T>(), all, E, { ...heard, source: "bags", then });
    expect(upNext(s)).toBeNull();
    s = advance(s, heard)!;
    expect([on(s), s.source, ids(rest(s))]).toEqual(["Z", "shuffle", "YX"]);
    expect(advance(playFrom(emptyPlayQueue<T>(), all, E, heard), heard)).toBeNull();
  });

  it("follows what's looked at for what's next, without touching what's on or queued", () => {
    let s = playFrom(emptyPlayQueue<T>(), all, A, heard);
    s = enqueue(s, E);
    s = follow(s, all, 2); // from C
    expect([on(s), s.started, ids(s.queued), ids(rest(s))]).toEqual(["A", true, "E", "CD"]);
    expect(on(advance(advance(s, heard)!, heard))).toBe("C");
  });

  it("cues what it follows when nothing's on yet", () => {
    const s = follow(emptyPlayQueue<T>(), all, 3);
    expect([on(s), s.started, ids(rest(s))]).toEqual(["D", false, "E"]);
  });

  it("skips past tracks further down, and clears the queue", () => {
    let s = playFrom(emptyPlayQueue<T>(), all, A, heard);
    s = jump(s, D, heard);
    expect([on(s), ids(rest(s))]).toEqual(["D", "E"]);
    expect(clearQueue(enqueue(s, B)).queued).toEqual([]);
  });
});
