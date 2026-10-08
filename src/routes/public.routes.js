import { Router } from 'express'
import Inquiry, { subjects } from '../models/Inquiry.js'
import Booking, { interests as allowedInterests } from '../models/Booking.js'
import Subscriber from '../models/Subscriber.js'
import CommunityMember from '../models/CommunityMember.js'
import { optionalAuth } from '../middleware/auth.js'
import { assert, clean, validEmail } from '../utils/validation.js'
import { notifySubmission } from '../services/email.js'

const router = Router()

router.post('/inquiries', async (req, res) => {
  const payload = {
    name: clean(req.body.name), email: clean(req.body.email).toLowerCase(),
    topic: clean(req.body.topic), message: clean(req.body.message),
  }
  assert(payload.name.length >= 2, 'Please enter your name.')
  assert(validEmail(payload.email), 'Please enter a valid email address.')
  assert(subjects.includes(payload.topic), 'Please select a valid subject.')
  assert(payload.message.length >= 10, 'Message must be at least 10 characters.')
  const inquiry = await Inquiry.create(payload)
  notifySubmission('New Garbhika enquiry', [payload.name, payload.email, payload.topic, payload.message]).catch(() => {})
  res.status(201).json({ id: inquiry.id, submittedAt: inquiry.createdAt })
})

router.post('/bookings', optionalAuth, async (req, res) => {
  const selected = Array.isArray(req.body.interests) ? req.body.interests.filter((x) => allowedInterests.includes(x)) : []
  const payload = {
    name: clean(req.body.name), email: clean(req.body.email).toLowerCase(),
    preferredDate: req.body.preferredDate, notes: clean(req.body.notes), interests: selected,
    expertId: clean(req.body.expertId) || null, expertName: clean(req.body.expertName) || null,
    user: req.user?.id || null,
  }
  assert(payload.name.length >= 2, 'Please enter your name.')
  assert(validEmail(payload.email), 'Please enter a valid email address.')
  const date = new Date(payload.preferredDate)
  assert(!Number.isNaN(date.getTime()), 'Please select a valid preferred date.')
  const booking = await Booking.create(payload)
  notifySubmission('New Garbhika consultation request', [payload.name, payload.email, date.toISOString(), payload.expertName, selected.join(', '), payload.notes]).catch(() => {})
  res.status(201).json({ id: booking.id, status: booking.status, submittedAt: booking.createdAt })
})

router.post('/newsletter/subscribe', async (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  assert(validEmail(email), 'Please enter a valid email address.')
  const subscriber = await Subscriber.findOneAndUpdate({ email }, { email, active: true }, { upsert: true, new: true })
  res.status(201).json({ id: subscriber.id, subscribedAt: subscriber.updatedAt })
})

router.post('/community/join', async (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  assert(validEmail(email), 'Please enter a valid email address.')
  const member = await CommunityMember.findOneAndUpdate({ email }, { email, active: true }, { upsert: true, new: true })
  res.status(201).json({ id: member.id, joinedAt: member.updatedAt })
})

export default router
