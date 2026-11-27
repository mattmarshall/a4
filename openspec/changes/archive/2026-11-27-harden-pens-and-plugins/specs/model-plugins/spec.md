## MODIFIED Requirements

### Requirement: Privacy gate
A plugin whose card says it sends page text off the device SHALL run only after
the author confirms that specific call. The confirmation SHALL name the
destination host, the plugin, the model, the page, and the number of
characters sent, and for an installed plugin its version and publisher.
Every such plugin, bundled or installed, pen or overlay, SHALL be confirmed
in the same dialog. Declining SHALL send nothing.

#### Scenario: Declining
- **WHEN** the author declines the confirmation for a remote plugin
- **THEN** no network request carrying page text is made and no page is created

#### Scenario: Consent is per call
- **GIVEN** the author confirmed one remote call
- **WHEN** they run the same plugin again
- **THEN** they are asked to confirm again

#### Scenario: Fit to page and an installed pen confirm alike
- **GIVEN** an installed remote pen whose card names `api.example.com`, and a 5,400-character page
- **WHEN** the author runs the pen on the page, and then runs Fit to page on it
- **THEN** both confirmations are the same dialog, each naming its host, its plugin, its model, the page, and 5,400 characters, and the pen's also names its version and publisher
