# Spec Delta

## ADDED Requirements

### Requirement: Exact text round trip
Every backend SHALL return exactly the text it was given, including a leading
byte-order mark (U+FEFF), and the revision returned by a write SHALL equal the
revision of the next read. A backend SHALL refuse text that isn't well-formed
Unicode (a lone surrogate) with an invalid-text error, instead of storing a
changed version.

#### Scenario: A page that starts with a byte-order mark
- **GIVEN** a library page created with the text "﻿hello"
- **WHEN** the page is read and then written with the revision of that read
- **THEN** the read returns "﻿hello" and the write succeeds without a conflict

#### Scenario: A lone surrogate
- **WHEN** a page is created with text containing an unpaired U+D800
- **THEN** the store refuses it with an invalid-text error and stores nothing
