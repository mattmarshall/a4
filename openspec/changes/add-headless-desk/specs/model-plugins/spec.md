# Spec Delta

## MODIFIED Requirements

### Requirement: Host-enforced fit
For Transform and Generate, the host SHALL decide whether a result fits by
laying it out on the page's preset. A result fits when its rows used, counted
through the last row that contains a non-whitespace character as the analysis
counts them, are no more than the preset has, which is 60 on the Terminal
preset. A plugin's own claim that its output fits SHALL be ignored.

#### Scenario: A result that overflows
- **WHEN** a Transform returns text that lays out to 63 rows on the Terminal preset
- **THEN** the host marks the result as over by 3 rows

#### Scenario: Trailing blank lines
- **WHEN** a Transform returns 58 rows of text followed by 4 blank lines on the Terminal preset
- **THEN** the host counts 58 rows used and the result fits
