import mongoose from 'mongoose'

const subjects = [
  'Service enquiries',
  'Consultation information',
  'Expert enquiries',
  'Community information',
  'Partnership opportunities',
  'General questions',
]

const inquirySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true },
    topic: { type: String, enum: subjects, required: true },
    message: { type: String, required: true, trim: true, minlength: 10, maxlength: 3000 },
    status: { type: String, enum: ['new', 'in_progress', 'resolved'], default: 'new', index: true },
  },
  { timestamps: true }
)

export { subjects }
export default mongoose.model('Inquiry', inquirySchema)
