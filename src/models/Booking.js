import mongoose from 'mongoose'

const interests = [
  'Garbh Sanskar',
  'Pregnancy yoga',
  'Pregnancy nutrition',
  'Psychological support',
  'Mental wellness',
  'Pregnancy guidance',
  'Community support',
]

// Fixed consultation times. A booking takes one expert + day + time slot.
const timeSlots = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00']
const statuses = ['requested', 'confirmed', 'completed', 'cancelled']
const activeStatuses = ['requested', 'confirmed']

const bookingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true },
    preferredDate: { type: Date, required: true },
    dateKey: { type: String, required: true },
    timeSlot: { type: String, enum: timeSlots, required: true },
    expertKey: { type: String, required: true },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    interests: [{ type: String, enum: interests }],
    expertId: { type: String, trim: true, default: null },
    expertName: { type: String, trim: true, maxlength: 120, default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: statuses, default: 'requested', index: true },
  },
  { timestamps: true }
)

// Database-level guard: two active bookings cannot take the same expert, day and time slot, even under concurrent requests.
bookingSchema.index(
  { expertKey: 1, dateKey: 1, timeSlot: 1 },
  { unique: true, partialFilterExpression: { status: { $in: activeStatuses } } }
)

export { interests, timeSlots, statuses, activeStatuses }
export default mongoose.model('Booking', bookingSchema)
