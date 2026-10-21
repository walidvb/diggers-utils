/** `GET /api/stream?url=…&trackId=…` → a `StreamOutcome`: a fresh stream for a Bandcamp track whose stored one failed. */

import { resolveBandcampStream } from "../src/server/index.ts";
import { badRequest, respond, throttle } from "./_http.ts";

/** Short: callers come here because a stored stream just died. */
const CACHE_SECONDS = 60 * 60;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const trackId = params.get("trackId");
  if (!url || !trackId) return badRequest("Missing ?url= or ?trackId=");
  return respond(await resolveBandcampStream(url, trackId, { throttle }), CACHE_SECONDS);
}
