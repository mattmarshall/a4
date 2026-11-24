# Tasks

## 1. Compiler flags

- [ ] 1.1 Enable `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, and `erasableSyntaxOnly`. Verify that `pnpm typecheck` and `pnpm test` pass with no source changes
- [ ] 1.2 Enable `exactOptionalPropertyTypes` and `noImplicitReturns`, and fix the 14 errors. Verify that `pnpm typecheck` and `pnpm test` pass

## 2. Lint and format

- [ ] 2.1 Add Biome with the rule set from the design, and a `pnpm lint` script. Verify that `pnpm lint` runs with zero errors (warnings allowed) and that a planted `x!.y` is reported
- [ ] 2.2 Apply Biome formatting in its own commit. Verify that `git diff --stat` shows only whitespace and quoting changes, and that `pnpm check` passes

## 3. Boundaries and dead code

- [ ] 3.1 Add dependency-cruiser with the rules from the design, run by `pnpm lint`. Verify that it passes on the current tree, and that a planted `import "@/components/Menu"` in `lib/` fails
- [ ] 3.2 Add knip (failing on unused files and dependencies; unused exports reported). Remove the unused files it finds, or list why they're kept. Verify that `pnpm lint` passes
- [ ] 3.3 Add stylelint for `app/globals.css`, with existing violations as warnings. Verify that a planted duplicate selector fails

## 4. Contracts and bundle

- [ ] 4.1 Run `buf breaking` against `main` in `proto:check`, and fetch `main` in CI. Verify that removing a proto field locally fails the check
- [ ] 4.2 Add `scripts/check-bundle.ts` after the build in `pnpm check`. Verify that it passes now, and fails when `components/ModelsPanel.tsx` statically imports `lib/models/fit/adapter.ts`
- [ ] 4.3 Add `pnpm lint` to the CI workflow before the tests, and document the guardrails in the README's Scripts table. Verify with a CI run on a branch, or a local `pnpm check`

## Workflow follow-up

- Commit and push to deploy, then archive this change.
