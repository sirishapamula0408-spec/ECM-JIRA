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

/**
 * JL-150: Catalog of every event type the app can emit, with a human
 * description and a category for grouping in the admin UI. This is the single
 * source of truth for the event system — `EVENT_TYPES` is derived from it.
 */
export const EVENT_CATALOG = [
  { type: 'issue.created', description: 'A new issue was created.', category: 'Issues' },
  { type: 'issue.updated', description: 'An issue\'s fields were updated.', category: 'Issues' },
  { type: 'issue.status_changed', description: 'An issue transitioned to a new status.', category: 'Issues' },
  { type: 'comment.created', description: 'A comment was added to an issue.', category: 'Comments' },
  { type: 'sprint.started', description: 'A sprint was started.', category: 'Sprints' },
  { type: 'sprint.completed', description: 'A sprint was completed.', category: 'Sprints' },
]

/**
 * Pure helper returning the event catalog (a fresh shallow copy so callers
 * cannot mutate the shared constant). UNIT-TESTABLE.
 */
export function getEventCatalog() {
  return EVENT_CATALOG.map((e) => ({ ...e }))
}

/** Known event types emitted across the app (for reference / UI dropdowns). */
export const EVENT_TYPES = EVENT_CATALOG.map((e) => e.type)
