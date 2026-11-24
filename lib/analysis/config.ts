/**
 * The analysis thresholds, in one typed config. Each value cites the
 * requirement that pins it (openspec/specs/<capability>/spec.md), or says it
 * is unspecified: a product choice the specs don't fix. Shares are fractions
 * of 1 (0.2 is 20%).
 */

export interface AnalysisConfig {
  /** When a page reads Noisy, Light, or Busy. */
  readonly verdict: {
    /** Noisy at this syntax share of ink, or more. */
    readonly noisySyntax: number;
    /** Noisy at this repetition share, or more, when a term repeats. */
    readonly noisyRepetition: number;
    /** Noisy at this many duplicate lines, or more. */
    readonly noisyDuplicateLines: number;
    /** Light below this fill. */
    readonly lightFill: number;
    /** Busy at this crowding, or more. */
    readonly busyCrowding: number;
    /** Busy at this indentation share, or more. */
    readonly busyIndentation: number;
  };
  /** Findings and bar states below the verdict thresholds. */
  readonly findings: {
    /** A syntax note (info) at this share, or more, below Noisy. */
    readonly noteSyntax: number;
    /** A narrative warning below this share. */
    readonly lowNarrative: number;
    /** Narrative share is judged only with this many prose and structured lines. */
    readonly lowNarrativeMinLines: number;
  };
  /** Line classification. A heading's width is the page's: `spec.cols`. */
  readonly classify: {
    /** A prose line has at least this many words. */
    readonly proseMinWords: number;
    /** A prose line has at most this syntax share. */
    readonly proseMaxSyntax: number;
    /** An all-caps heading has at most this many words. */
    readonly headingMaxWords: number;
  };
}

export const DEFAULT_CONFIG = {
  verdict: {
    noisySyntax: 0.2, // density-analysis, "Verdict": syntax at least 20%
    noisyRepetition: 0.4, // density-analysis, "Verdict": repetition at least 40%
    noisyDuplicateLines: 3, // density-analysis, "Verdict": at least 3 duplicate lines
    lightFill: 0.25, // density-analysis, "Verdict": fill below 25%
    busyCrowding: 0.65, // density-analysis, "Verdict": crowding at least 65%
    busyIndentation: 0.12, // density-analysis, "Verdict": indentation at least 12%
  },
  findings: {
    noteSyntax: 0.1, // unspecified
    lowNarrative: 0.4, // unspecified
    lowNarrativeMinLines: 10, // unspecified
  },
  classify: {
    proseMinWords: 6, // density-analysis, "Narrative share": at least 6 words
    proseMaxSyntax: 0.1, // density-analysis, "Narrative share": at most 10% syntax characters
    headingMaxWords: 10, // unspecified
  },
} as const satisfies AnalysisConfig;
