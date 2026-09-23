/*
 * JL-473 — turn an invite response into something honest to show the operator.
 *
 * POST /api/members has returned `email_status` and `email_error` since
 * JL-323, and the User Management page threw both away: it branched on whether
 * a password had been typed and reported "Invited ..." either way. So an invite
 * the provider rejected, one that was never attempted because SMTP is unset,
 * and one that was actually delivered all produced the same green toast — which
 * is the whole complaint behind this ticket.
 *
 * The member record IS created in every one of those cases, so this is a
 * severity-and-wording decision, not a flow change. Nothing here fails an
 * invite that the server considered successful.
 *
 *   sent            success, as before
 *   skipped         SMTP is not configured, so nobody was emailed. A WARNING,
 *                   not an error: the account exists and an admin can still
 *                   hand over credentials another way — but it must not read
 *                   as success, because no one was told anything.
 *   failed          the provider rejected it; surface its reason. The admin
 *                   needs the reason to know what to do next (a bad address,
 *                   an auth failure and a dead relay want different actions).
 *   not_applicable  a temporary password was set, so no invite was ever due.
 *   unknown/absent  a server older than JL-323, or a field we did not get. Fall
 *                   back to the original neutral wording rather than inventing
 *                   a claim about delivery that nothing supports.
 *
 * Lives in its own module because a page component may export only components —
 * `react-refresh/only-export-components` is an error in this repo, and it is
 * right: exporting this from the page would silently opt the whole page out of
 * fast refresh. It also makes the mapping unit-testable without mounting a page.
 *
 * @param {object|null} created      the 201 body from POST /api/members
 * @param {string} email             the address that was invited, for fallback wording
 * @param {boolean} hadPassword      whether a temporary password was supplied
 * @returns {{ message: string, severity: 'success'|'warning'|'error' }}
 */
export function describeInviteOutcome(created, email, hadPassword) {
  const who = created?.name || email

  if (hadPassword || created?.email_status === 'not_applicable') {
    return { message: `Created account for ${who}.`, severity: 'success' }
  }

  switch (created?.email_status) {
    case 'sent':
      return { message: `Invited ${who} — invitation email sent.`, severity: 'success' }

    case 'skipped':
      return {
        message: `${who} was added, but no invitation email was sent: email delivery is not configured on the server.`,
        severity: 'warning',
      }

    case 'failed':
      return {
        message: `${who} was added, but the invitation email could not be sent${created?.email_error ? `: ${created.email_error}` : '.'}`,
        severity: 'error',
      }

    default:
      return { message: `Invited ${who}.`, severity: 'success' }
  }
}

export default describeInviteOutcome
