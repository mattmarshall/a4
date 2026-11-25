# folder-pages Specification

## Purpose
Lets the author open a local folder, such as a repository, and edit its agent
context files in place as A4 pages. A4 keeps every line the author didn't
touch exactly as it was, and never loses, overwrites, or deletes a file.

## Requirements

### Requirement: Open a folder
Where the browser has a folder picker, the Pages panel SHALL offer **Open
folder…**, which asks for read and write access to one local folder. A4 SHALL
show one folder at a time and SHALL remember it across reloads. **Close
folder** SHALL save pending edits, close the folder's files, and forget the
folder, without changing any file.

#### Scenario: Opening a repository
- **WHEN** the user chooses Open folder…, picks the folder "a4", and grants access
- **THEN** the Pages panel shows a section named "a4" below the library, listing the folder's context files

#### Scenario: Closing the folder
- **GIVEN** the folder "a4" is open and its "AGENTS.md" is on the sheet
- **WHEN** the user chooses Close folder
- **THEN** the folder section disappears, the sheet shows a library page, and "AGENTS.md" on disk holds the text that was on the sheet

### Requirement: Browsers without a folder picker
Where the browser has no folder picker, the Pages panel SHALL NOT offer Open
folder…. It SHALL say that opening a folder needs Chrome or Edge, and the
library SHALL work as before.

#### Scenario: A browser without a folder picker
- **GIVEN** a browser without a folder picker
- **WHEN** the user opens the Pages panel
- **THEN** a note says opening a folder needs Chrome or Edge, and the library pages are listed and open as before

