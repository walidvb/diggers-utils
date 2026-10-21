// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as read } from "../api/read";
import { GET as stream } from "../api/stream";
import { DEFAULT_BASE_URL, createMediaClient } from "../src/client";

const ALBUM = readFileSync(new URL("./fixtures/bandcamp-album.html", import.meta.url), "utf8");
const PAGE = "https://artist.bandcamp.com/album/x";

const serve = (html: string, status = 200) =>
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(html, { status })));

const get = (path: string) => new Request(`https://media.test${path}`);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GET /api/read", () => {
  it("answers a Bandcamp release as a cacheable outcome", async () => {
    serve(ALBUM);
    const res = await read(get(`/api/read?url=${encodeURIComponent(PAGE)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=\d+/);
    const body = await res.json();
    expect(body.kind).toBe("ok");
    expect(body.info.bandcamp.tracks.length).toBeGreaterThan(0);
  });

  it("maps outcomes to statuses, and doesn't cache ones worth retrying", async () => {
    serve("", 500);
    vi.useFakeTimers();
    const pending = read(get(`/api/read?url=${encodeURIComponent(PAGE)}`));
    await vi.runAllTimersAsync(); // past the throttle's spacing from the previous test
    const res = await pending;
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ kind: "unavailable" });
  });

  it("rejects unsupported links", async () => {
    const res = await read(get(`/api/read?url=${encodeURIComponent("https://open.spotify.com/track/x")}`));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ kind: "unsupported" });
  });

  it("needs a url", async () => {
    expect((await read(get("/api/read"))).status).toBe(400);
  });
});

describe("GET /api/stream", () => {
  it("needs a url and a trackId", async () => {
    expect((await stream(get(`/api/stream?url=${encodeURIComponent(PAGE)}`))).status).toBe(400);
  });
});

describe("createMediaClient", () => {
  it("calls the API and returns its outcome as is", async () => {
    const f = vi.fn<typeof fetch>(async () => Response.json({ kind: "ok", streamUrl: "https://t4.bcbits.com/x" }));
    const client = createMediaClient({ baseUrl: "https://media.test", fetch: f });
    expect(await client.resolveBandcampStream(PAGE, "42")).toEqual({ kind: "ok", streamUrl: "https://t4.bcbits.com/x" });
    const called = new URL(String(f.mock.calls[0][0]));
    expect(called.pathname).toBe("/api/stream");
    expect(Object.fromEntries(called.searchParams)).toEqual({ url: PAGE, trackId: "42" });
  });

  it("defaults to the hosted API", async () => {
    const f = vi.fn<typeof fetch>(async () => Response.json({ kind: "unsupported" }));
    await createMediaClient({ fetch: f }).readMedia("https://open.spotify.com/track/x");
    expect(new URL(String(f.mock.calls[0][0])).origin).toBe(DEFAULT_BASE_URL);
  });

  it("reads a failed or garbled answer as unavailable", async () => {
    const down = createMediaClient({ baseUrl: "https://media.test", fetch: async () => { throw new Error("offline"); } });
    expect(await down.readMedia(PAGE)).toEqual({ kind: "unavailable" });
    const html = createMediaClient({ baseUrl: "https://media.test", fetch: async () => new Response("<html>", { status: 500 }) });
    expect(await html.readMedia(PAGE)).toEqual({ kind: "unavailable" });
  });
});
