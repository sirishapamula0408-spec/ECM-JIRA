import { api } from './client.js'

// JL-128: fetch the dependency graph + blocked-issue flags for a project.
export const fetchProjectDependencies = (projectId) =>
  api(`/api/projects/${projectId}/dependencies`)
