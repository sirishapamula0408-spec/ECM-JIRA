// JL-330: snap-to-grid for the Workflow Editor canvas.
//
// Dropped nodes used to keep whatever coordinate the pointer happened to be at,
// so a diagram drifted out of alignment one drag at a time. 20px matches the
// canvas's dotted background (`background-size: 20px 20px` in
// WorkflowEditorPage.css) so a snapped node lands on a dot the user can see, and
// it is a multiple of the 10px arrow-key nudge, so keyboard nudges stay on the
// same grid.
//
// Lives outside the page module so the constant and the helper can be shared and
// unit-tested without breaking react-refresh's components-only export rule.

export const GRID_SIZE = 20

/** Round a canvas coordinate onto the layout grid (never negative). */
export function snapToGrid(value, grid = GRID_SIZE) {
  const snapped = Math.round(Number(value) / grid) * grid
  return Math.max(0, snapped)
}
