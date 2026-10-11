import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

// Random single-use token for password reset. Only the hash is stored, so a database leak cannot be used to reset accounts.
export function createResetToken() {
  const token = randomBytes(32).toString('hex')
  return { token, hash: sha256(token), expires: new Date(Date.now() + 30 * 60 * 1000) }
}

// Signed token for newsletter unsubscribe links. It carries the email and a purpose so it cannot be used as a login token.
export function unsubscribeToken(email) {
  return jwt.sign({ email, purpose: 'unsubscribe' }, process.env.JWT_SECRET)
}

export function readUnsubscribeToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET)
  if (payload.purpose !== 'unsubscribe' || !payload.email) throw new Error('Invalid token')
  return payload.email
}
