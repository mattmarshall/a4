# Tasks

## 1. Scoring

- [x] 1.1 Move the tint floor to 0.60 and list the closest pairs at 0.60 or more (top 5), keeping the 0.85 restatement count; verify unit tests for 0.55 → 0, 0.68 → 0.2, 0.90 → 0.75, a 0.68 pair listed without counting as restating, and the 5-pair cap
  - Verified: 8 semantic tests pass, including 0.55 → 0, 0.68 → 0.2 (listed, not restating), 0.90 → 0.75, and the 5-pair cap. Findings for close pairs use the kind `similar`.

## 2. Summary and legend

- [x] 2.1 Show the ranked list with each pair's similarity and tint swatch, the restatement count as the headline, and the legend's 0.60–1.00 scale with 0.85 marked; verify in the browser that the author's sentence on the Welcome page is listed and lightly tinted, and that selecting it selects the later sentence
  - Verified on the author's Welcome page: "None of 20 sentences and fields restate another (0.85 or more)". Their sentence is listed first at 0.68, with a swatch at the sheet's exact tint (value 0.2), and the sheet shows a light tint. Selecting the pair selected their sentence. The legend reads "similarity 0.60 → 1.00" and notes the 0.85 threshold.
- [x] 2.2 Update the README and the calibration notes; verify `pnpm check` and `openspec validate add-semantic-overlaps --strict` pass
  - Verified: the README and `calibration.md` cover the new scale. `pnpm check` (196 tests, typecheck, proto check, build) and strict validation of the change and all 17 specs pass.

## Workflow follow-up

- Commit and push to deploy, then archive this change.
