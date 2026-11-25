# Spec Delta

## ADDED Requirements

### Requirement: Where plugin code comes from
The host SHALL run only plugins bundled with the application and plugins the
author installed from a signed package that passed every check. It SHALL NOT
load plugin code from page content or imports. It SHALL fetch plugin code
from a URL only when the author installs from it or asks to check it for an
update.

#### Scenario: A page that names a plugin
- **WHEN** an imported page's text contains a URL to a plugin script
- **THEN** no code is fetched or run from it

#### Scenario: An import that carries a package
- **WHEN** the author imports a `.zip` of pages that also contains a plugin package
- **THEN** the pages are imported, and nothing is installed or run from the package

#### Scenario: Installed plugins follow the host's rules
- **GIVEN** an installed pen whose card sends text off the device
- **WHEN** the author runs it without confirming the call
- **THEN** the host refuses the call before the plugin receives any text, as it does for Fit to page

## REMOVED Requirements

### Requirement: Bundled plugins only
**Reason**: Authors can now install signed third-party pens and overlays.
"Where plugin code comes from" replaces this rule: it still forbids code from
page content and imports, and allows a URL only when the author installs from
it.
**Migration**: None. The bundled plugins are unchanged, and no plugin is
installed until an author installs one.
