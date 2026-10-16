import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    adminUsername: { type: String, default: null },
    envManagedAdmin: { type: Boolean, default: false },
    adminCredentialFingerprint: { type: String, select: false },
    emailVerified: { type: Boolean, default: false },
    verificationMethod: {
      type: String,
      enum: ['brevo', 'development', 'admin', null],
      default: null,
    },
    tokenVersion: { type: Number, default: 0 },
    termsAcceptedAt: Date,
    termsVersion: String,
    marketingOptIn: { type: Boolean, default: false },
    profile: {
      stage: { type: String, default: '' },
      dueDate: { type: String, default: '' },
      services: { type: [String], default: [] },
      language: { type: String, default: '' },
      context: { type: String, maxlength: 1000, default: '' },
      completed: { type: Boolean, default: false },
    },
    otpHash: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpSentAt: { type: Date, select: false },
    otpWindow: { type: Date, select: false },
    otpSendCount: { type: Number, default: 0, select: false },
    resetTokenHash: { type: String, select: false, default: null },
    resetTokenExpires: { type: Date, select: false, default: null },
  },
  { timestamps: true },
)
userSchema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash)
}
userSchema.statics.hashPassword = (password) => bcrypt.hash(password, 12)
export default mongoose.model('User', userSchema)
