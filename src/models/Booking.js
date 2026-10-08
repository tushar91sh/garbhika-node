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

const bookingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true },
    preferredDate: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    interests: [{ type: String, enum: interests }],
    expertId: { type: String, trim: true, default: null },
    expertName: { type: String, trim: true, maxlength: 120, default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['requested', 'confirmed', 'completed', 'cancelled'], default: 'requested', index: true },
  },
  { timestamps: true }
)

export { interests }
export default mongoose.model('Booking', bookingSchema)
