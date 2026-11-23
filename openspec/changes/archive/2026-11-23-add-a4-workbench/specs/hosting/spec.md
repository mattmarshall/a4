# Spec Delta

## Purpose

Defines where A4 is served in production and the guarantees the deployment
makes about routes and data handling.

## ADDED Requirements

### Requirement: Production domain
The production application SHALL be served over HTTPS at https://a4.marsh.build.

#### Scenario: Visiting production
- **WHEN** a user opens https://a4.marsh.build
- **THEN** the workbench loads over a valid TLS certificate

### Requirement: Routes
The application SHALL serve the workbench at / and the explainer at /why, and
SHALL respond with a not-found page for other paths.

#### Scenario: Unknown path
- **WHEN** a user opens /does-not-exist
- **THEN** the response status is 404

### Requirement: No server-side page storage
The deployment SHALL NOT store or log page text on the server; the server only
delivers the application.

#### Scenario: Editing generates no writes
- **WHEN** a user edits and saves a page
- **THEN** no request carrying page text reaches the server
