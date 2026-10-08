import mongoose from 'mongoose'

const communityMemberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default mongoose.model('CommunityMember', communityMemberSchema)
