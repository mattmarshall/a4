# Spec Delta

## Purpose

Finds sentences and fields that say the same thing in different words, using
an embedding model that runs in the browser. The author can cut restatements
the string-based Repetition lens cannot see.

## ADDED Requirements

### Requirement: Units of meaning
The scorer SHALL split the page into units:
- Prose: consecutive prose lines form a paragraph, and a list item starts a
  new one. Each sentence in a paragraph (ended by ".", "!", or "?" followed by
  whitespace or the end) is a unit.
- Structured and heading lines: each line is one unit.
- Short units: units with fewer than 12 non-whitespace characters are skipped.

#### Scenario: Sentences across wrapped lines
- **WHEN** a prose paragraph hard-wrapped over three lines contains two sentences
- **THEN** the scorer produces two units, each spanning the lines its sentence covers

#### Scenario: Short fields are skipped
- **WHEN** the page holds the field line "id: 7"
- **THEN** that line is not a unit

#### Scenario: List items
- **WHEN** a numbered list has two items without closing punctuation
- **THEN** each item is its own unit

### Requirement: Similarity
The scorer SHALL embed every unit with the bundled model and compare units by
cosine similarity. A unit SHALL count as restating another when their
similarity is at least 0.85. Units identical after trimming whitespace and
ignoring case SHALL NOT count, because duplicate lines are already reported.

#### Scenario: A paraphrase
- **GIVEN** the sentences "The deploy failed because the token expired." and "An expired token is why the deployment failed." and three unrelated sentences
- **WHEN** the page is scored
- **THEN** the paraphrase pair has the highest similarity on the page, and no unrelated pair reaches 0.85

### Requirement: Model lens values
The scorer SHALL produce a plane named "Semantic repetition". Each cell in a
unit SHALL hold `clamp((s − 0.70) / 0.30, 0, 1)`, where `s` is the unit's
highest similarity to any other unit. Cells outside every unit SHALL hold 0.

#### Scenario: Below the floor
- **WHEN** a unit's highest similarity is 0.62
- **THEN** every cell of that unit holds 0

#### Scenario: A strong match
- **WHEN** a unit's highest similarity is 0.91
- **THEN** every cell of that unit holds 0.7

### Requirement: Summary
The metrics panel SHALL show how many units restate another, and list up to 5
of the most similar pairs with their similarity to two decimals. Selecting a
pair SHALL select the later unit of the pair in the editor.

#### Scenario: Reviewing restatements
- **GIVEN** a scored page with 2 restating pairs
- **WHEN** the author selects the first pair in the list
- **THEN** the later sentence of that pair is selected on the sheet

### Requirement: Staying current
While the Semantic repetition lens is active, the page SHALL be rescored 1,500
ms after the author stops typing. Until the new result arrives, the sheet SHALL
show the Ink lens rather than stale values.

#### Scenario: Editing with the lens on
- **WHEN** the author deletes a restating sentence and pauses for 1,500 ms
- **THEN** the page is rescored and the remaining sentence no longer counts as restating

### Requirement: Local model
The scorer SHALL run entirely in the browser, and no page text SHALL leave the
device. Its model SHALL be downloaded only after the author asks, with the
download size shown first, and SHALL then be cached for later sessions.

#### Scenario: Offline after download
- **GIVEN** the model was downloaded in an earlier session
- **WHEN** the author scores a page with the network offline
- **THEN** scoring completes
