import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { Refresh } from './models.js'
import { safeUser, assert } from '../utils/validation.js'
import User from '../models/User.js'
import { verified } from '../services/verification.js'
function key() {
  const k = process.env.HEALTH_DATA_KEY
  if (process.env.NODE_ENV === 'production') assert(/^[a-fA-F0-9]{64}$/.test(k || ''), 'Set HEALTH_DATA_KEY to 64 hex characters.',503)
  return k && /^[a-fA-F0-9]{64}$/.test(k) ? Buffer.from(k,'hex') : createHash('sha256').update(process.env.JWT_SECRET || 'development-only').digest()
}
export function encrypt(value) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(),iv)
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()])
  return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64')).join('.')
}
export function decrypt(value, fallback = null) {
  if (!value) return fallback
  const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'))
  const cipher=createDecipheriv('aes-256-gcm',key(),iv);cipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'))
}
export const hash = value => createHash('sha256').update(value).digest('hex')
export function validSignature(body, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false
  return timingSafeEqual(createHmac('sha256',secret).update(body).digest(),Buffer.from(signature,'hex'))
}
const cookieOptions=()=>`Path=/api/auth; HttpOnly; SameSite=Lax; ${process.env.NODE_ENV==='production'?'Secure; ':''}`
export async function issueSession(user,res) {
  const token=randomBytes(40).toString('hex')
  await Refresh.create({hash:hash(token),user:user.id,version:user.tokenVersion||0,expiresAt:new Date(Date.now()+30*86400000)})
  res.setHeader('Set-Cookie',`garbhika_refresh=${token}; ${cookieOptions()}Max-Age=2592000`)
  return {token:jwt.sign({sub:user.id,purpose:'access',version:user.tokenVersion||0},process.env.JWT_SECRET,{expiresIn:'15m'}),user:safeUser(user)}
}
export async function rotateSession(req,res) {
  const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('garbhika_refresh='))?.split('=')[1]
  assert(raw && /^[a-f0-9]{80}$/.test(raw),'Sign in to continue.',401)
  const old=await Refresh.findOneAndDelete({hash:hash(raw),expiresAt:{$gt:new Date()}})
  assert(old,'Session expired. Sign in again.',401)
  const user=await User.findById(old.user)
  assert(user && user.status!=='suspended' && user.status!=='deleted' && (user.tokenVersion||0)===old.version,'Session expired.',401)
  assert(['admin','superadmin'].includes(user.role)||user.role==='expert'&&user.status==='pending'||verified(user),'Verify your email to continue.',401)
  return issueSession(user,res)
}
export function clearCookie(res) {res.setHeader('Set-Cookie',`garbhika_refresh=; ${cookieOptions()}Max-Age=0`)}

export function encryptBuffer(buffer){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv),data=Buffer.concat([c.update(buffer),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data])}
export function decryptBuffer(value){const b=Buffer.from(value),c=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()])}
