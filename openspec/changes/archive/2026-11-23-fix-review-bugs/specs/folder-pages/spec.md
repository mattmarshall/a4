# Spec Delta

## ADDED Requirements

### Requirement: A folder keeps its identity
Picking a folder that A4 already remembers SHALL reuse its identity, so tabs
that opened the same folder serialize their writes to each file and share its
drafts.

#### Scenario: The same folder in two tabs
- **GIVEN** tab 1 has the folder "a4" open
- **WHEN** the user picks the same folder "a4" in tab 2 and both tabs edit "AGENTS.md"
- **THEN** their saves to "AGENTS.md" never interleave, and each tab's drafts are recoverable by the other

### Requirement: Remembered files in either slot
A folder file remembered in slot A or slot B SHALL reopen in that slot after
a reload, once the folder connects, unless the user opened something else
there meanwhile.

#### Scenario: Compare after a reload
- **GIVEN** Compare shows the library page "Charter" in A and "AGENTS.md" from the folder in B
- **WHEN** the user reloads the workbench and the folder reconnects
- **THEN** B shows "AGENTS.md" again

### Requirement: Save to folder saves the chosen page
"Save to folder…" SHALL write the library page it was opened for, even if a
different page is open in that slot when the path is submitted.

#### Scenario: Switching pages before saving
- **GIVEN** the user chose Save to folder… for "Charter"
- **WHEN** the user opens "Handoff" in the same slot and then saves as "CHARTER.md"
- **THEN** "CHARTER.md" holds the text of "Charter"
