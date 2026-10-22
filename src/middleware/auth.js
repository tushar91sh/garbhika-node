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
  if (['suspended','deleted'].includes(user.status)) return null
  if (['admin','superadmin'].includes(user.role)) return user
  if (user.role==='expert' && user.status==='pending') return user
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
  if (!['admin','superadmin'].includes(req.user?.role))
    return res.status(403).json({ message: 'Administrator access required.' })
  next()
}

export const requireRole=(...roles)=>(req,res,next)=>{
 if(!(roles.includes(req.user?.role)||(roles.includes('mother')&&req.user?.role==='user')))return res.status(403).json({message:'This role cannot access this resource.'})
 if(req.user?.role==='expert'&&req.user.status!=='active'&&!req.path.startsWith('/expert/profile'))return res.status(403).json({message:'Expert approval is required before accessing this workspace.'})
 next()
}
