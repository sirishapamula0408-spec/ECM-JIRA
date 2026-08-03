import { Router } from 'express'
import { getSetting, setSetting } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { getSignupPolicy, setSignupPolicy, SIGNUP_POLICIES } from '../services/signupPolicy.js'

/*
 * JL-211 — Configurable workspace settings.
 *
 * Currently exposes the `project_creation_policy` toggle that governs who may
 * create projects:
 *   - 'all_members' (default) — any workspace Member+ may create (today's behaviour)
 *   - 'admins_only'           — only workspace Admin/Owner may create
 *
 * Stored in the generic `workspace_settings` key/value table (see db.js).
 */

const router = Router()

export const PROJECT_CREATION_POLICY_KEY = 'project_creation_policy'
export const PROJECT_CREATION_POLICIES = ['admins_only', 'all_members']
export const DEFAULT_PROJECT_CREATION_POLICY = 'all_members'

/** Resolve the effective project-creation policy, falling back to the default. */
export async function getProjectCreationPolicy() {
  const value = await getSetting(PROJECT_CREATION_POLICY_KEY, DEFAULT_PROJECT_CREATION_POLICY)
  return PROJECT_CREATION_POLICIES.includes(value) ? value : DEFAULT_PROJECT_CREATION_POLICY
}

// GET /api/workspace/settings — read workspace-wide settings (any signed-in user).
router.get('/settings', asyncHandler(async (req, res) => {
  const projectCreationPolicy = await getProjectCreationPolicy()
  const signupPolicy = await getSignupPolicy() // JL-325
  res.json({
    project_creation_policy: projectCreationPolicy,
    signup_policy: signupPolicy,
  })
}))

// PUT /api/workspace/settings — update workspace settings (Admin/Owner only).
// JL-325: accepts either key, so callers can update one without clobbering the
// other. At least one must be present.
router.put('/settings', requireRole('Admin'), asyncHandler(async (req, res) => {
  const nextProject = req.body?.project_creation_policy
  const nextSignup = req.body?.signup_policy

  if (nextProject === undefined && nextSignup === undefined) {
    res.status(400).json({ error: 'project_creation_policy is required' })
    return
  }

  if (nextProject !== undefined) {
    if (!PROJECT_CREATION_POLICIES.includes(nextProject)) {
      res.status(400).json({
        error: `project_creation_policy must be one of: ${PROJECT_CREATION_POLICIES.join(', ')}`,
      })
      return
    }
    await setSetting(PROJECT_CREATION_POLICY_KEY, nextProject)
  }

  if (nextSignup !== undefined) {
    if (!SIGNUP_POLICIES.includes(nextSignup)) {
      res.status(400).json({
        error: `signup_policy must be one of: ${SIGNUP_POLICIES.join(', ')}`,
      })
      return
    }
    await setSignupPolicy(nextSignup)
  }

  res.json({
    project_creation_policy: await getProjectCreationPolicy(),
    signup_policy: await getSignupPolicy(),
  })
}))

export default router
