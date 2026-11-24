/**
 * Density analysis: how a page of agent context spends its cells. Pure and
 * synchronous; compressibility, the one async metric, is in compress.ts.
 *
 * The result has three parts, so each reader takes only what it needs: the
 * layout (rows and line kinds, for painting), the metrics (numbers), and the
 * assessment (signals, verdict, and findings).
 */

import { layoutRows, type PageSpec } from "../page/index.ts";
import { assess, type Assessment } from "./assess.ts";
import { classifyLines } from "./classify.ts";
import { DEFAULT_CONFIG, type AnalysisConfig } from "./config.ts";
import { measure, type Layout, type Metrics } from "./metrics.ts";

export interface Analysis {
  readonly layout: Layout;
  readonly metrics: Metrics;
  readonly assessment: Assessment;
}

/** The text's rows and line kinds on `spec`: all a painter needs, without the metrics. */
export function pageLayout(text: string, spec: PageSpec, config: AnalysisConfig = DEFAULT_CONFIG): Layout {
  return {
    rows: layoutRows(text, spec.cols),
    lineKinds: classifyLines(text.split("\n"), config.classify, spec.cols),
  };
}

export function analyze(text: string, spec: PageSpec, config: AnalysisConfig = DEFAULT_CONFIG): Analysis {
  const layout = pageLayout(text, spec, config);
  const metrics = measure(layout, text, spec);
  return { layout, metrics, assessment: assess(metrics, config) };
}
