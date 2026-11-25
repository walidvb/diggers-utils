export { PROVIDERS, detectProvider, normalizeUrl, parseUrl } from "./providers.ts";
export type { Provider } from "./providers.ts";
export type { BandcampTrack, MediaInfo, MediaRef } from "./types.ts";
export {
  advance,
  clearQueue,
  cue,
  emptyPlayQueue,
  enqueue,
  follow,
  jump,
  playFrom,
  previous,
  rest,
  upNext,
} from "./playQueue.ts";
export type { Move, PlayQueueState, PlayQueueThen } from "./playQueue.ts";
