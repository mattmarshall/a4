# Proposal

## Why

The Semantic repetition lens missed a sentence an author had just written to
restate an earlier one. The model ranked the right sentence first: 0.68
similarity, with the next closest at 0.37. But the tint started at 0.70 and
the list showed only pairs at 0.85 or more, so nothing appeared. A shorter
sentence that repeats part of a longer one scores in that range, as do
paraphrases with different wording (0.81–0.83 in calibration). The lens
should show closeness as a continuous scale, the way a heatmap does, rather
than hiding everything below a cutoff.

## What Changes

- **The tint starts at 0.60 instead of 0.70.** A unit's cells hold
  `clamp((s − 0.60) / 0.40, 0, 1)`, so shading deepens smoothly from loosely
  related (0.60) to the same idea (1.0).
  - Unrelated sentences, all below 0.18 in calibration, stay untinted.
- **The summary becomes one ranked list.**
  - It lists the closest pairs on the page: up to 5, at 0.60 or more, most
    similar first.
  - Each pair shows its similarity and a swatch of its tint.
  - The headline still counts units that restate another (0.85 or more).
  - Selecting a pair still selects the later sentence.
- **The legend** shows the scale from 0.60 to 1.00, and marks 0.85 as the
  restatement threshold.

## Capabilities

### New Capabilities

### Modified Capabilities
- `semantic-repetition`: "Model lens values" (the floor moves to 0.60) and
  "Summary" (a ranked list of the closest pairs above 0.60).

## Impact

- `lib/models/semantic/similarity.ts`, the worker's findings,
  `components/ModelsPanel.tsx`, `components/MetricsPanel.tsx` (legend),
  `components/Workbench.tsx`, the tests, and the README.
- No new dependencies or downloads, and no change to the model, the
  painter, or what leaves the device.

## Out of scope

- Changing the 0.85 restatement threshold, the model, or the sentence rule.
- Comparing parts of sentences (clauses) or detecting entailment.
- A different color ramp for the painter. The tint stays proportional to the
  value, as the visual-lenses spec requires.
