/** Terms and repetition: which words the page keeps saying. */

export const STOPWORDS = new Set(
  (
    "the and for are but not you all any can had her was one our out has have him his how its " +
    "may new now own see two way who did get let put say she too use that this with from they " +
    "will would there their what about which when make like than then them these some into just " +
    "only also been were being more most other such very each over after before because should " +
    "could does done where while here those your yours ours it's i'm don't can't won't isn't " +
    "aren't wasn't doesn't didn't via per yet nor both either neither until unless upon"
  ).split(" "),
);

/** Words of 3+ characters (letters, digits, underscores), starting with a letter. */
export const TERM = /\p{L}[\p{L}\p{N}_'’]*[\p{L}\p{N}_]|\p{L}[\p{L}\p{N}_]{2,}/gu;

export function normalizeTerm(raw: string): string | null {
  const term = raw.toLowerCase().replace(/’/g, "'");
  if (term.length < 3 || STOPWORDS.has(term)) return null;
  return term;
}

export interface TermCount {
  readonly term: string;
  readonly count: number;
}

/**
 * Every term with its count, most frequent first (then longer, then
 * alphabetical), and repetition: the share of term characters spent on
 * repeats.
 */
export function termStats(text: string): { termCounts: TermCount[]; repetition: number } {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(TERM)) {
    const term = normalizeTerm(m[0]);
    if (term) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  let total = 0;
  let repeated = 0;
  for (const [term, count] of counts) {
    total += term.length * count;
    repeated += term.length * (count - 1);
  }
  const termCounts = [...counts]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .map(([term, count]) => ({ term, count }));
  return { termCounts, repetition: total === 0 ? 0 : repeated / total };
}
