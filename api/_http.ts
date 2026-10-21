/**
 * What `/api/read` and `/api/stream` share. Files starting with `_` aren't
 * deployed as functions of their own.
 */

/** Bandcamp starts failing requests spaced closer than ~2s. */
const SPACING_MS = 2000;
/** Past this, a request answers `busy` instead of queueing for its slot. */
const MAX_WAIT_MS = 6000;

let nextSlot = 0;

/**
 * Hands out Bandcamp slots ≥2s apart, queueing a caller for a few seconds at
 * most. Per instance only: concurrent instances each keep their own spacing,
 * which the CDN cache in front keeps rare.
 */
export async function throttle(): Promise<boolean> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  if (slot - now > MAX_WAIT_MS) return false;
  nextSlot = slot + SPACING_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  return true;
}

const STATUS: Record<string, number> = {
  ok: 200,
  unsupported: 422,
  unplayable: 422,
  "not-found": 404,
  unavailable: 502,
  transient: 502,
  busy: 503,
};

/** Answers worth caching at the edge: the ones that won't change on a retry. */
const LASTING = new Set(["ok", "unsupported", "unplayable", "not-found"]);

/**
 * An outcome as the response body, its kind as the status. Lasting outcomes
 * are cached by the CDN for `cacheSeconds`; the rest are worth retrying.
 */
export function respond(outcome: { kind: string }, cacheSeconds: number): Response {
  const headers: Record<string, string> = { "Access-Control-Allow-Origin": "*" };
  if (LASTING.has(outcome.kind)) headers["Cache-Control"] = `public, s-maxage=${cacheSeconds}`;
  else headers["Cache-Control"] = "no-store";
  if (outcome.kind === "busy") headers["Retry-After"] = String(SPACING_MS / 1000);
  return Response.json(outcome, { status: STATUS[outcome.kind] ?? 200, headers });
}

export const badRequest = (error: string) =>
  Response.json({ error }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
