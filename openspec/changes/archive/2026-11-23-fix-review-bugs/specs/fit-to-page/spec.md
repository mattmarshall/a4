# Spec Delta

## ADDED Requirements

### Requirement: A rewrite continues while its panel is hidden
A running Fit to page request SHALL continue when the Models section is
collapsed, the inspector is hidden, or focus mode turns on. While it runs, its
progress and a Cancel control SHALL stay reachable from the top bar.

#### Scenario: Collapsing the Models section mid-rewrite
- **GIVEN** a Fit to page rewrite is streaming
- **WHEN** the author collapses the Models section
- **THEN** the rewrite keeps going, the top bar shows its progress with Cancel, and the result opens in Compare when it finishes
