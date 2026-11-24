# Spec Delta

## ADDED Requirements

### Requirement: Losing the GPU
If the GPU device is lost while sheets render in 3D, each sheet SHALL try to
recreate its 3D rendering once. If that fails, it SHALL render flat, stay
editable, and report the change, as when WebGPU is unavailable.

#### Scenario: The device is lost and can't be recreated
- **GIVEN** a sheet rendering in 3D
- **WHEN** the GPU device is lost and a new device can't be created
- **THEN** the sheet renders flat with its text intact and dispatches `a4-render` with "flat"
