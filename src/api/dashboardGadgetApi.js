import { api } from './client.js'

// JL-152: dashboard gadget library + per-gadget data.
export const fetchGadgetCatalog = () =>
  api('/api/dashboards/gadgets/catalog')

export const fetchGadgetData = (type, config = {}) =>
  api('/api/dashboards/gadgets/data', {
    method: 'POST',
    body: JSON.stringify({ type, config }),
  })
