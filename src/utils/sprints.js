/*
 * JL-165 (fosasoft) — which sprints belong in a project's view.
 *
 * Sprints carry a projectId. One with projectId null is a shared legacy
 * sprint from before JL-165: it is still offered everywhere, as every sprint
 * used to be, until an Admin assigns it to a project. With no project in
 * view (a cross-project screen), every sprint is relevant.
 *
 * The server applies the same rule (sprintFitsProject in
 * server/routes/sprints.js) to every assignment, so a sprint this hides could
 * not have been used anyway.
 */
export function sprintsForProject(sprints, projectId) {
  const list = Array.isArray(sprints) ? sprints : []
  if (projectId === undefined || projectId === null || projectId === '') return list
  const id = Number(projectId)
  // A malformed row (null, or one with no projectId) must not throw; one with
  // no projectId reads as shared, the same as before JL-165.
  return list.filter((s) => s && (s.projectId == null || Number(s.projectId) === id))
}
