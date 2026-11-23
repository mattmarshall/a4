# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
