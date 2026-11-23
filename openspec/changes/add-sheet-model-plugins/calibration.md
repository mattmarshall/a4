# Semantic repetition calibration

Model: `Xenova/all-MiniLM-L6-v2` at commit
`751bff37182d3f1213fa05d7196b954e230abad9`, 8-bit (`model_quantized.onnx`),
on the ONNX runtime's WebAssembly backend, with mean pooling and L2
normalization. Fixtures: `lib/models/semantic/calibration-pairs.ts`, 30 pairs
written in the register of agent context. Measured 2026-11-23.

## Results (cosine similarity)

| Kind | Pairs | Values |
| --- | --- | --- |
| Paraphrase (same fact) | 10 | 0.960, 0.936, 0.923, 0.898, 0.870, 0.865, 0.831, 0.820, 0.811, 0.631 |
| Related (same topic, different fact) | 10 | 0.821, 0.649, 0.632, 0.618, 0.519, 0.426, 0.415, 0.406, 0.366, 0.314 |
| Unrelated | 10 | 0.174, 0.158, 0.137, 0.106, 0.077, 0.050, 0.032, 0.017, 0.004, −0.003 |

## Decision: keep 0.85 and 0.70

- **Restatement at 0.85.** It flags 6 of 10 paraphrases, and 0 of 20
  related or unrelated pairs.
  - Lowering it to 0.80 would catch two more paraphrases (0.831 and 0.820).
  - But it would also flag "The deploy failed because the token expired."
    against "The deploy succeeded after we rotated the token." (0.821). Those
    are two different facts, and cutting one loses information.
  - Calling a new fact repetition is the costlier error, so precision wins.
- **Floor at 0.70.** Every unrelated pair, and 9 of 10 related pairs, stay
  untinted. The 0.821 related pair gets a light tint (value 0.40) without
  being listed as a restatement. That is the intended reading: close, but
  not the same.

## Misses worth knowing

- **Vocabulary.** "Do not delete the production database." against "Never
  drop the prod database." scores 0.631: the model doesn't connect "drop"
  and "prod" to "delete" and "production".
- **Abbreviations.** "Every night at 12 a.m. the cache gets flushed." splits
  into two units at "a.m.", following the spec's sentence rule. Neither half
  then matches its paraphrase above 0.85 (whole sentences: 0.811).

## The spec scenario

"The deploy failed because the token expired." against "An expired token is
why the deployment failed." scores 0.918 to 0.949, depending on the
surrounding text in the batch. With three unrelated sentences, it is the
highest pair on the page, and no unrelated pair reaches 0.85.
