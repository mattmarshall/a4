# Spec Delta

## MODIFIED Requirements

### Requirement: Other Markdown and skipped folders
Other `.md` files SHALL be listed in an **Other Markdown** group, collapsed by
default. Letters, the `.md` files directly inside `.agents/letters/`, SHALL be
listed in the Letters group instead, and stack pages, the `.md` files directly
inside a stack in `.agents/stacks/`, in the Stacks group. The scan SHALL skip:
- folders named `.git`, `node_modules`, `dist`, `build`, `out`, `target`,
  `vendor`, `.next`, or `.venv`;
- other folders whose names start with a period, except `.claude`, `.github`,
  `.cursor`, and `.agents`.

#### Scenario: Dependencies are skipped
- **GIVEN** the folder holds `docs/guide.md` and `node_modules/pkg/README.md`
- **WHEN** the folder is listed
- **THEN** "docs/guide.md" is under Other Markdown and nothing under `node_modules` is listed

#### Scenario: Letters aren't Other Markdown
- **GIVEN** the folder holds `.agents/letters/2026-11-25-0930-auth.md`
- **WHEN** the folder is listed
- **THEN** it is listed under Letters and not under Other Markdown

#### Scenario: Stack pages aren't Other Markdown
- **GIVEN** the folder holds `.agents/stacks/auth/01-charter.md`
- **WHEN** the folder is listed
- **THEN** it is listed under the stack "auth" in Stacks, and not under Other Markdown
