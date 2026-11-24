/**
 * Model plugins as the UI sees them: the bundled cards and plugin descriptors
 * (light: cards and typed names), the host's types, and the Fit to page job.
 * Plugin code and model libraries load on first use, through the registry
 * (lib/models/registry.ts), which the UI imports dynamically; nothing
 * exported here imports a plugin's implementation.
 */

export { Operation, type ModelCard } from "../gen/a4/v1/model_pb.js";
export { planeLevel, remoteHost, type PlaneInfo } from "./capabilities.ts";
export { BUNDLED_CARDS, isDownloaded, needsDownload } from "./manifest.ts";
export { FIT_TO_PAGE } from "./plugins/fit/descriptor.ts";
export { FitJob } from "./fit-job.ts";
export type { FindingResult, ModelHost, ScoreResult, TransformResult } from "./host.ts";
export { pluginIdOf, type PluginId } from "./plugin-id.ts";
export { SEMANTIC_REPETITION } from "./plugins/semantic/descriptor.ts";
export { ScoreSchedule } from "./score-schedule.ts";
