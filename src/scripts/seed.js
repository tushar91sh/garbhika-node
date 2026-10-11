// Usage: node src/scripts/seed.js
// Creates demo data for local development. Refuses to run in production.
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import User from '../models/User.js'
import Booking from '../models/Booking.js'
import Inquiry from '../models/Inquiry.js'

if (process.env.NODE_ENV === 'production') {
  console.error('Seeding is disabled in production.')
  process.exit(1)
}

await mongoose.connect(process.env.MONGODB_URI)
const password = process.env.SEED_PASSWORD || randomBytes(6).toString('hex')
const customer = await User.findOneAndUpdate(
  { email: 'customer@garbhika.test' },
  { name: 'Demo Customer', email: 'customer@garbhika.test', role: 'user', passwordHash: await User.hashPassword(password) },
  { upsert: true, new: true }
)

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const demoBookings = [
  { name: 'Demo Customer', email: customer.email, dateKey: day(3), timeSlot: '10:30', expertKey: 'general', interests: ['Pregnancy yoga'], status: 'requested', user: customer.id },
  { name: 'Asha Verma', email: 'asha@example.com', dateKey: day(4), timeSlot: '14:00', expertKey: 'priya-malhotra', expertId: 'priya-malhotra', expertName: 'Priya Malhotra', status: 'confirmed' },
]
for (const item of demoBookings) {
  const exists = await Booking.exists({ expertKey: item.expertKey, dateKey: item.dateKey, timeSlot: item.timeSlot, status: { $in: ['requested', 'confirmed'] } })
  if (!exists) await Booking.create({ ...item, preferredDate: new Date(`${item.dateKey}T00:00:00Z`) })
}
await Inquiry.create({ name: 'Riya Sen', email: 'riya@example.com', topic: 'General questions', message: 'Do you offer weekend sessions for working mothers?' }).catch(() => {})

console.log(`Seeded demo data. Customer login: customer@garbhika.test / ${process.env.SEED_PASSWORD ? '(from SEED_PASSWORD)' : password}`)
await mongoose.disconnect()
