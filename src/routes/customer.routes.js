import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { requireAuth } from '../middleware/auth.js'
import Booking from '../models/Booking.js'
import User from '../models/User.js'
import { assert, clean, passwordOk, safeUser } from '../utils/validation.js'
import { validateProfile } from '../utils/profile.js'
import { isValidId } from '../utils/ids.js'
import { recordAudit } from '../services/audit.js'
import { sendBookingStatus } from '../services/bookingMail.js'

// Logged-in customer routes. Every query is scoped to req.user, so customers only ever see or change their own data.
const router = Router()
router.use(requireAuth)

router.get('/', (req, res) => res.json({ user: safeUser(req.user) }))

router.patch('/journey', async (req, res) => {
  assert(req.user.role === 'user', 'Customer account required.', 403)
  req.user.profile = validateProfile(req.body)
  await req.user.save()
  res.json({ user: safeUser(req.user) })
})

router.patch('/', async (req, res) => {
  const name = clean(req.body.name)
  assert(
    name.length >= 2 && name.length <= 80,
    'Name must be between 2 and 80 characters.',
  )
  req.user.name = name
  await req.user.save()
  res.json({ user: safeUser(req.user) })
})

router.post('/password', async (req, res) => {
  assert(
    !req.user.envManagedAdmin,
    'Admin credentials are managed through the server environment.',
    403,
  )
  const current = req.body.currentPassword
  const next = req.body.newPassword
  assert(
    typeof current === 'string' && current.length > 0,
    'Enter your current password.',
  )
  assert(passwordOk(next), 'New password must be 8 to 72 characters.')
  const user = await User.findById(req.user.id).select('+passwordHash')
  assert(
    await bcrypt.compare(current, user.passwordHash),
    'Your current password is incorrect.',
    400,
  )
  user.passwordHash = await User.hashPassword(next)
  user.tokenVersion = (user.tokenVersion || 0) + 1
  user.resetTokenHash = null
  user.resetTokenExpires = null
  await user.save()
  await recordAudit({
    actor: user,
    action: 'auth.password_change',
    resource: 'users',
    resourceId: user.id,
  })
  res.json({ message: 'Password updated.' })
})

router.get('/bookings', async (req, res) => {
  const bookings = await Booking.find({ user: req.user.id }).sort({
    preferredDate: -1,
  })
  res.json({ bookings })
})

router.patch('/bookings/:id/cancel', async (req, res) => {
  assert(isValidId(req.params.id), 'Invalid identifier.')
  const booking = await Booking.findOne({
    _id: req.params.id,
    user: req.user.id,
  })
  if (!booking) return res.status(404).json({ message: 'Booking not found.' })
  assert(
    ['requested', 'confirmed'].includes(booking.status),
    'This booking can no longer be cancelled.',
  )
  booking.status = 'cancelled'
  await booking.save()
  await recordAudit({
    actor: req.user,
    action: 'booking.cancel_by_customer',
    resource: 'bookings',
    resourceId: booking.id,
  })
  sendBookingStatus(booking)
  res.json({ booking })
})

export default router
