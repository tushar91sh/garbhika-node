import {bookingReadiness} from './bookability.js'
import {scheduledOn,scheduleLabel} from './schedules.js'
import {credentialBlock} from './credentials.js'
import {weeklyAdherence as adherence} from './schedules.js'
import { Router } from 'express'
import {loadCarePolicy} from './configuration.js'
import mongoose from 'mongoose'
import User from '../models/User.js'
import Booking from '../models/Booking.js'
import AuditLog from '../models/AuditLog.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { assert, clean } from '../utils/validation.js'
import { Mother, Expert, Service, Availability, Note, Task, TaskCheck, Journal, LiveNote, RefundRequest, CareTemplate, Settings, Payout, Thread, Group, AccessLog, CommunityPost } from './models.js'
import { alert, slotsFor, refundBooking, transaction, motherFor, createBooking } from './booking.js'
import { cancellationPolicy, DAY, MIN, istDate, plans, redFlags } from './policy.js'
import { encrypt, decrypt } from './security.js'
import { sharedHealth } from './health.js'
const router=Router()
const mother=[requireAuth,requireRole('mother')], expert=[requireAuth,requireRole('expert')], admin=[requireAuth,requireRole('admin','superadmin')]
const id=value=>{assert(mongoose.isValidObjectId(value),'Invalid identifier.');return value}
async function audit(req,action,target,before,after,reason){await AuditLog.create({actor:req.user.id,actorEmail:req.user.email,action,resource:'care',resourceId:String(target),details:{before,after,reason}})}
async function eligible(expertId,motherId){assert(await Booking.exists({expert:expertId,mother:motherId,status:{$in:['confirmed','in_progress','completed']}}),'An eligible client booking is required.',403)}
export {weeklyAdherence as adherence} from './schedules.js'
async function planFor(motherId){const items=await Task.find({mother:motherId}).populate('expert','name'),checks=await TaskCheck.find({mother:motherId,date:{$gte:istDate(new Date(Date.now()-7*DAY))}});return {items:items.map(t=>({...t.toObject(),dueToday:scheduledOn(t,istDate()),scheduleLabel:scheduleLabel(t)})),checks,adherence:adherence(items,checks)}}
router.get('/me/care-plan',...mother,async(req,res)=>res.json(await planFor(req.user.id)))
router.get('/expert/clients/:id',...expert,async(req,res)=>{
 const motherId=id(req.params.id);await eligible(req.user.id,motherId)
 let health=null;try{health=await sharedHealth(req.user,motherId)}catch(e){if(![403,404].includes(e.status))throw e}
 const plan=await planFor(motherId)
 res.json({user:await User.findById(motherId).select('name email'),health,tasks:plan.items,adherence:plan.adherence,bookings:await Booking.find({expert:req.user.id,mother:motherId}).populate('service','title').select('-request.noteCipher -notes').sort({startAt:-1})})
})
router.post('/clients/:id/tasks/from-template',...expert,async(req,res)=>{
 const motherId=id(req.params.id);await eligible(req.user.id,motherId)
 const t=await CareTemplate.findById(id(req.body.templateId));assert(t,'Template not found.',404)
 const task=await Task.create({mother:motherId,expert:req.user.id,title:t.title,category:t.category,frequency:t.frequency,templateId:t.id,startAt:new Date()})
 await alert(motherId,'plan.updated','Care plan updated','Your expert assigned a care-plan task.');res.status(201).json({task})
})
router.patch('/tasks/:id',...expert,async(req,res)=>{
 const t=await Task.findOne({_id:id(req.params.id),expert:req.user.id});assert(t,'You can edit only your own tasks.',403)
 await eligible(req.user.id,t.mother)
 if(req.body.title!==undefined){assert(clean(req.body.title).length>0,'Task title is required.');t.title=clean(req.body.title).slice(0,300)}
 if(req.body.frequency!==undefined){assert(['daily','weekly','as needed','3x week'].includes(req.body.frequency),'Invalid frequency.');t.frequency=req.body.frequency}
 if(req.body.category!==undefined){assert(['Nutrition','Movement','Mind'].includes(req.body.category),'Invalid category.');t.category=req.body.category}
 await t.save();await alert(t.mother,'plan.updated','Care plan updated','Your expert updated a task.');res.json({task:t})
})
router.get('/bookings/:id/note',...expert,async(req,res)=>{
 const b=await Booking.findOne({_id:id(req.params.id),expert:req.user.id});assert(b,'Booking not found.',404)
 const note=await Note.findOne({booking:b.id}).select('+privateCipher');await AccessLog.create({actor:req.user.id,mother:b.mother,resource:'note'})
 res.json({note:note?{...note.toObject(),privateNotes:decrypt(note.privateCipher,''),privateCipher:undefined,versions:undefined}:null})
})
router.patch('/notes/:id',...expert,async(req,res,next)=>{
 const n=await Note.findOne({_id:id(req.params.id),expert:req.user.id});assert(n,'Note not found.',404)
 req.url='/bookings/'+n.booking+'/note';req.method='POST';next()
})
router.get('/bookings/:id/live-notes',...expert,async(req,res)=>{
 const b=await Booking.findOne({_id:id(req.params.id),expert:req.user.id});assert(b,'Booking not found.',404)
 const draft=await LiveNote.findOne({booking:b.id}).select('+cipher');let health=null
 try{health=await sharedHealth(req.user,b.mother)}catch(e){if(![403,404].includes(e.status))throw e}
 res.json({text:decrypt(draft?.cipher,''),health})
})
router.put('/bookings/:id/live-notes',...expert,async(req,res)=>{
 const b=await Booking.findOne({_id:id(req.params.id),expert:req.user.id,status:{$in:['confirmed','in_progress','completed']}});assert(b,'Booking not found.',404)
 assert(typeof req.body.text==='string'&&req.body.text.length<=10000,'Live notes must be at most 10,000 characters.')
 await LiveNote.updateOne({booking:b.id},{$set:{expert:req.user.id,cipher:encrypt(req.body.text)}},{upsert:true});res.json({ok:true})
})
router.get('/expert/payouts',...expert,async(req,res)=>{const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(1,Number(req.query.limit)||25));res.json({items:await Payout.find({expert:req.user.id}).sort({createdAt:-1}).skip((page-1)*limit).limit(limit),page,limit,total:await Payout.countDocuments({expert:req.user.id})})})
router.get('/admin/experts/:id/verification',...admin,async(req,res)=>{
 const e=await Expert.findById(id(req.params.id)).populate('user','name email status');assert(e,'Expert not found.',404);res.json({profile:e})
})
router.post('/bookings/:id/refund-request',...mother,async(req,res)=>{
 const b=await Booking.findOne({_id:id(req.params.id),mother:req.user.id});assert(b,'Booking not found.',404)
 assert(['credit','paid'].includes(b.payment?.kind)&&b.payment?.captured&&!b.payment.refunded,'No refundable payment or used credit exists for this session.',409)
 assert(clean(req.body.reason).length>=3,'Provide a refund reason.')
 let request;try{request=await RefundRequest.create({booking:b.id,mother:req.user.id,reason:clean(req.body.reason).slice(0,1000)})}catch(e){if(e.code!==11000)throw e;assert(false,'A refund request already exists for this booking.',409)}
 for(const u of await User.find({role:{$in:['admin','superadmin']},status:'active'}))await alert(u.id,'refund.requested','Refund request received','Review the refund policy and reason.',{refundRequestId:request.id})
 res.status(201).json({request})
})
router.get('/me/refund-requests',...mother,async(req,res)=>res.json({items:await RefundRequest.find({mother:req.user.id}).sort({createdAt:-1})}))
router.get('/admin/care/refund-requests',...admin,async(req,res)=>{
 const items=await RefundRequest.find({}).populate('mother','name').populate('booking','startAt status payment expertName').sort({createdAt:-1}).limit(100)
 res.json({items:items.map(r=>({...r.toObject(),policy:r.booking?cancellationPolicy(r.booking,'mother'):null}))})
})
router.post('/admin/refund-requests/:id/decision',...admin,async(req,res)=>{
 assert(['approved','denied'].includes(req.body.status)&&clean(req.body.reason).length>=3,'Decision and reason are required.')
 const r=await RefundRequest.findById(id(req.params.id));assert(r?.status==='pending','Pending request not found.',409)
 const b=await Booking.findById(r.booking);assert(b,'Booking not found.',404)
 const fraction=Number(req.body.fraction||1);assert([.5,1].includes(fraction),'Choose full or 50% refund.')
 assert(req.body.status!=='approved'||req.user.role==='superadmin'||b.payment.kind==='credit'||b.payment.amount*fraction<=5000,'Refunds above INR 5,000 require superadmin.',403)
 // Persist the decision and pending refund atomically. The existing worker retries provider failures.
 await transaction(async session=>{
  const claim=await RefundRequest.updateOne({_id:r.id,status:'pending'},{$set:{status:req.body.status,decisionReason:clean(req.body.reason),decidedBy:req.user.id,decidedAt:new Date()}},{session});assert(claim.modifiedCount,'Request already decided.',409)
  if(req.body.status==='approved'){assert(!b.payment.refunded,'Payment already refunded.',409);await Booking.updateOne({_id:b.id},{$set:{'payment.refundFraction':fraction,'payment.refundReason':clean(req.body.reason),'payment.refundState':'pending'}},{session})}
 })
 await audit(req,'refund.'+req.body.status,r.id,{status:'pending'},{status:req.body.status,fraction},req.body.reason)
 if(req.body.status==='approved')await refundBooking(b,fraction)
 await alert(r.mother,'refund.decided','Refund request updated',clean(req.body.reason));res.json({ok:true})
})
router.get('/admin/care/overview',...admin,async(req,res)=>{
 const rows=await Booking.find({mother:{$exists:true}}).populate('service','title').select('status mode payment service').lean()
 const paid=rows.filter(b=>b.payment?.captured&&b.payment.kind==='paid'),requests=rows.filter(b=>b.mode==='request')
 const terminal=rows.filter(b=>['completed','no_show_mother','no_show_expert'].includes(b.status))
 const byService={};for(const b of rows){const k=b.service?.title||'Consultation';byService[k]=(byService[k]||0)+1}
 const gmv=paid.reduce((s,b)=>s+b.payment.amount,0),refundsInr=paid.reduce((s,b)=>s+(b.payment.refundedInr||0),0)
 const payoutRows=await Payout.find().select('gross fee');const netRevenue=payoutRows.reduce((s,p)=>s+p.fee,0)
 res.json({mothers:await User.countDocuments({role:{$in:['user','mother']},status:'active'}),experts:await Expert.countDocuments({'verification.status':'approved',accepting:true}),sessions:rows.length,gmv,refundsInr,netRevenue,byService,confirmRate:requests.length?Math.round(requests.filter(b=>['confirmed','in_progress','completed'].includes(b.status)).length/requests.length*100):0,noShowRate:terminal.length?Math.round(terminal.filter(b=>b.status.startsWith('no_show')).length/terminal.length*100):0,pendingExperts:await Expert.countDocuments({'verification.status':{$in:['pending','more_info']}}),pendingRequests:requests.filter(b=>['requested','proposed'].includes(b.status)).length,refunds:await RefundRequest.countDocuments({status:'pending'}),reportedReviews:await (await import('./models.js')).Review.countDocuments({reportReason:{$exists:true,$ne:''}})})
})
router.put('/admin/care/settings',...admin,requireRole('superadmin'),async(req,res)=>{
 const {key,value}=req.body
 assert(['payoutTdsPct','supportEmail','defaultCommissionPct','bookingDefaults','redFlags','plans'].includes(key),'Unsupported setting.')
 if(key==='payoutTdsPct')assert(Number.isFinite(Number(value))&&value>=0&&value<=30,'TDS must be 0–30%.')
 if(key==='defaultCommissionPct')assert(Number.isFinite(Number(value))&&value>=0&&value<=50,'Commission must be 0–50%.')
 if(key==='supportEmail')assert(typeof value==='string'&&/^\S+@\S+\.\S+$/.test(value),'Enter a valid email.')
 if(key==='redFlags')assert(Array.isArray(value)&&value.length>0&&value.length<=30&&value.every(v=>typeof v==='string'&&v.trim().length>1&&v.length<=80),'Enter 1–30 symptom names.')
 if(key==='bookingDefaults'){assert(value&&typeof value==='object','Provide booking rules.');for(const [k,min,max] of [['bufferMin',0,120],['minNoticeH',0,168],['windowDays',1,90],['maxPerDay',1,24]])assert(Number.isInteger(value[k])&&value[k]>=min&&value[k]<=max,'Invalid '+k)}
 if(key==='plans'){assert(value&&Object.keys(value).length===3,'Provide all three plans.');for(const k of ['sanctuary','village','premium'])assert(value[k]&&typeof value[k].name==='string'&&value[k].name.length<=80&&Number.isInteger(value[k].price)&&value[k].price>=0&&Number.isInteger(value[k].credits)&&value[k].credits>=0,'Invalid plan '+k);assert(value.sanctuary.price===0&&value.sanctuary.credits===0,'Sanctuary must remain free.');assert(process.env.NODE_ENV==='development'&&process.env.CARE_MOCK_PAYMENTS==='true','Live membership prices must be changed in Razorpay first and reconciled with configured plan IDs.',409)}
 const old=await Settings.findOne({key});await Settings.updateOne({key},{$set:{value}},{upsert:true});await loadCarePolicy(true);await audit(req,'settings.update',key,old?.value,value,clean(req.body.reason)||'Superadmin policy update');res.json({ok:true})
})
router.put('/expert/bank',...expert,async(req,res)=>{
 const b=req.body;assert(clean(b.accountName).length>=2&&/^\d{4}$/.test(b.accountLast4||'')&&/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.ifsc||''),'Enter account holder, last four digits and valid IFSC. Full bank details are collected by the payout provider.')
 await Expert.updateOne({user:req.user.id},{$set:{'bank.accountName':clean(b.accountName),'bank.accountLast4':b.accountLast4,'bank.ifsc':b.ifsc}});res.json({ok:true})
})
router.post('/groups/:id/leave',...mother,async(req,res)=>{
 const group=await Group.findOne({_id:id(req.params.id),'registrations.mother':req.user.id,startAt:{$gt:new Date()}});assert(group,'Upcoming registration not found.',404)
 const {GroupRegistration}=await import('./models.js');const r=await GroupRegistration.findOne({group:group.id,mother:req.user.id,status:'confirmed'});assert(!r?.amount,'Contact support for a paid group cancellation and refund.',409)
 await transaction(async session=>{await Group.updateOne({_id:group.id},{$pull:{registrations:{mother:req.user.id}}},{session});if(r)await GroupRegistration.updateOne({_id:r.id},{$set:{status:'expired'}},{session})});res.json({ok:true})
})
router.get('/expert/attention',...expert,async(req,res)=>{
 const items=[]
 for(const b of await Booking.find({expert:req.user.id,status:'completed',endAt:{$lte:new Date(Date.now()-DAY)}}).select('_id endAt'))if(!await Note.exists({booking:b.id,status:'published'}))items.push({title:'Session note overdue',detail:'Publish the note for '+istDate(b.endAt)+' to release payout.',bookingId:b.id})
 const clientIds=await Booking.find({expert:req.user.id,status:{$in:['confirmed','in_progress','completed']}}).distinct('mother')
 // Flag status only. Journal text is available exclusively through consent-checked client details.
 const consenting=await Mother.find({user:{$in:clientIds},'consents.shareMedical':true}).distinct('user')
 const flagged=await Journal.find({mother:{$in:consenting},shared:true,redFlag:true,acknowledgedAt:null}).select('mother date')
 for(const j of flagged){items.push({title:'Client follow-up',detail:'A shared check-in needs follow-up.',motherId:j.mother});await AccessLog.create({actor:req.user.id,mother:j.mother,resource:'journal'})}
 const a=await Availability.findOne({expert:req.user.id});if(!a?.weekly?.length)items.push({title:'No weekly availability',detail:'Add open hours in Calendar.'})
 res.json({items})
})
router.get('/experts',async(req,res)=>{
 const filter={'verification.status':'approved',accepting:true}
 const activeUsers=await User.find({role:'expert',status:'active'}).distinct('_id');filter.user={$in:activeUsers}
 if(req.query.service){const eligible=await Service.find({type:req.query.service,active:true}).distinct('expert');filter.user={$in:eligible.filter(x=>activeUsers.some(u=>String(u)===String(x)))}}
 const page=Math.max(1,Number(req.query.page)||1),limit=Math.max(1,Math.min(100,Number(req.query.limit)||25)),items=[]
 if(req.query.date)assert(/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)&&Number.isFinite(Date.parse(req.query.date)),'Invalid date.')
 for(const e of await Expert.find(filter).populate('user','name status').lean()){
  if(!e.user||credentialBlock(e))continue;const services=await Service.find({expert:e.user._id,active:true}).lean();const availability=await Availability.findOne({expert:e.user._id}).lean();const readiness=bookingReadiness(e,e.user,services,availability);if(!readiness.listed)continue
  let nextAvailable=null
  const from=req.query.date||istDate(),to=req.query.date||istDate(new Date(Date.now()+7*DAY))
  for(const service of services.filter(s=>readiness.modes.instant&&(!req.query.service||s.type===req.query.service))){
   try{const slots=await slotsFor(e.user._id,service._id,from,to,{limit:1});service.nextAvailable=slots[0]?.startAt||null;if(service.nextAvailable&&(!nextAvailable||+service.nextAvailable<+nextAvailable))nextAvailable=service.nextAvailable}catch(err){if(![400,404,409].includes(err.status))throw err}
  }
  if(req.query.date&&!nextAvailable)continue
  items.push({_id:e._id,user:{_id:e.user._id,name:e.user.name},headline:e.headline,bio:e.bio,city:e.city,languages:e.languages,yearsExp:e.yearsExp,photoUrl:e.photoUrl,rating:e.rating,reviewCount:e.reviewCount,isCoach:e.isCoach,accepting:true,services,nextAvailable,bookingModes:readiness.modes,verification:{status:'approved'}})
 }
 res.json({experts:items.slice((page-1)*limit,page*limit),items:items.slice((page-1)*limit,page*limit),page,limit,total:items.length})
})
router.get('/community/posts',...mother,async(req,res)=>{
 const page=Math.max(1,Number(req.query.page)||1),limit=25
 res.json({items:await CommunityPost.find({status:'visible'}).select('-reports').populate('author','name').sort({createdAt:-1}).skip((page-1)*limit).limit(limit),page,limit,total:await CommunityPost.countDocuments({status:'visible'})})
})
router.post('/community/posts',...mother,async(req,res)=>{assert(clean(req.body.body).length>=3&&clean(req.body.body).length<=3000,'Post must contain 3–3000 characters.');res.status(201).json({post:await CommunityPost.create({author:req.user.id,body:clean(req.body.body)})})})
router.post('/community/posts/:id/report',...mother,async(req,res)=>{assert(clean(req.body.reason).length>=3,'Provide a reason.');const p=await CommunityPost.findOne({_id:id(req.params.id),status:'visible'});assert(p,'Post not found.',404);assert(!p.reports.some(r=>String(r.user)===req.user.id),'Already reported.',409);p.reports.push({user:req.user.id,reason:clean(req.body.reason).slice(0,500)});await p.save();res.json({ok:true})})
router.get('/admin/care/community-reports',...admin,async(req,res)=>res.json({items:await CommunityPost.find({'reports.0':{$exists:true},status:'visible'}).populate('author','name').sort({createdAt:-1}).limit(100)}))
router.patch('/admin/community/posts/:id',...admin,async(req,res)=>{
 assert(['visible','removed'].includes(req.body.status)&&clean(req.body.reason).length>=3,'Decision and reason are required.')
 const p=await CommunityPost.findById(id(req.params.id));assert(p,'Post not found.',404);const before=p.status;p.status=req.body.status;p.moderationReason=clean(req.body.reason);p.reports=[];await p.save()
 await audit(req,'community.moderated',p.id,before,p.status,req.body.reason);await alert(p.author,'community.moderated','Community moderation update',clean(req.body.reason));res.json({ok:true})
})
router.get('/me/welcome-call',...mother,async(req,res)=>{
 const m=await motherFor(req.user);let service=null
 if(m.coach&&!m.welcomeUsedAt)service=await Service.findOne({expert:m.coach,type:'guidance',active:true})
 res.json({used:!!m.welcomeUsedAt,coachId:m.coach,service,available:!!service})
})
router.post('/me/welcome-call',...mother,async(req,res)=>{
 const m=await motherFor(req.user);assert(m.coach&&!m.welcomeUsedAt,'A welcome call is unavailable or already used.',409)
 const service=await Service.findOne({expert:m.coach,type:'guidance',active:true});assert(service,'Your coach must publish a guidance service first.',409)
 const booking=await createBooking(req.user,{serviceId:service.id,mode:'instant',paymentKind:'welcome',startAt:req.body.startAt},{welcome:true})
 res.status(201).json({booking})
})
export default router
