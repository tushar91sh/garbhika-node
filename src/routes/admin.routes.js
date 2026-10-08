import { Router } from 'express'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import Inquiry from '../models/Inquiry.js'
import Booking from '../models/Booking.js'
import Subscriber from '../models/Subscriber.js'
import CommunityMember from '../models/CommunityMember.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const resources = { inquiries: Inquiry, bookings: Booking, subscribers: Subscriber, community: CommunityMember }

router.get('/:resource', async (req, res) => {
  const Model = resources[req.params.resource]
  if (!Model) return res.status(404).json({ message: 'Admin resource not found.' })
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const [items, total] = await Promise.all([
    Model.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Model.countDocuments(),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.patch('/:resource/:id/status', async (req, res) => {
  const Model = resources[req.params.resource]
  if (!Model || !['inquiries', 'bookings'].includes(req.params.resource)) {
    return res.status(404).json({ message: 'Status resource not found.' })
  }
  const item = await Model.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true })
  if (!item) return res.status(404).json({ message: 'Record not found.' })
  res.json({ item })
})

export default router
