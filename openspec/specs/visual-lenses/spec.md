# visual-lenses Specification

## Purpose

Lets the author see, on the sheet itself, where the cells go: meaning or
scaffolding, new information or repetition, narrative or fragments.

## Requirements

### Requirement: One active lens
The system SHALL offer the lenses Ink, Syntax, Repetition, Structure, and
Tokens, plus one model lens for each plane a Score plugin has produced for the
page. Exactly one lens SHALL be active at a time, with Ink as the default.
Lenses SHALL change only presentation, never the page text.

#### Scenario: Switching lenses keeps the text
- **WHEN** the user switches from Ink to Syntax and back
- **THEN** the page text is unchanged and editing continues to work in each lens

#### Scenario: Choosing a model lens
- **GIVEN** the Semantic repetition plugin has scored the page
- **WHEN** the user chooses the Semantic repetition lens
- **THEN** it replaces the previous lens, and the page text is unchanged

### Requirement: Syntax lens
In the Syntax lens, syntax characters (as defined by density analysis) SHALL be
emphasized in an accent color and all other characters de-emphasized.

#### Scenario: JSON braces stand out
- **WHEN** the Syntax lens is active on a page containing `{"a": 1}`
- **THEN** the characters { " : } are emphasized and the letter a and digit 1 are de-emphasized

### Requirement: Repetition lens
In the Repetition lens, every occurrence of a term that appears more than once
SHALL be highlighted, with stronger highlighting for terms with higher counts.

#### Scenario: Heat follows frequency
- **WHEN** the Repetition lens is active and "status" appears 10 times and "owner" appears 2 times
- **THEN** occurrences of "status" are highlighted more strongly than occurrences of "owner"

### Requirement: Structure lens
In the Structure lens, each line SHALL be tinted by its class (prose,
structured, heading), and a legend SHALL name the classes and their colors.

#### Scenario: Prose and fields are distinguishable
- **WHEN** the Structure lens is active on a page mixing sentences and `key: value` lines
- **THEN** sentence lines and field lines carry different tints and the legend explains them

### Requirement: Tokens lens
In the Tokens lens, adjacent estimated tokens SHALL alternate between two
shades so token boundaries are visible.

#### Scenario: Token boundaries
- **WHEN** the Tokens lens is active on "hello world"
- **THEN** "hello" and " world" carry different shades

### Requirement: Margin ink gauge
The right margin SHALL show, for every used row, a bar whose length is that
row's non-whitespace characters divided by the column count, aligned with the
row, in every lens.

#### Scenario: Full and empty rows
- **WHEN** row 1 holds 80 non-whitespace characters and row 2 is blank
- **THEN** the gauge for row 1 is full length and row 2 has no bar

### Requirement: Cell grid
The system SHALL offer a toggle that draws a faint grid of the page cells
behind the text.

#### Scenario: Showing the grid
- **WHEN** the user turns on the grid
- **THEN** cell boundaries for all columns and rows are visible on the sheet

### Requirement: Model lens
In a model lens, each cell SHALL be tinted in proportion to its value, from no
tint at 0 to the strongest tint at 1. A legend SHALL name the plane and the
plugin that produced it. A model lens SHALL be painted only while the page text
equals the text it was computed for.

#### Scenario: Heat follows the values
- **WHEN** a model lens holds 1 for the cells of one sentence and 0 elsewhere
- **THEN** only that sentence is tinted, and the legend names the plane and its plugin

#### Scenario: Stale values are not painted
- **WHEN** the author edits the page after it was scored
- **THEN** no model values are painted until a new score for the current text arrives
