import AuditLog from '../models/AuditLog.js'
import { logger } from '../config/logger.js'

// Records an admin or account action. Failures are logged but never block the action itself.
export async function recordAudit({ actor, action, resource = null, resourceId = null, details = {} }) {
  try {
    await AuditLog.create({
      actor: actor?.id || null,
      actorEmail: actor?.email || null,
      action,
      resource,
      resourceId: resourceId ? String(resourceId) : null,
      details,
    })
  } catch (error) {
    logger.error('Failed to write audit log', { action, error: error.message })
  }
}
