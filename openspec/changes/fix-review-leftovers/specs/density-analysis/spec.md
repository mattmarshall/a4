## MODIFIED Requirements

### Requirement: Actionable findings
Each threshold crossed SHALL produce a finding with a severity (critical,
warning, or info) and a concrete suggestion. A repetition finding SHALL name
the most repeated term and its count.

#### Scenario: Overflow finding
- **WHEN** the text overflows the page by 7 rows
- **THEN** a critical finding says the page is 7 rows over and suggests cutting or splitting by purpose

#### Scenario: Repeated term finding
- **WHEN** the page holds 14 rows that each read "status status r<n>", so "status" is the most repeated term with 28 occurrences, and repetition is at least 40%
- **THEN** a warning finding names "status" and 28 and suggests stating shared values once
