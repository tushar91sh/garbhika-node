// Legacy operational endpoints retained with metadata-only projections.
import { Router } from 'express'
import { requireAuth,requireAdmin } from '../middleware/auth.js'
import User from '../models/User.js'
import Booking from '../models/Booking.js'
import Inquiry from '../models/Inquiry.js'
import Subscriber from '../models/Subscriber.js'
import CommunityMember from '../models/CommunityMember.js'
import AuditLog from '../models/AuditLog.js'
import { assert } from '../utils/validation.js'
const router=Router();router.use(requireAuth,requireAdmin)
const resources={users:User,bookings:Booking,inquiries:Inquiry,subscribers:Subscriber,community:CommunityMember,audit:AuditLog}
router.get('/stats',async(_req,res)=>res.json({users:await User.countDocuments({role:{$in:['mother','user']}}),bookings:await Booking.countDocuments(),inquiries:await Inquiry.countDocuments(),subscribers:await Subscriber.countDocuments(),community:await CommunityMember.countDocuments()}))
router.get('/:resource',async(req,res)=>{const model=resources[req.params.resource];assert(model,'Resource not found.',404);const page=Math.max(1,Number(req.query.page)||1),limit=Math.max(1,Math.min(100,Number(req.query.limit)||25)),filter=req.params.resource==='users'?{role:{$in:['mother','user']}}:{},select=req.params.resource==='users'?'name email role status emailVerified createdAt':req.params.resource==='bookings'?'-notes -request.noteCipher':'';res.json({items:await model.find(filter).select(select).skip((page-1)*limit).limit(limit).sort({createdAt:-1}),page,limit,total:await model.countDocuments(filter)})})
export default router
