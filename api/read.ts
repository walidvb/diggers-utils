/** `GET /api/read?url=…` → a `ReadOutcome` for the pasted link. */

import { readMedia } from "../src/server/index.ts";
import { badRequest, respond, throttle } from "./_http.ts";

/** Stream URLs stay playable for weeks, so a day-old tracklist is still good. */
const CACHE_SECONDS = 24 * 60 * 60;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return badRequest("Missing ?url=");
  return respond(await readMedia(url, { throttle }), CACHE_SECONDS);
}
