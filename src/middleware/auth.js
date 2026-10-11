import jwt from 'jsonwebtoken'
import User from '../models/User.js'

function readToken(req) {
  const value = req.headers.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7) : null
}

export async function optionalAuth(req, _res, next) {
  try {
    const token = readToken(req)
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET)
      req.user = await User.findById(payload.sub)
    }
  } catch {
    req.user = null
  }
  next()
}

export async function requireAuth(req, res, next) {
  try {
    const token = readToken(req)
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = await User.findById(payload.sub)
    if (!req.user) return res.status(401).json({ message: 'Account not found.' })
    next()
  } catch {
    res.status(401).json({ message: 'Invalid or expired session.' })
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Administrator access required.' })
  next()
}
