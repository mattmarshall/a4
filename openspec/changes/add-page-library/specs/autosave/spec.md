# Spec Delta

## Purpose

Guarantees that no edit is lost: every keystroke is journaled locally at once,
pages are saved to the store automatically, and anything not yet saved when a
tab crashes or closes is recovered on the next load.

## ADDED Requirements

### Requirement: Journal before save
Every edit SHALL be written synchronously to a local journal entry for that
page and browser tab before the edit is considered handled. The entry SHALL
be removed only after the store confirms a save of that same text.

#### Scenario: Closing the tab mid-typing
- **GIVEN** the user typed text that has not yet been saved to the store
- **WHEN** the tab is closed
- **THEN** the typed text remains in the journal

### Requirement: Automatic saves
The system SHALL save an open page to the store 600 ms after the last edit,
and at least every 4 seconds while edits continue. It SHALL also save
immediately when the tab becomes hidden, when the user switches pages, and
when the user presses Ctrl+S or Cmd+S (which SHALL NOT open the browser's save
dialog).

#### Scenario: Pause in typing
- **WHEN** the user stops typing for 600 ms
- **THEN** the page is saved to the store

#### Scenario: Continuous typing
- **WHEN** the user types without pausing for 10 seconds
- **THEN** the page is saved at least twice during that time

### Requirement: Save status
The workbench SHALL show the open page's save status: Saved, Unsaved changes,
Saving, or Save failed (retrying). The status SHALL return to Saved only after
the store confirms the latest text.

#### Scenario: Status after typing
- **WHEN** the user types and then pauses
- **THEN** the status reads Unsaved changes, then Saving, then Saved

### Requirement: Retry failed saves
A save that fails for a reason other than a conflict or a missing page SHALL be
retried with increasing delays from 1 second up to 30 seconds, while the
journal keeps the text.

#### Scenario: Storage briefly fails
- **GIVEN** the store rejects one write
- **WHEN** the retry runs and succeeds
- **THEN** the status returns to Saved and the journal entry is removed

### Requirement: Conflicts keep both versions
When a save fails because another tab saved the page first, the system SHALL
save this tab's text as a new page named "<name> (conflict <date> <time>)",
open that copy, and tell the user. Neither version SHALL be lost.

#### Scenario: Two tabs edit the same page
- **GIVEN** tabs 1 and 2 both have page "Brief" open, and tab 2 saves new text
- **WHEN** tab 1 saves different text
- **THEN** "Brief" keeps tab 2's text and a conflict copy holds tab 1's text

### Requirement: Page deleted elsewhere
When a save fails because the page no longer exists, the system SHALL
recreate it from the unsaved text under its name, or under a unique name when
that name has been taken, and tell the user.

#### Scenario: Deleted in another tab
- **GIVEN** tab 1 has unsaved edits to "Brief" and tab 2 moves "Brief" to the trash
- **WHEN** tab 1 saves
- **THEN** a page holding tab 1's text exists in the library

### Requirement: Crash recovery
On load, the system SHALL recover journal entries left by tabs that are no
longer open. If the stored page still matches the entry's base revision, the
draft SHALL be saved over it. Otherwise the draft SHALL be saved as a new page
named "<name> (recovered <date> <time>)". The user SHALL be told what was
recovered. Drafts from tabs that are still open SHALL NOT be touched.

#### Scenario: Browser crashed before saving
- **GIVEN** a tab crashed with unsaved edits to "Brief" and nothing else changed "Brief"
- **WHEN** the user opens the workbench again
- **THEN** "Brief" contains the unsaved edits

#### Scenario: Page changed after the crash
- **GIVEN** a tab crashed with unsaved edits to "Brief" and another tab later saved "Brief"
- **WHEN** the user opens the workbench again
- **THEN** a page "Brief (recovered …)" holds the crashed tab's edits and "Brief" is unchanged
