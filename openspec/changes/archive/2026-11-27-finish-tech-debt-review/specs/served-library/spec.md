## ADDED Requirements

### Requirement: Connecting by hand
Connecting from the Pages panel's Connect form SHALL reach the server before
it remembers anything. If A4 can use it, the address and token SHALL be
remembered and its pages shown. If A4 can't, the form SHALL stay open and
say why and what to do, for each reason in "When the server is down". The
address and token SHALL NOT be remembered, and the library shown SHALL NOT
change.

#### Scenario: Connecting by hand
- **GIVEN** `a4 serve` is running at 127.0.0.1:4320
- **WHEN** the author enters its address and token in the Connect form and chooses Connect
- **THEN** the form closes, the Pages panel shows the served library's pages, and a reload connects to it again

#### Scenario: Connecting while the server is stopped
- **GIVEN** no `a4 serve` is running at 127.0.0.1:4320
- **WHEN** the author enters that address and a token in the Connect form and chooses Connect
- **THEN** the form stays open and says `a4 serve` isn't running at 127.0.0.1:4320 and to start it, this browser's library stays shown, and after a reload the Pages panel still offers Connect a4 serve…

#### Scenario: A mistyped token
- **GIVEN** `a4 serve` is running at 127.0.0.1:4320
- **WHEN** the author enters its address with a token it refuses, and chooses Connect
- **THEN** the form stays open and says the server refused the token, with the address and token still filled in to correct, and nothing is remembered
