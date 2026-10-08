import { Router } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { assert, clean, safeUser, validEmail } from '../utils/validation.js'

const router = Router()
const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
})

router.post('/register', async (req, res) => {
  const name = clean(req.body.name)
  const email = clean(req.body.email).toLowerCase()
  const password = String(req.body.password || '')
  assert(name.length >= 2, 'Name must be at least 2 characters.')
  assert(validEmail(email), 'A valid email is required.')
  assert(password.length >= 8, 'Password must be at least 8 characters.')
  assert(!await User.exists({ email }), 'An account with this email already exists.', 409)

  const admins = (process.env.ADMIN_EMAILS || '').split(',').map((item) => item.trim().toLowerCase())
  const user = await User.create({
    name,
    email,
    passwordHash: await User.hashPassword(password),
    role: admins.includes(email) ? 'admin' : 'user',
  })
  res.status(201).json({ token: signToken(user), user: safeUser(user) })
})

router.post('/login', async (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  const password = String(req.body.password || '')
  assert(validEmail(email) && password, 'Email and password are required.')
  const user = await User.findOne({ email }).select('+passwordHash')
  assert(user && await user.verifyPassword(password), 'Incorrect email or password.', 401)
  res.json({ token: signToken(user), user: safeUser(user) })
})

router.get('/me', requireAuth, (req, res) => res.json({ user: safeUser(req.user) }))

export default router
