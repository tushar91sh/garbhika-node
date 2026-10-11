import { Router } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { assert, clean, passwordOk, safeUser, validEmail } from '../utils/validation.js'
import { isAdminEmail } from '../utils/roles.js'
import { createResetToken, sha256 } from '../services/tokens.js'
import { sendPasswordReset } from '../services/bookingMail.js'
import { recordAudit } from '../services/audit.js'

const router = Router()
const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
})

router.post('/register', async (req, res) => {
  const name = clean(req.body.name)
  const email = clean(req.body.email).toLowerCase()
  const password = req.body.password
  assert(name.length >= 2 && name.length <= 80, 'Name must be between 2 and 80 characters.')
  assert(validEmail(email), 'A valid email is required.')
  assert(passwordOk(password), 'Password must be 8 to 72 characters.')
  assert(!await User.exists({ email }), 'An account with this email already exists.', 409)

  const user = await User.create({
    name,
    email,
    passwordHash: await User.hashPassword(password),
    role: isAdminEmail(email) ? 'admin' : 'user',
  })
  res.status(201).json({ token: signToken(user), user: safeUser(user) })
})

router.post('/login', async (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  assert(validEmail(email) && password, 'Email and password are required.')
  const user = await User.findOne({ email }).select('+passwordHash')
  assert(user && await user.verifyPassword(password), 'Incorrect email or password.', 401)

  // ADMIN_EMAILS stays the source of truth for admin access, including accounts created before it was set.
  if (isAdminEmail(email) && user.role !== 'admin') {
    user.role = 'admin'
    await user.save()
  }
  res.json({ token: signToken(user), user: safeUser(user) })
})

router.get('/me', requireAuth, (req, res) => res.json({ user: safeUser(req.user) }))

// Always answers the same way so the form cannot be used to discover which emails have accounts.
router.post('/forgot-password', async (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  if (validEmail(email)) {
    const user = await User.findOne({ email })
    if (user) {
      const { token, hash, expires } = createResetToken()
      await User.updateOne({ _id: user._id }, { resetTokenHash: hash, resetTokenExpires: expires })
      sendPasswordReset(user, token)
    }
  }
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' })
})

router.post('/reset-password', async (req, res) => {
  const token = clean(req.body.token)
  const password = req.body.password
  assert(token.length === 64, 'This reset link is invalid or has expired.')
  assert(passwordOk(password), 'Password must be 8 to 72 characters.')
  const user = await User.findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } })
  assert(user, 'This reset link is invalid or has expired.')

  user.passwordHash = await User.hashPassword(password)
  user.resetTokenHash = null
  user.resetTokenExpires = null
  await user.save()
  await recordAudit({ actor: user, action: 'auth.password_reset', resource: 'users', resourceId: user.id })
  res.json({ message: 'Your password has been updated. You can now log in.' })
})

export default router
