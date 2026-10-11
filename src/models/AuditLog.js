import mongoose from 'mongoose'

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorEmail: { type: String, default: null },
    action: { type: String, required: true, index: true },
    resource: { type: String, default: null },
    resourceId: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

export default mongoose.model('AuditLog', auditLogSchema)
