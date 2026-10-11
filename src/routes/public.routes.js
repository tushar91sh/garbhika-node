import { Router } from 'express'
import Inquiry, { subjects } from '../models/Inquiry.js'
import Booking, { interests as allowedInterests, timeSlots, activeStatuses } from '../models/Booking.js'
import Subscriber from '../models/Subscriber.js'
import CommunityMember from '../models/CommunityMember.js'
import { optionalAuth } from '../middleware/auth.js'
import { assert, clean, dayKey, validEmail } from '../utils/validation.js'
import { notifySubmission } from '../services/email.js'
import { sendBookingReceived } from '../services/bookingMail.js'
import { readUnsubscribeToken } from '../services/tokens.js'

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

// Times still free for an expert (or general consultations) on one day.
router.get('/bookings/availability', async (req, res) => {
  const date = clean(req.query.date)
  const day = dayKey(date)
  assert(day && /^\d{4}-\d{2}-\d{2}$/.test(date), 'Please provide a valid date (YYYY-MM-DD).')
  assert(day >= new Date().toISOString().slice(0, 10), 'Please choose today or a later date.')
  const expertKey = clean(req.query.expertId) || 'general'
  const taken = await Booking.find({ expertKey, dateKey: day, status: { $in: activeStatuses } }).distinct('timeSlot')
  res.json({
    date: day,
    slots: timeSlots.map((time) => ({ time, available: !taken.includes(time) })),
  })
})

router.post('/bookings', optionalAuth, async (req, res) => {
  const selected = Array.isArray(req.body.interests) ? req.body.interests.filter((x) => allowedInterests.includes(x)) : []
  const preferredDate = new Date(req.body.preferredDate)
  const day = dayKey(req.body.preferredDate)
  const payload = {
    name: clean(req.body.name), email: clean(req.body.email).toLowerCase(),
    preferredDate, dateKey: day, timeSlot: clean(req.body.timeSlot),
    expertKey: clean(req.body.expertId) || 'general',
    notes: clean(req.body.notes), interests: selected,
    expertId: clean(req.body.expertId) || null, expertName: clean(req.body.expertName) || null,
    user: req.user?.id || null,
  }
  assert(payload.name.length >= 2, 'Please enter your name.')
  assert(validEmail(payload.email), 'Please enter a valid email address.')
  assert(day, 'Please select a valid preferred date.')
  assert(day >= new Date().toISOString().slice(0, 10), 'Please choose today or a later date.')
  assert(timeSlots.includes(payload.timeSlot), 'Please choose a valid time slot.')

  try {
    const booking = await Booking.create(payload)
    sendBookingReceived(booking)
    notifySubmission('New Garbhika consultation request', [payload.name, payload.email, day, payload.timeSlot, payload.expertName, selected.join(', '), payload.notes]).catch(() => {})
    res.status(201).json({ id: booking.id, status: booking.status, submittedAt: booking.createdAt })
  } catch (error) {
    if (error?.code === 11000) {
      error.status = 409
      error.message = 'That time slot is already booked. Please choose another time.'
    }
    throw error
  }
})

router.post('/newsletter/subscribe', async (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  assert(validEmail(email), 'Please enter a valid email address.')
  const subscriber = await Subscriber.findOneAndUpdate({ email }, { email, active: true }, { upsert: true, new: true })
  res.status(201).json({ id: subscriber.id, subscribedAt: subscriber.updatedAt })
})

// Target of the unsubscribe link in every newsletter. Works without logging in.
router.get('/newsletter/unsubscribe', async (req, res) => {
  let email
  try {
    email = readUnsubscribeToken(clean(req.query.token))
  } catch {
    return res.status(400).json({ message: 'This unsubscribe link is invalid.' })
  }
  await Subscriber.updateOne({ email }, { active: false })
  res.json({ message: 'You have been unsubscribed from the Garbhika newsletter.' })
})

router.post('/community/join', async (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  assert(validEmail(email), 'Please enter a valid email address.')
  const member = await CommunityMember.findOneAndUpdate({ email }, { email, active: true }, { upsert: true, new: true })
  res.status(201).json({ id: member.id, joinedAt: member.updatedAt })
})

export default router
