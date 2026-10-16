import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { verified } from '../services/verification.js'
export async function resolveUser(req) {
  const value = req.headers.authorization || ''
  if (!value.startsWith('Bearer ')) return null
  let payload
  try {
    payload = jwt.verify(value.slice(7), process.env.JWT_SECRET)
  } catch {
    return null
  }
  if (payload.purpose !== 'access') return null
  const user = await User.findById(payload.sub)
  if (!user || payload.version !== (user.tokenVersion || 0)) return null
  if (user.role === 'admin') return user.envManagedAdmin ? user : null
  return verified(user) ? user : null
}
export async function optionalAuth(req, res, next) {
  try {
    req.user = await resolveUser(req)
    if (req.headers.authorization && !req.user)
      return res.status(401).json({ message: 'Invalid or expired session.' })
    next()
  } catch (error) {
    next(error)
  }
}
export async function requireAuth(req, res, next) {
  try {
    req.user = await resolveUser(req)
    if (!req.user)
      return res
        .status(401)
        .json({ message: 'Authentication required or session expired.' })
    next()
  } catch (error) {
    next(error)
  }
}
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin' || !req.user.envManagedAdmin)
    return res.status(403).json({ message: 'Administrator access required.' })
  next()
}
