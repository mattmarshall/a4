# workspace-layout Specification

## Purpose
Gives the page and the desk behind it most of the window. Frequent controls
stay in view, and everything else is one click away.

## Requirements

### Requirement: One-row top bar
The workbench SHALL keep a single row of controls above the desk: the A4 mark,
the Pages toggle, the open page's name and save status, the lens choice,
Single or Compare, zoom, and an Inspector toggle. It SHALL put all other
workbench controls in menus. At 1440 × 900, the row SHALL be at most 56 px
tall.

#### Scenario: The top bar at a laptop size
- **GIVEN** a 1440 × 900 window in Single view
- **WHEN** the workbench opens
- **THEN** the controls fit on one row at most 56 px tall, and the page's name and save status are on it

#### Scenario: The top bar on a narrower window
- **GIVEN** a 1100 × 800 window in Single view
- **WHEN** the workbench opens
- **THEN** the controls still fit on one row, and the save status shows as a colored dot whose text stays in its accessible name

### Requirement: Page, View, and Help menus
The **Page** menu SHALL hold New (blank, templates, worked samples), Copy,
Download, Print, and Clear. The **View** menu SHALL hold the grid preset, the
cell grid, the 3D or Flat rendering, Fit and actual size, the pose and camera
panel, and focus mode. The **Help** menu SHALL link to Why A4? and the
`<a4-sheet>` page.

#### Scenario: Changing the grid preset
- **WHEN** the user opens View and chooses the Pica preset
- **THEN** the sheet re-lays out on the Pica grid and the menu shows Pica as chosen

#### Scenario: Printing
- **WHEN** the user opens Page and chooses Print
- **THEN** the browser's print dialog opens for the page

### Requirement: Pose and camera panel
The fold, curl, and camera controls SHALL live in a floating panel that is
closed by default and opens from View or from a button on the desk. In 3D, a
Fold button SHALL float on the desk. The panel SHALL close with its close
button or Esc, and dragging the desk SHALL still turn the camera.

#### Scenario: Folding without the panel
- **GIVEN** the 3D rendering with the panel closed
- **WHEN** the user presses the Fold button on the desk
- **THEN** the active sheet plays the letter fold

#### Scenario: Opening the panel
- **WHEN** the user opens the pose and camera panel and moves Tilt
- **THEN** the sheets tilt, and the page's position in the layout does not change

### Requirement: Lens legend on the desk
When a lens other than Ink is active, its legend SHALL appear on the desk
beside the page. With Ink, no legend SHALL be shown.

#### Scenario: Choosing a lens
- **WHEN** the user chooses the Structure lens
- **THEN** a legend naming the line classes and their colors appears on the desk

#### Scenario: Back to Ink
- **WHEN** the user chooses Ink
- **THEN** the legend disappears

### Requirement: Collapsible inspector
Each inspector section SHALL collapse and expand from its title, and SHALL
remember its state across reloads. On first use, Verdict, the page, and
Findings SHALL be open, and Shape, Most repeated, and Models closed. Choosing a
model lens SHALL open the Models section.

#### Scenario: Remembering a section
- **GIVEN** the user collapses Findings
- **WHEN** they reload the workbench
- **THEN** Findings is still collapsed

#### Scenario: A model lens opens Models
- **GIVEN** the Models section is closed
- **WHEN** the user chooses the Semantic lens
- **THEN** the Models section opens and shows the semantic summary

### Requirement: Hiding the inspector
The Inspector toggle SHALL hide and show the whole inspector and remember the
choice. While it is hidden, the verdict SHALL stay visible in the top bar.
Below 1,100 px of window width, the inspector SHALL open as a drawer over the
desk, closed by default, rather than taking space beside the page.

#### Scenario: Hiding the inspector
- **WHEN** the user turns the inspector off
- **THEN** the desk takes the freed width, and the verdict chip shows in the top bar

#### Scenario: A narrow window
- **GIVEN** a window 900 px wide
- **WHEN** the user opens the inspector
- **THEN** it slides over the desk, and the page underneath keeps its size

### Requirement: Focus mode
Focus mode SHALL hide the top bar, the inspector, the library, and the pose
panel, leaving the page on the desk. It SHALL turn on from View or with the F
key when no text input has focus. It SHALL turn off with Esc or a visible exit
button.

#### Scenario: Entering and leaving focus
- **GIVEN** the sheet does not have keyboard focus
- **WHEN** the user presses F
- **THEN** only the desk and the page remain, and pressing Esc restores the previous layout

#### Scenario: Typing F on the page
- **GIVEN** the sheet has keyboard focus
- **WHEN** the user types F
- **THEN** an "F" is inserted in the page and focus mode stays off

### Requirement: Page fits the desk
In Single view with Fit zoom, the whole page SHALL be visible in the desk
without scrolling, in 3D and in Flat. At 1440 × 900, the page area SHALL start
no more than 70 px below the top of the window.

#### Scenario: The whole page at a laptop size
- **GIVEN** a 1440 × 900 window, Single view, and Fit zoom
- **WHEN** the workbench opens in 3D, and again in Flat
- **THEN** the sheet's top and bottom edges are both within the window, and the page area starts within 70 px of the top