### Requirement: Context files
The folder section SHALL list, at any depth:
- files named `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, or
  `SKILL.md`;
- `.md` files in `.claude/agents/` and `.claude/commands/`;
- `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`;
- and `.cursor/rules/*.mdc`.

Each file SHALL show its path relative to the folder and its rows used on the
80 × 60 Terminal grid, and SHALL be marked when it uses more than 60 rows.

#### Scenario: A file over one page
- **GIVEN** the folder's root `AGENTS.md` lays out to 74 rows on the Terminal grid
- **WHEN** the folder is listed
- **THEN** "AGENTS.md" shows 74 of 60 rows and is marked 14 rows over

#### Scenario: A nested skill
- **GIVEN** the folder holds `.claude/skills/review/SKILL.md`
- **WHEN** the folder is listed
- **THEN** it is listed as ".claude/skills/review/SKILL.md" among the context files

### Requirement: Other Markdown and skipped folders
Other `.md` files SHALL be listed in an **Other Markdown** group, collapsed by
default. Letters, the `.md` files directly inside `.agents/letters/`, SHALL be
listed in the Letters group instead, and stack pages in the Stacks group. The
scan SHALL skip:
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

### Requirement: Search folder files
The Pages search box SHALL filter folder files by a case-insensitive substring
of their path, the same way it filters library pages by name.

#### Scenario: Filtering by path
- **GIVEN** the folder lists "AGENTS.md", ".claude/skills/review/SKILL.md", and "docs/guide.md"
- **WHEN** the user types "skill" in the search box
- **THEN** only ".claude/skills/review/SKILL.md" is listed in the folder section

### Requirement: Scan and file limits
The scan SHALL stop after visiting 20,000 entries and SHALL say that the list
is partial. A file larger than 1 MiB (1,048,576 bytes), or one that isn't
valid UTF-8 text, SHALL be listed with the reason, and SHALL NOT open.

#### Scenario: Not UTF-8 text
- **GIVEN** the folder holds `notes.md`, which isn't valid UTF-8
- **WHEN** the user selects it
- **THEN** it doesn't open, and the list shows it as not UTF-8 text

#### Scenario: A very large file
- **GIVEN** the folder holds `CHANGELOG.md` of 2,000,000 bytes
- **WHEN** the folder is listed
- **THEN** "CHANGELOG.md" is shown as too large to open

### Requirement: Open a file as a page
Selecting a folder file SHALL save pending edits to the open page, then open
the file on the sheet. The file SHALL get the same metrics, lenses,
renderings, copy, download, and print as a library page. On the sheet, tab
characters SHALL show as two spaces and line endings as LF.

#### Scenario: Opening AGENTS.md
- **GIVEN** the folder "a4" is open
- **WHEN** the user selects "AGENTS.md"
- **THEN** the sheet shows its text, and the inspector shows its verdict and metrics

### Requirement: Saves go to the file
Edits to a folder file SHALL be journaled at once and saved to the file with
the library's autosave timing: 600 ms after the last edit, and at most 4 s
after the first unsaved edit. Each save SHALL replace the file atomically. A
file SHALL NOT be written unless its text was edited.

#### Scenario: Typing on a file
- **GIVEN** "AGENTS.md" is open
- **WHEN** the user types a sentence and pauses for 1 second
- **THEN** "AGENTS.md" on disk contains the sentence, and the save status reads Saved

#### Scenario: Opening without editing
- **WHEN** the user opens "CLAUDE.md" and then opens another page without typing
- **THEN** "CLAUDE.md" on disk keeps its bytes and its modification time

### Requirement: Faithful saves
Saving SHALL change only the lines the author edited. Every other line SHALL
keep its exact bytes, including tabs and line endings. The file SHALL keep its
byte-order mark, if it has one, and whether it ends with a newline; a file
that was empty SHALL end with one. New and edited lines SHALL use the file's
main line ending. Text past the last page row SHALL be saved in full.

#### Scenario: One edited line in a CRLF file
- **GIVEN** a 120-line file with CRLF line endings, a byte-order mark, and tab-indented lines 10 through 20
- **WHEN** the author edits line 50 and the page saves
- **THEN** a byte comparison of the old and new files differs only on line 50, which ends with CRLF, and lines 10 through 20 still contain their tabs

#### Scenario: A file longer than a page
- **GIVEN** a file that lays out to 140 rows on the Terminal grid
- **WHEN** the author edits row 3 and the page saves
- **THEN** the file still holds every line, including the text on rows 61 through 140

### Requirement: Files are never renamed or deleted
A4 SHALL NOT rename, move, or delete files in a folder. For a folder file,
A4 SHALL NOT offer rename or move to trash.

#### Scenario: No delete for a file
- **GIVEN** "AGENTS.md" is selected in the folder section
- **WHEN** the user looks for page actions
- **THEN** neither Rename nor Move to trash is offered for it

### Requirement: Creating files on request
A4 SHALL create a file only when the user asks:
- **New file in folder**, given a relative path ending in `.md` or `.mdc`;
- **Save to folder**, which writes an open library page to a new path;
- **New letter**, which creates a draft letter in `.agents/letters/`;
- sealing a letter, which writes its postmark beside it.

A4 SHALL create missing parent folders. It SHALL refuse with a message, and
change nothing, when the path already exists or points outside the folder.

#### Scenario: Adding AGENTS.md
- **GIVEN** the open folder has no `AGENTS.md`
- **WHEN** the user chooses New file in folder and enters "AGENTS.md"
- **THEN** an empty `AGENTS.md` is created at the folder's root and opens on the sheet

#### Scenario: An existing path is refused
- **GIVEN** the open folder has a `CLAUDE.md`
- **WHEN** the user saves the library page "Charter" to the folder as "CLAUDE.md"
- **THEN** A4 says "CLAUDE.md" already exists, and `CLAUDE.md` is unchanged

#### Scenario: A path outside the folder is refused
- **WHEN** the user chooses New file in folder and enters "../notes.md"
- **THEN** A4 refuses the path, and no file is created

#### Scenario: The first letter
- **GIVEN** the open folder has no `.agents` folder
- **WHEN** the user chooses New letter
- **THEN** `.agents/letters/` is created with the new draft inside it

### Requirement: Changes made outside A4
While the tab is visible, A4 SHALL notice within 2 s that an open folder file
changed on disk. With no unsaved edits, it SHALL show the new text and say
the file was reloaded. With unsaved edits, A4 SHALL NOT overwrite the file.
The folder list SHALL refresh when the tab becomes visible.

#### Scenario: Edited in another program
- **GIVEN** "AGENTS.md" is open with no unsaved edits
- **WHEN** another program saves new text to "AGENTS.md"
- **THEN** within 2 seconds the sheet shows the new text and A4 says "AGENTS.md" changed on disk and was reloaded

#### Scenario: Changed on disk during edits
- **GIVEN** "AGENTS.md" is open with unsaved edits
- **WHEN** `git checkout` changes "AGENTS.md" and A4 then saves
- **THEN** "AGENTS.md" keeps the checked-out text, and a library page "AGENTS.md (conflict …)" holds A4's text and opens

### Requirement: Copies go to the library
Every copy A4 makes of a folder file SHALL be a library page, never a file.
This SHALL cover conflict copies, text kept when the file was deleted, drafts
that can't be applied, Fit to page results, and duplicates. A copy SHALL be
named after the file's path, with "/" shown as " › " and a leading period
dropped.

#### Scenario: Fit to page on a nested file
- **WHEN** Fit to page finishes for `.claude/skills/review/SKILL.md`
- **THEN** a library page "claude › skills › review › SKILL.md (fit)" opens as B, and no file is added to the folder

### Requirement: Recovering folder drafts
Drafts of folder files left by tabs that are gone SHALL be recovered once the
folder is connected. A draft SHALL be saved to the file when the file still
matches the draft's base. Otherwise it SHALL be saved as a library copy named
"<path> (recovered <date> <time>)".

#### Scenario: Crash while editing a file
- **GIVEN** a tab crashed with unsaved edits to "AGENTS.md", and the file hasn't changed since
- **WHEN** the user opens the workbench and the folder connects
- **THEN** "AGENTS.md" on disk contains the unsaved edits

### Requirement: Reconnecting after a reload
On load, A4 SHALL reopen the remembered folder without asking if the browser
still grants access. If the browser asks again, the folder section SHALL show
**Reconnect**, and files that were open SHALL reopen once access is granted.
If the folder no longer exists, A4 SHALL say so and offer Open folder… and
Forget.

#### Scenario: Access must be granted again
- **GIVEN** "AGENTS.md" was open in slot A, and the browser asks for access again
- **WHEN** the workbench loads
- **THEN** slot A shows a library page and the folder section shows Reconnect, and after the user grants access "AGENTS.md" reopens in slot A

#### Scenario: The folder was deleted
- **GIVEN** the remembered folder was deleted
- **WHEN** the workbench loads
- **THEN** the folder section says the folder wasn't found and offers Open folder… and Forget

### Requirement: Folder text stays on the device
A4 SHALL read and write folder files only on the device. No folder feature
SHALL send a file's text or path over the network. Fit to page SHALL keep
asking for consent on each call, for folder files as for library pages.

#### Scenario: Editing a file sends nothing
- **WHEN** the user opens, edits, and saves "AGENTS.md"
- **THEN** no network request carries its text or its path

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
