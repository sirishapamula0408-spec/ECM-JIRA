import { fireWebhooks } from '../routes/webhooks.js'

/**
 * JL-59: Central event emitter for the webhook event system.
 *
 * Selects webhooks subscribed to `eventType` (or the `*` wildcard, or with no
 * explicit subscription list) and dispatches a signed payload to each via the
 * existing `fireWebhooks()` delivery pipeline (HMAC signing + retry/backoff +
 * delivery logging). Subscription filtering happens inside `fireWebhooks()`.
 *
 * Fire-and-forget by contract: callers should NOT await this in a way that
 * blocks the request, and all errors are swallowed so webhook failures can
 * never break the originating request flow.
 *
 * @param {string} eventType  Dotted event name, e.g. 'issue.created'.
 * @param {object} payload    Arbitrary event data to deliver.
 * @param {number|null} projectId  Optional project scope; global webhooks
 *                                  (project_id IS NULL) always receive the event.
 */
export async function emitEvent(eventType, payload, projectId = null) {
  try {
    await fireWebhooks(eventType, payload, projectId)
  } catch {
    // Never let event delivery break the main flow.
  }
}

/** Known event types emitted across the app (for reference / UI dropdowns). */
export const EVENT_TYPES = [
  'issue.created',
  'issue.updated',
  'issue.status_changed',
  'comment.created',
  'sprint.started',
  'sprint.completed',
]
