import { api } from './client.js'

// JL-148: Inbound email → issue. Admin-only settings CRUD + processing log.
export const fetchInboundEmailSettings = () => api('/api/inbound-email/settings')

export const createInboundEmailSetting = (data) =>
  api('/api/inbound-email/settings', { method: 'POST', body: JSON.stringify(data) })

export const deleteInboundEmailSetting = (id) =>
  api(`/api/inbound-email/settings/${id}`, { method: 'DELETE' })
