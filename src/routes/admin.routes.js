import { Router } from 'express'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import User from '../models/User.js'
import Inquiry from '../models/Inquiry.js'
import Booking from '../models/Booking.js'
import Subscriber from '../models/Subscriber.js'
import CommunityMember from '../models/CommunityMember.js'
import AuditLog from '../models/AuditLog.js'
import { assert, escapeRegex, safeUser } from '../utils/validation.js'
import { isValidId } from '../utils/ids.js'
import { toCsv } from '../utils/csv.js'
import { recordAudit } from '../services/audit.js'
import { sendBookingStatus } from '../services/bookingMail.js'

const router = Router()
router.use(requireAuth, requireAdmin)

// Whitelist of admin-visible collections. Only listed fields are searchable and exported.
const resources = {
  users: {
    model: User,
    search: ['name', 'email'],
    columns: [
      'id',
      'name',
      'email',
      'role',
      'emailVerified',
      'profile',
      'createdAt',
    ],
  },
  inquiries: {
    model: Inquiry,
    search: ['name', 'email', 'message'],
    statuses: ['new', 'in_progress', 'resolved'],
    columns: ['id', 'name', 'email', 'topic', 'message', 'status', 'createdAt'],
  },
  bookings: {
    model: Booking,
    search: ['name', 'email', 'expertName'],
    statuses: ['requested', 'confirmed', 'completed', 'cancelled'],
    columns: [
      'id',
      'name',
      'email',
      'dateKey',
      'timeSlot',
      'expertName',
      'interests',
      'notes',
      'status',
      'createdAt',
    ],
  },
  subscribers: {
    model: Subscriber,
    search: ['email'],
    columns: ['id', 'email', 'active', 'createdAt'],
  },
  community: {
    model: CommunityMember,
    search: ['email'],
    columns: ['id', 'email', 'active', 'createdAt'],
  },
}

const config = (name) =>
  Object.hasOwn(resources, name) ? resources[name] : null
const withId = (doc) => ({
  id: String(doc._id),
  ...doc,
  _id: undefined,
  __v: undefined,
})

function buildFilter(cfg, query) {
  const filter =
    cfg.model === User ? { role: 'user', envManagedAdmin: { $ne: true } } : {}
  if (query.status) {
    assert(cfg.statuses?.includes(query.status), 'Unknown status filter.')
    filter.status = query.status
  }
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : ''
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i')
    filter.$or = cfg.search.map((field) => ({ [field]: pattern }))
  }
  return filter
}

router.get('/stats', async (_req, res) => {
  const [
    users,
    newInquiries,
    requestedBookings,
    confirmedBookings,
    subscribers,
    community,
    recentInquiries,
    recentBookings,
  ] = await Promise.all([
    User.countDocuments({ role: 'user', envManagedAdmin: { $ne: true } }),
    Inquiry.countDocuments({ status: 'new' }),
    Booking.countDocuments({ status: 'requested' }),
    Booking.countDocuments({ status: 'confirmed' }),
    Subscriber.countDocuments({ active: true }),
    CommunityMember.countDocuments({ active: true }),
    Inquiry.find().sort({ createdAt: -1 }).limit(5).lean(),
    Booking.find().sort({ createdAt: -1 }).limit(5).lean(),
  ])
  res.json({
    totals: {
      users,
      newInquiries,
      requestedBookings,
      confirmedBookings,
      subscribers,
      communityMembers: community,
    },
    recentInquiries: recentInquiries.map(withId),
    recentBookings: recentBookings.map(withId),
  })
})

router.get('/audit', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const [items, total] = await Promise.all([
    AuditLog.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(),
  ])
  res.json({
    items: items.map(withId),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  })
})

router.get('/:resource', async (req, res) => {
  const cfg = config(req.params.resource)
  if (!cfg)
    return res.status(404).json({ message: 'Admin resource not found.' })
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const filter = buildFilter(cfg, req.query)
  const [items, total] = await Promise.all([
    cfg.model
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    cfg.model.countDocuments(filter),
  ])
  res.json({
    items: items.map(withId),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  })
})

// CSV export of the current filter (no page limit). Defined before /:resource/:id so "export.csv" is not treated as an id.
router.get('/:resource/export.csv', async (req, res) => {
  const cfg = config(req.params.resource)
  if (!cfg)
    return res.status(404).json({ message: 'Admin resource not found.' })
  const items = await cfg.model
    .find(buildFilter(cfg, req.query))
    .sort({ createdAt: -1 })
    .limit(10000)
    .lean()
  await recordAudit({
    actor: req.user,
    action: 'admin.export_csv',
    resource: req.params.resource,
    details: { count: items.length, filter: req.query },
  })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${req.params.resource}-${new Date().toISOString().slice(0, 10)}.csv"`,
  )
  res.send(
    toCsv(
      items.map((item) => withId(item)),
      cfg.columns,
    ),
  )
})

router.get('/:resource/:id', async (req, res) => {
  const cfg = config(req.params.resource)
  if (!cfg)
    return res.status(404).json({ message: 'Admin resource not found.' })
  assert(isValidId(req.params.id), 'Invalid identifier.')
  const item = await cfg.model
    .findOne({ _id: req.params.id, ...buildFilter(cfg, {}) })
    .lean()
  if (!item) return res.status(404).json({ message: 'Record not found.' })
  res.json({ item: withId(item) })
})

router.patch('/:resource/:id/status', async (req, res) => {
  const name = req.params.resource
  const cfg = config(name)
  if (!cfg?.statuses)
    return res.status(404).json({ message: 'Status resource not found.' })
  assert(isValidId(req.params.id), 'Invalid identifier.')
  const status = req.body.status
  assert(
    cfg.statuses.includes(status),
    `Status must be one of: ${cfg.statuses.join(', ')}.`,
  )

  const item = await cfg.model.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true, runValidators: true },
  )
  if (!item) return res.status(404).json({ message: 'Record not found.' })
  await recordAudit({
    actor: req.user,
    action: 'admin.status_update',
    resource: name,
    resourceId: item.id,
    details: { status },
  })
  if (name === 'bookings') sendBookingStatus(item)
  res.json({ item: withId(item.toObject()) })
})

// Administrator provisioning is server-only; no API may promote customers.
export default router
