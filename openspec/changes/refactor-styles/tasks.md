# Tasks

## 1. Baseline

- [x] 1.1 Add `scripts/screenshots.ts` (CDP), capturing the fixed views from the design and comparing them with a tolerance. Record the baseline. Verify that two runs on unchanged code compare equal

## 2. Cascade and tokens

- [x] 2.1 Move every rule into `@layer tokens, base, components, layout, print` in one commit, keeping preflight. Verify that the screenshots compare equal and stylelint rejects unlayered rules
- [x] 2.2 Add the size, radius, z-index, hover, `.eyebrow`, and model-violet tokens, and replace the literals. Verify that the screenshots compare equal

## 3. Components and palette

- [x] 3.1 Move each panel's rules into a CSS module beside it (library, metrics, models, compare, inspector, prose pages), replacing cross-component selectors with variants or data attributes and adding `.visually-hidden`. Verify that the screenshots compare equal after each panel
- [x] 3.2 Add `palette.ts` and the plugin that emits palette custom properties, with the painter and shadow DOM importing it, and the drift test. Verify that the screenshots compare equal and the drift test passes
- [x] 3.3 Define the breakpoints once (`@custom-media` and one TypeScript constant used by `useMediaQuery`), make print hide by `data-print` in the last layer with no `!important`, remove the dead rules, and turn stylelint warnings into errors. Verify that the screenshots compare equal, print to PDF gives one page of text, and `pnpm lint` passes

## 4. Integration

- [x] 4.1 Run `pnpm check`, `pnpm lint`, and `openspec validate refactor-styles --strict`, and do a manual pass on menus, dialogs, drawers, and focus mode in both themes

## Workflow follow-up

- Commit and push to deploy, then archive this change.
