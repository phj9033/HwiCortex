export { fetchTopic } from "./pipeline/fetch.js";
export type { ResearchConfig, FetchOptions, FetchResult } from "./pipeline/fetch.js";

export { synthesize } from "./pipeline/synthesize.js";
export type { SynthOptions, SynthResult } from "./pipeline/synthesize.js";

export { draft, defaultDraftDbPath, extractSourceId, slugFromPrompt } from "./pipeline/draft.js";
export type { DraftOptions, DraftResult } from "./pipeline/draft.js";

export { computeStatus } from "./pipeline/status.js";
export type { TopicStatus, StatusEvent } from "./pipeline/status.js";

export { loadTopic, adhocTopicFromPrompt } from "./topic/loader.js";
export { scaffoldTopic, listTopicIds } from "./topic/scaffold.js";
export type { TopicSpec, SourceSpec } from "./topic/schema.js";

export { researchTools, executeResearchTool } from "./agent/tools.js";
export type { AgentCtx } from "./agent/tools.js";

export type { Card, SynthesisNote, Draft, RawRecord, FetchedDoc } from "./core/types.js";
export type { DraftStyle, DraftContext } from "./llm/draft.js";
