# Spec Delta

## MODIFIED Requirements

### Requirement: Fit with repairs
A result SHALL fit when it lays out within the page's rows for its preset and
size: 60 on an A4 Terminal page, 42 on A5, and 29 on A6. When it does not fit,
the system SHALL ask the model again, saying how many rows are over. It SHALL
make at most 3 attempts in all, and if none fits, it SHALL keep the attempt
that uses the fewest rows and say by how many rows it is over.

#### Scenario: Fits on the second attempt
- **GIVEN** the first attempt lays out to 64 rows and the second to 58
- **WHEN** Fit to page runs on the Terminal preset
- **THEN** the second attempt is the result and no third attempt is made

#### Scenario: Never fits
- **GIVEN** the three attempts lay out to 70, 66, and 63 rows
- **WHEN** Fit to page runs on the Terminal preset
- **THEN** the 63-row attempt is kept and the author is told it is over by 3 rows

#### Scenario: Fitting an A5 card
- **GIVEN** an A5 page whose first attempt lays out to 44 rows and second to 40
- **WHEN** Fit to page runs on the Terminal preset
- **THEN** the second attempt is the result, since it fits within 42 rows
