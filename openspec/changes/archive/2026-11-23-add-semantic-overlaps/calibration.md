# Calibration on the continuous scale

The same 30 fixture pairs as the add-sheet-model-plugins calibration
(`lib/models/semantic/calibration-pairs.ts`), and the same model, re-read on
the new scale: cell value = clamp((s − 0.60) / 0.40, 0, 1). Listed pairs are
those at 0.60 or more; restating is 0.85 or more.

| Kind | Similarity | Value (tint) | Listed | Restating |
| --- | --- | --- | --- | --- |
| Paraphrase | 0.960, 0.936, 0.923, 0.898, 0.870, 0.865 | 0.66–0.90 | yes | yes |
| Paraphrase | 0.831, 0.820, 0.811 | 0.53–0.58 | yes | no |
| Paraphrase | 0.631 | 0.08 (faint) | yes | no |
| Related, different fact | 0.821 | 0.55 | yes | no |
| Related, different fact | 0.649, 0.632, 0.618 | 0.05–0.12 (faint) | yes | no |
| Related, different fact | 0.519, 0.426, 0.415, 0.406, 0.366, 0.314 | 0 | no | no |
| Unrelated | all ≤ 0.174 | 0 | no | no |

- **More is visible:** all 10 paraphrases are now tinted and listable. Before,
  only 6 were tinted at all.
- **The restating count is unchanged.** It's still 6 of 10 paraphrases and
  none of the 20 other pairs, so its precision is unchanged.
- **Same topic shows faintly.** Related pairs on the same topic get faint
  tints, which reads as "loosely related" on the scale. The one high related
  pair (0.821) sits with the near-paraphrases, as expected for two sentences
  about the same deploy.
- **Unrelated stays clear.** No unrelated pair gets any tint.

The author's case, "This is an A4 sheet of paper that is broken up into a
grid." against "This sheet is A4, quantized into a grid of 80 columns and 60
rows.", scores 0.68: value 0.2, listed first on the Welcome page, and not
counted as restating.
