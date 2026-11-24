/**
 * Model plugins: the bundled cards, the host that runs them, consent, Fit to
 * page, and Semantic repetition. Plugin code and model libraries load on
 * first use, through the registry (lib/models/registry.ts), which the UI
 * imports dynamically; nothing exported here imports a plugin's adapter or
 * worker.
 */

export { Placement, type ModelCard } from "../gen/a4/v1/model_pb.js";
export { BUNDLED_CARDS, formatBytes, MODEL_DOWNLOADED } from "./cards.ts";
export { grantConsent } from "./consent.ts";
export { FIT_HOST, FIT_MODEL, FIT_TO_PAGE_ID } from "./fit/card.ts";
export { FitJob } from "./fit/job.ts";
export { forgetApiKey, hasApiKey, setApiKey } from "./fit/key.ts";
export { MAX_ATTEMPTS, type FindingResult, type ModelHost, type ScoreResult, type TransformResult } from "./host.ts";
export { pluginIdOf, type PluginId } from "./plugin-id.ts";
export { SEMANTIC_REPETITION_CARD, SEMANTIC_REPETITION_ID } from "./semantic/card.ts";
export { ScoreSchedule } from "./semantic/schedule.ts";
export { cellValue, RESTATE_SIMILARITY, SIMILARITY_FLOOR } from "./semantic/similarity.ts";
