# Spec Delta

## MODIFIED Requirements

### Requirement: Model lens values
The scorer SHALL produce a plane named "Semantic repetition". Each cell in a
unit SHALL hold `clamp((s − 0.60) / 0.40, 0, 1)`, where `s` is the unit's
highest similarity to any other unit. Cells outside every unit SHALL hold 0.

#### Scenario: Below the floor
- **WHEN** a unit's highest similarity is 0.55
- **THEN** every cell of that unit holds 0

#### Scenario: A strong match
- **WHEN** a unit's highest similarity is 0.90
- **THEN** every cell of that unit holds 0.75

#### Scenario: A partial restatement
- **WHEN** a unit's highest similarity is 0.68
- **THEN** every cell of that unit holds 0.2, a light tint

### Requirement: Summary
The metrics panel SHALL show how many units restate another (similarity at
least 0.85). It SHALL list up to 5 of the closest pairs on the page with
similarity at least 0.60, most similar first, each with its similarity to two
decimals and a swatch of its tint. Selecting a pair SHALL select the later
unit of the pair in the editor.

#### Scenario: Reviewing restatements
- **GIVEN** a scored page with 2 restating pairs
- **WHEN** the author selects the first pair in the list
- **THEN** the later sentence of that pair is selected on the sheet

#### Scenario: A close pair below the restatement threshold
- **GIVEN** "This sheet is A4, quantized into a grid of 80 columns and 60 rows." and, later, "This is an A4 sheet of paper that is broken up into a grid."
- **WHEN** the page is scored
- **THEN** the pair is listed with a similarity between 0.60 and 0.85, both sentences are lightly tinted, and the restatement count does not include them
