import { api } from './client.js'

export const GIT_LINK_TYPES = ['branch', 'commit', 'pull_request']

export const GIT_LINK_TYPE_LABELS = {
  branch: 'Branch',
  commit: 'Commit',
  pull_request: 'Pull request',
}

export const fetchGitLinks = (issueId) =>
  api(`/api/issues/${issueId}/git-links`)

export const createGitLink = (issueId, { linkType, ref, url, title, author }) =>
  api(`/api/issues/${issueId}/git-links`, {
    method: 'POST',
    body: JSON.stringify({ linkType, ref, url, title, author }),
  })

export const deleteGitLink = (linkId) =>
  api(`/api/git-links/${linkId}`, { method: 'DELETE' })

export const ingestGitEvent = (payload) =>
  api('/api/git/ingest', { method: 'POST', body: JSON.stringify(payload) })
