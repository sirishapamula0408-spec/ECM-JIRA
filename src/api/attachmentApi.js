import { api } from './client.js'

const TOKEN_KEY = 'jira_auth_token'
function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export const fetchAttachments = (issueId) =>
  api(`/api/issues/${issueId}/attachments`)

// Read a File as base64 and upload it as JSON (no multipart dependency)
export function uploadAttachment(issueId, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataBase64 = String(reader.result).split(',')[1] || ''
      api(`/api/issues/${issueId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, mime: file.type || 'application/octet-stream', dataBase64 }),
      }).then(resolve).catch(reject)
    }
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

export const deleteAttachment = (attachmentId) =>
  api(`/api/attachments/${attachmentId}`, { method: 'DELETE' })

// Download via authenticated fetch → blob (a plain href can't send the auth header)
export async function downloadAttachment(attachment) {
  const res = await fetch(`/api/attachments/${attachment.id}/download`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error('Download failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = attachment.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
