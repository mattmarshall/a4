# Spec Delta

## MODIFIED Requirements

### Requirement: Typed page store contract
All page persistence SHALL go through typed contracts with typed errors for
not found, name taken, invalid name, conflict, and storage unavailable. Every
backend SHALL implement the core operations: list, read, create, and write.
Library backends SHALL also implement rename, trash, list trash, restore, and
purge. Application code SHALL NOT depend on a specific backend.

#### Scenario: Swapping backends
- **WHEN** the same core contract test suite runs against every backend, including the folder backend
- **THEN** every backend passes it without backend-specific changes to the tests

#### Scenario: Library operations
- **WHEN** the library contract test suite runs against the OPFS, localStorage, and in-memory backends
- **THEN** each passes it without backend-specific changes to the tests
