// JL-134: Org-wide security policy — enforced 2FA + password complexity/rotation.
import { Router } from 'express'
import { get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { normalizePolicy } from '../services/passwordPolicy.js'

const router = Router()

// Read the singleton org policy, falling back to normalized defaults if the row
// is somehow missing (e.g. fresh DB before the seed insert ran).
export async function getSecurityPolicy() {
  const row = await get(
    `SELECT require_mfa, min_password_length, require_uppercase, require_number,
            require_symbol, password_max_age_days, updated_at, updated_by
       FROM security_policy WHERE id = 1`,
  )
  return normalizePolicy(row || {})
}

// GET /api/security-policy — any authenticated user may read the policy so the
// frontend can render password rules + know whether MFA is required.
router.get('/security-policy', asyncHandler(async (req, res) => {
  const policy = await getSecurityPolicy()
  res.json(policy)
}))

// PUT /api/security-policy — Admin/Owner only. Upserts the single policy row.
router.put('/security-policy', requireRole('Admin'), asyncHandler(async (req, res) => {
  const body = req.body || {}
  const next = normalizePolicy(body)
  const updatedBy = req.user?.email || null

  await run(
    `INSERT INTO security_policy
       (id, require_mfa, min_password_length, require_uppercase, require_number,
        require_symbol, password_max_age_days, updated_at, updated_by)
     VALUES (1, ?, ?, ?, ?, ?, ?, NOW(), ?)
     ON CONFLICT (id) DO UPDATE SET
       require_mfa = EXCLUDED.require_mfa,
       min_password_length = EXCLUDED.min_password_length,
       require_uppercase = EXCLUDED.require_uppercase,
       require_number = EXCLUDED.require_number,
       require_symbol = EXCLUDED.require_symbol,
       password_max_age_days = EXCLUDED.password_max_age_days,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING id`,
    [
      next.require_mfa,
      next.min_password_length,
      next.require_uppercase,
      next.require_number,
      next.require_symbol,
      next.password_max_age_days,
      updatedBy,
    ],
  )

  const policy = await getSecurityPolicy()
  res.json(policy)
}))

export default router
