# Spec Delta

## ADDED Requirements

### Requirement: One score per change
Turning the Semantic repetition lens on SHALL score the page once. Each pause
in typing SHALL start at most one new score, and a result for text that has
since changed SHALL NOT be shown.

#### Scenario: Turning the lens on
- **WHEN** the author turns the Semantic repetition lens on and waits 3,000 ms without typing
- **THEN** the page is scored exactly once
