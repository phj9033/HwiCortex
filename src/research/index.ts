// Pipeline primitives — all non-LLM. The external agent composes these
// with its own LLM access; hwicortex no longer drives Anthropic.

export { fetchTopic } from "./pipeline/fetch.js";
export type { ResearchConfig, FetchOptions, FetchResult } from "./pipeline/fetch.js";

export {
  searchTopic,
  defaultDraftDbPath,
  extractSourceId,
  slugFromPrompt,
} from "./pipeline/draft.js";
export type {
  SearchTopicOptions,
  SearchTopicResult,
  DraftContext,
} from "./pipeline/draft.js";

export { computeStatus } from "./pipeline/status.js";
export type { TopicStatus, StatusEvent } from "./pipeline/status.js";

// Topic file IO
export { loadTopic, adhocTopicFromPrompt } from "./topic/loader.js";
export { scaffoldTopic, listTopicIds } from "./topic/scaffold.js";
export type { TopicSpec, SourceSpec } from "./topic/schema.js";

// Card / synthesis / draft writers — agent calls these directly with
// content it has generated.
export { writeCard, cardPath, readCardFrontmatter } from "./store/cards.js";
export { writeSynthesis, synthesisPath } from "./store/synthesis.js";
export { writeDraftFile, draftPath } from "./store/drafts.js";

// Staging readers — agent reads raw.jsonl to decide which records to card.
export { StagingStore } from "./store/staging.js";

// Agent tools (Anthropic tool-use shape)
export { researchTools, executeResearchTool } from "./agent/tools.js";
export type { AgentCtx } from "./agent/tools.js";

// Core domain types
export type { Card, SynthesisNote, Draft, RawRecord, FetchedDoc } from "./core/types.js";
