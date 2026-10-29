import {applicationChecklist} from './onboarding.js'
import {scheduledOn,scheduleLabel} from './schedules.js'
import {bookingReadiness} from './bookability.js'
import {credentialBlock} from './credentials.js'
import {loadCarePolicy} from './configuration.js'
import { Router } from 'express'
import { emitUser } from './realtime.js'
import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'
import User from '../models/User.js'
import Booking from '../models/Booking.js'
import Inquiry from '../models/Inquiry.js'
import Subscriber from '../models/Subscriber.js'
import CommunityMember from '../models/CommunityMember.js'
import AuditLog from '../models/AuditLog.js'
import { requireAuth,requireRole } from '../middleware/auth.js'
import { assert,clean,passwordOk,validEmail,safeUser } from '../utils/validation.js'
import { Mother,Expert,Service,Availability,Note,Task,TaskCheck,Journal,Thread,Message,Group,Review,Subscription,Payout,Notification,AccessLog,Settings,CareTemplate,Document,GroupRegistration } from './models.js'
import { encrypt,decrypt } from './security.js'
import { isMother,isAdmin,plans,services,redFlags,DAY,HOUR,MIN,istDate,pregnancy,payoutFor,validDate } from './policy.js'
import { motherFor,createBooking,slotsFor,availabilityFor,confirmRequest,cancelBooking,refundBooking,transaction,alert,both,checkSlot,onConfirmed } from './booking.js'
import { createSubscription,mockPayment } from './payments.js'
import { paymentMock,razor } from './integrations.js'
import { joinToken } from './video.js'
import { sharedHealth,notesFor,healthAccess } from './health.js'
const router=Router()
const auth=[requireAuth],mother=[requireAuth,requireRole('mother')],expert=[requireAuth,requireRole('expert')],admin=[requireAuth,requireRole('admin','superadmin')]
const id=(value)=>{assert(mongoose.isValidObjectId(value),'Invalid identifier.');return value}
const page=req=>({page:Math.max(1,Number(req.query.page)||1),limit:Math.max(1,Math.min(100,Number(req.query.limit)||25))})
async function list(res,model,filter,req,populate,select){const p=page(req),q=model.find(filter).sort({createdAt:-1}).skip((p.page-1)*p.limit).limit(p.limit);if(populate)q.populate(populate);if(select)q.select(select);res.json({items:await q,...p,total:await model.countDocuments(filter)})}
async function audit(req,action,target,before,after,reason){await AuditLog.create({actor:req.user.id,actorEmail:req.user.email,action,resource:'care',resourceId:String(target),details:{before,after,reason}})}
async function ownBooking(req){const b=await Booking.findById(id(req.params.id));assert(b,'Booking not found.',404);assert(String(b.mother||b.user)===req.user.id||String(b.expert)===req.user.id||isAdmin(req.user),'Booking not found.',404);return b}
async function expertClient(req,motherId){assert(await Booking.exists({expert:req.user.id,mother:id(motherId),status:{$in:['confirmed','in_progress','completed']}}),'No eligible booking with this client.',403)}
router.get('/care/config',async(_req,res)=>{await loadCarePolicy();return res.json({plans,services,redFlags,mockPayments:paymentMock(),videoConfigured:!!process.env.DAILY_API_KEY,keyId:process.env.RAZORPAY_KEY_ID,timezone:'Asia/Kolkata'})})
router.get('/experts/:id/slots',async(req,res)=>res.json({items:await slotsFor(id(req.params.id),id(req.query.serviceId),req.query.from,req.query.to)}))
router.post('/expert/apply',async(req,res)=>{
 const b=req.body;assert(clean(b.name).length>=2&&validEmail(b.email)&&passwordOk(b.password),'Enter a valid name, email and password (8–72 bytes).')
 assert(b.acceptTerms===true,'Accept the expert terms and privacy policy.')
 assert(clean(b.headline)&&clean(b.city)&&Array.isArray(b.languages)&&b.languages.some(x=>clean(x)),'Professional role, city and languages are required.')
 assert(clean(b.registration).length>=3&&Number.isInteger(Number(b.yearsExp))&&Number(b.yearsExp)>=0,'Registration and experience are required.')
 assert(!await User.exists({email:clean(b.email).toLowerCase()}),'This email already has an account.',409)
 const user=await User.create({name:clean(b.name),email:clean(b.email).toLowerCase(),passwordHash:await User.hashPassword(b.password),role:'expert',status:'pending',emailVerified:false})
 await Expert.create({user:user.id,verification:{documentPolicyVersion:2,status:'draft'},headline:clean(b.headline),bio:clean(b.bio),city:clean(b.city),languages:Array.isArray(b.languages)?b.languages.map(clean):['English'],registration:clean(b.registration),yearsExp:Number(b.yearsExp),commissionPct:Number((await Settings.findOne({key:'defaultCommissionPct'}))?.value??20)})
 await availabilityFor(user.id)
 res.status(201).json({message:'Details saved. Upload all four required documents, then submit your application for review.'})
})
router.get('/me/dashboard',...mother,async(req,res)=>{
 const m=await motherFor(req.user),bookings=await Booking.find({mother:req.user.id,status:{$in:['confirmed','requested','proposed','held','in_progress']}}).populate('service').sort({startAt:1}).limit(30)
 const tasks=await Task.find({mother:req.user.id,$or:[{endAt:{$exists:false}},{endAt:null},{endAt:{$gte:new Date()}}]}).populate('expert','name')
 const checks=await TaskCheck.find({mother:req.user.id,date:istDate()})
 const latestNote=await Note.findOne({mother:req.user.id,status:'published'}).sort({publishedAt:-1})
 res.json({profile:m,pregnancy:pregnancy(m),bookings,tasks:tasks.filter(t=>scheduledOn(t,istDate())).map(t=>({...t.toObject(),scheduleLabel:scheduleLabel(t)})),checks,latestNote:latestNote?{...latestNote.toObject(),versions:undefined}:null,coach:m.coach?await User.findById(m.coach).select('name'):null})
})
router.get('/me/care-profile',...mother,async(req,res)=>{
 const m=await motherFor(req.user),full=await Mother.findById(m.id).select('+medicalCipher');await AccessLog.create({actor:req.user.id,mother:req.user.id,resource:'medical'});res.json({...m.toObject(),medical:decrypt(full.medicalCipher,{})})
})
router.put('/me/care-profile',...mother,async(req,res)=>{
 const m=await motherFor(req.user),b=req.body;assert(['ttc','pregnant','postpartum'].includes(b.stage),'Choose your journey stage.')
 if(b.stage==='pregnant')assert(validDate(b.dueDate)||validDate(b.lmpDate),'Enter a due date or last period date.')
 if(b.stage==='postpartum')assert(validDate(b.babyDob)&&b.babyDob<=istDate(),'Enter your baby’s date of birth.')
 assert(b.consents?.terms===true&&b.consents?.privacy===true,'Accept Terms and Privacy to continue.')
 const next={terms:true,privacy:true,shareMedical:b.consents.shareMedical===true,whatsapp:b.consents.whatsapp===true}
 const prior=m.consents?.toObject?.()||m.consents
 if(JSON.stringify(prior)!==JSON.stringify(next))m.consentHistory.push({at:new Date(),before:prior,after:next,version:'2026-10-18'})
 m.consents=next;m.stage=b.stage;m.dueDate=validDate(b.dueDate)?b.dueDate:undefined;m.lmpDate=validDate(b.lmpDate)?b.lmpDate:undefined;m.babyDob=validDate(b.babyDob)?b.babyDob:undefined;m.firstPregnancy=b.firstPregnancy===true
 m.language=clean(b.language).slice(0,80)||'English';m.interests=Array.isArray(b.interests)?b.interests.slice(0,7).map(x=>clean(x).slice(0,80)):[]
 if(b.medical){const medical={};for(const k of ['obName','hospital','bloodGroup','conditions','allergies','emergencyContact'])medical[k]=String(b.medical[k]||'').slice(0,1000);m.medicalCipher=encrypt(medical)}
 if(!m.coach){const coach=await Expert.findOne({isCoach:true,'verification.status':'approved'});m.coach=coach?.user}
 await m.save();req.user.profile={...req.user.profile.toObject(),stage:b.stage==='pregnant'?'Pregnant':b.stage==='postpartum'?'Postpartum':'Planning pregnancy',dueDate:b.dueDate||'',services:m.interests,language:m.language,completed:true};await req.user.save()
 if(m.coach)await Thread.updateOne({mother:req.user.id,expert:m.coach},{$max:{closesAt:new Date(Date.now()+365*DAY)}},{upsert:true})
 res.json({profile:m,user:safeUser(req.user)})
})
router.get('/me/export',...mother,async(req,res)=>{
 const m=await motherFor(req.user),full=await Mother.findById(m.id).select('+medicalCipher');res.json({user:safeUser(req.user),profile:{...m.toObject(),medical:decrypt(full.medicalCipher,{})},bookings:await Booking.find({mother:req.user.id}),journal:(await Journal.find({mother:req.user.id}).select('+noteCipher')).map(j=>({...j.toObject(),note:decrypt(j.noteCipher,''),noteCipher:undefined})),notes:await notesFor(req.user,req.user.id)})
})
router.post('/me/delete-account',...mother,async(req,res)=>{const m=await motherFor(req.user);assert(req.body.confirm==='DELETE','Type DELETE to schedule deletion.');m.deletionAt=new Date(Date.now()+30*DAY);await m.save();await alert(req.user.id,'account.deletion','Deletion requested','Your account will be erased after 30 days. You can cancel this request in Profile.');res.json({deletionAt:m.deletionAt})})
router.post('/me/cancel-deletion',...mother,async(req,res)=>{await Mother.updateOne({user:req.user.id},{$unset:{deletionAt:1}});res.json({ok:true})})
router.get('/me/notifications',...auth,async(req,res)=>list(res,Notification,{user:req.user.id},req))
router.patch('/me/notifications/:id',...auth,async(req,res)=>{await Notification.updateOne({_id:id(req.params.id),user:req.user.id},{$set:{readAt:new Date()}});res.json({ok:true})})
router.get('/care/bookings',...auth,async(req,res)=>{
 const filter=isMother(req.user)?{$or:[{mother:req.user.id},{user:req.user.id}]}:req.user.role==='expert'?{expert:req.user.id}:{}
 if(req.query.status)filter.status=req.query.status
 await list(res,Booking,filter,req,[{path:'service'},{path:'mother',select:'name'},{path:'expert',select:'name'}],'-request.noteCipher')
})
router.post('/bookings',...mother,async(req,res)=>{const booking=await createBooking(req.user,req.body);res.status(201).json({booking,keyId:process.env.RAZORPAY_KEY_ID,mock:paymentMock()})})
router.post('/bookings/:id/mock-payment',...mother,async(req,res)=>{const b=await ownBooking(req);res.json({booking:await mockPayment(b)})})
router.post('/bookings/:id/cancel',...auth,async(req,res)=>{const b=await ownBooking(req);if(!b.mode){assert(isMother(req.user)&&['requested','confirmed'].includes(b.status),'Booking cannot be cancelled.');b.status='cancelled';await b.save();return res.json({booking:b})}assert(isMother(req.user)||req.user.role==='expert','Use the admin refund action.',403);res.json({booking:await cancelBooking(b,req.user.role==='expert'?'expert':'mother',req.body.reason)})})
router.patch('/me/bookings/:id/cancel',...mother,async(req,res)=>{const b=await ownBooking(req);if(b.mode)return res.json({booking:await cancelBooking(b,'mother',req.body.reason||'Cancelled by mother')});assert(b.status==='requested'||b.status==='confirmed','Booking cannot be cancelled.');b.status='cancelled';await b.save();res.json({booking:b})})
router.post('/bookings/:id/reschedule',...mother,async(req,res)=>{
 const b=await ownBooking(req);assert(b.status==='confirmed'&&!b.rescheduled&&+b.startAt-Date.now()>=12*HOUR,'One free reschedule is allowed at least 12 hours before start.')
 const updated=await transaction(async session=>{await Expert.updateOne({user:b.expert},{$inc:{lockVersion:1}},{session});const current=await Booking.findById(b.id).session(session);assert(current.status==='confirmed'&&!current.rescheduled,'Booking changed.',409);const s=await Service.findById(b.service).session(session);const slot=await checkSlot(s,req.body.startAt,session,{ignoreId:b.id,reschedule:true});Object.assign(current,{startAt:slot.startAt,endAt:slot.endAt,dateKey:slot.dateKey,timeSlot:slot.timeSlot,rescheduled:true});await current.save({session});return current})
 await onConfirmed(updated);await both(updated,'booking.rescheduled','Session rescheduled');res.json({booking:updated})
})
router.post('/bookings/:id/accept',...expert,async(req,res)=>{const b=await ownBooking(req);res.json({booking:await confirmRequest(b,req.body.startAt)})})
router.post('/bookings/:id/propose',...expert,async(req,res)=>{
 const b=await ownBooking(req);assert(b.status==='requested'&&+b.request.expiresAt>Date.now(),'Request is no longer open.',409)
 assert(Array.isArray(req.body.slots)&&req.body.slots.length>=1&&req.body.slots.length<=3&&new Set(req.body.slots.map(s=>+new Date(s))).size===req.body.slots.length,'Propose one to three available slots.')
 const service=await Service.findById(b.service);for(const s of req.body.slots)await checkSlot(service,s)
 b.proposals=req.body.slots;b.status='proposed';await b.save();await alert(b.mother,'booking.proposed','New session times proposed','Select a proposed time from Sessions.',{bookingId:b.id});res.json({booking:b})
})
router.post('/bookings/:id/choose',...mother,async(req,res)=>{const b=await ownBooking(req);assert(b.status==='proposed'&&b.proposals.some(x=>+x===+new Date(req.body.startAt)),'Choose one of the proposed slots.');res.json({booking:await confirmRequest(b,req.body.startAt)})})
router.post('/bookings/:id/decline',...expert,async(req,res)=>{const b=await ownBooking(req);assert(['requested','proposed'].includes(b.status),'Request is no longer open.',409);assert(clean(req.body.reason).length>=3,'A decline reason is required.');b.status='declined';b.cancel={by:'expert',at:new Date(),reason:clean(req.body.reason)};b.payment.refundFraction=1;await b.save();await refundBooking(b,1);await both(b,'booking.declined','Session request declined');res.json({booking:b})})
router.get('/bookings/:id/join-token',...auth,async(req,res)=>res.json(await joinToken(await ownBooking(req),req.user,{audioOnly:req.query.audioOnly==='true'})))
router.get('/expert/profile/booking-readiness',...expert,async(req,res)=>{
 const profile=await Expert.findOne({user:req.user.id});assert(profile,'Expert profile not found.',404)
 const services=await Service.find({expert:req.user.id})
 const availability=await Availability.findOne({expert:req.user.id})
 res.set('Cache-Control','no-store').json(bookingReadiness(profile,req.user,services,availability))
})
router.get('/expert/profile',...expert,async(req,res)=>res.set('Cache-Control','no-store').json({profile:await Expert.findOne({user:req.user.id}),services:await Service.find({expert:req.user.id})}))
router.put('/expert/profile',...expert,async(req,res)=>{
 const e=await Expert.findOne({user:req.user.id});assert(e,'Profile not found.',404)
 for(const k of ['headline','bio','city','photoUrl'])if(req.body[k]!==undefined)e[k]=clean(req.body[k]).slice(0,k==='bio'?2000:500)
 if(req.body.languages)e.languages=req.body.languages.slice(0,10).map(clean)
 if(req.body.accepting!==undefined){assert(e.verification.status==='approved'&&!credentialBlock(e),'Approval and valid credentials are required.');e.accepting=req.body.accepting===true}
 if(req.body.documents)assert(false,'Use the per-document credential submission endpoint.')
 await e.save();res.json({profile:e})
})
router.post('/expert/services',...expert,async(req,res)=>{
 const e=await Expert.findOne({user:req.user.id});assert(e.verification.status==='approved','Expert approval required.',403)
 const b=req.body;assert(services.includes(b.type)&&clean(b.title)&&Number.isInteger(Number(b.durationMin))&&b.durationMin>=15&&b.durationMin<=120&&b.priceInr>=500&&b.priceInr<=3000,'Service must have a title, duration 15–120 min and price ₹500–₹3,000.')
 const fields={type:b.type,title:clean(b.title),durationMin:Number(b.durationMin),priceInr:Number(b.priceInr),active:b.active!==false}
 const s=b.id?await Service.findOneAndUpdate({_id:id(b.id),expert:req.user.id},{$set:fields},{new:true,runValidators:true}):await Service.create({expert:req.user.id,...fields});assert(s,'Service not found.',404);res.json({service:s})
})
router.get('/expert/availability',...expert,async(req,res)=>res.json(await availabilityFor(req.user.id)))
router.put('/expert/availability',...expert,async(req,res)=>{
 const b=req.body;assert(Array.isArray(b.weekly)&&b.weekly.length<=21&&Array.isArray(b.overrides||[]),'Provide weekly availability and overrides.')
 const time=x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(x)
 for(const block of [...b.weekly,...(b.overrides||[])]){assert(block.closed||time(block.start)&&time(block.end)&&block.start<block.end,'Invalid availability hours.');assert(block.date?validDate(block.date):Number.isInteger(block.dow)&&block.dow>=0&&block.dow<=6,'Invalid day.')}
 for(const [key,min,max] of [['bufferMin',0,120],['minNoticeH',0,168],['windowDays',1,90],['maxPerDay',1,24]])assert(Number.isInteger(Number(b[key]))&&b[key]>=min&&b[key]<=max,`Invalid ${key}.`)
 const value={weekly:b.weekly,overrides:b.overrides||[],bufferMin:Number(b.bufferMin),minNoticeH:Number(b.minNoticeH),windowDays:Number(b.windowDays),maxPerDay:Number(b.maxPerDay),allowInstant:b.allowInstant===true,allowRequests:b.allowRequests===true}
 res.json(await Availability.findOneAndUpdate({expert:req.user.id},{$set:value},{upsert:true,new:true,runValidators:true}))
})
router.get('/expert/clients',...expert,async(req,res)=>{
 const ids=await Booking.find({expert:req.user.id,status:{$in:['confirmed','in_progress','completed']}}).distinct('mother');res.json({items:await User.find({_id:{$in:ids}}).select('name email')})
})
router.get('/expert/clients/:id',...expert,async(req,res)=>{await expertClient(req,req.params.id);let health=null;try{health=await sharedHealth(req.user,req.params.id)}catch(e){if(e.status!==403&&e.status!==404)throw e}res.json({user:await User.findById(req.params.id).select('name email'),health,tasks:await Task.find({mother:req.params.id}).populate('expert','name'),bookings:await Booking.find({expert:req.user.id,mother:req.params.id}).select('-request.noteCipher').sort({startAt:-1})})})
router.get('/clients/:id/notes',...auth,async(req,res)=>{assert(isMother(req.user)||req.user.role==='expert','Notes are private.',403);if(isMother(req.user))assert(req.user.id===req.params.id,'Notes are private.',403);res.json({items:await notesFor(req.user,id(req.params.id))})})
router.post('/bookings/:id/note',...expert,async(req,res)=>{
 const b=await ownBooking(req);assert(b.status==='completed','Notes can be published after the session is completed.')
 await expertClient(req,String(b.mother))
 const existing=await Note.findOne({booking:b.id}).select('+privateCipher')
 if(existing?.publishedAt)assert(Date.now()-+existing.publishedAt<DAY,'Published notes can be edited only within 24 hours.',403)
 const input=req.body;assert(clean(input.summary).length>=3&&['draft','published'].includes(input.status),'Enter a summary and valid note status.')
 const data={expert:req.user.id,mother:b.mother,summary:clean(input.summary).slice(0,10000),recommendations:(input.recommendations||[]).slice(0,50).map(x=>clean(x).slice(0,1000)),privateCipher:encrypt(clean(input.privateNotes).slice(0,10000)),medicalFlag:input.medicalFlag===true,status:input.status}
 if(existing){existing.versions.push({at:new Date(),summary:existing.summary,recommendations:existing.recommendations,privateCipher:existing.privateCipher});Object.assign(existing,data);if(input.status==='published'&&!existing.publishedAt)existing.publishedAt=new Date();await existing.save()}
 else await Note.create({booking:b.id,...data,publishedAt:input.status==='published'?new Date():undefined})
 if(input.status==='published')await alert(b.mother,'note.published','Your session note is ready','Open Sessions to read the summary and recommendations.')
 res.json({ok:true})
})
router.get('/me/care-plan',...mother,async(req,res)=>res.json({items:await Task.find({mother:req.user.id}).populate('expert','name'),checks:await TaskCheck.find({mother:req.user.id,date:{$gte:istDate(new Date(Date.now()-7*DAY))}})}))
router.post('/clients/:id/tasks',...expert,async(req,res)=>{await expertClient(req,req.params.id);assert(clean(req.body.title)&&['Nutrition','Movement','Mind'].includes(req.body.category)&&['daily','weekly','as needed','3x week'].includes(req.body.frequency),'Enter a task title, category and frequency.');const task=await Task.create({mother:req.params.id,expert:req.user.id,title:clean(req.body.title).slice(0,300),category:req.body.category,frequency:req.body.frequency,startAt:req.body.startAt||new Date(),endAt:req.body.endAt||undefined});await alert(req.params.id,'plan.updated','Care plan updated','Your expert added a task.');res.json({task})})
router.delete('/tasks/:id',...expert,async(req,res)=>{const t=await Task.findOneAndDelete({_id:id(req.params.id),expert:req.user.id});assert(t,'You can remove only your own tasks.',403);res.json({ok:true})})
router.post('/tasks/:id/check',...mother,async(req,res)=>{const task=await Task.findOne({_id:id(req.params.id),mother:req.user.id});assert(task,'Task not found.',404);const date=istDate();if(req.body.completed===false)await TaskCheck.deleteOne({task:task.id,mother:req.user.id,date});else await TaskCheck.updateOne({task:task.id,date},{$setOnInsert:{mother:req.user.id}},{upsert:true});res.json({ok:true})})
router.get('/me/journal',...mother,async(req,res)=>{const {page:p,limit}=page(req);const entries=await Journal.find({mother:req.user.id}).select('+noteCipher').sort({date:-1}).skip((p-1)*limit).limit(limit);await AccessLog.create({actor:req.user.id,mother:req.user.id,resource:'journal'});res.json({items:entries.map(j=>({...j.toObject(),note:decrypt(j.noteCipher,''),noteCipher:undefined})),page:p,limit,total:await Journal.countDocuments({mother:req.user.id})})})
router.post('/me/journal',...mother,async(req,res)=>{
 await loadCarePolicy()
 assert(Number.isInteger(req.body.mood)&&req.body.mood>=1&&req.body.mood<=5,'Choose a mood from 1 to 5.');const symptoms=Array.isArray(req.body.symptoms)?req.body.symptoms.slice(0,25).map(x=>clean(x).slice(0,80)):[]
 const m=await motherFor(req.user),redFlag=symptoms.some(x=>redFlags.includes(x)),date=istDate()
 const entry=await Journal.findOneAndUpdate({mother:req.user.id,date},{$set:{mood:req.body.mood,symptoms,noteCipher:encrypt(clean(req.body.note).slice(0,5000)),shared:req.body.shared===undefined?m.consents.shareMedical:req.body.shared===true,redFlag}},{upsert:true,new:true,runValidators:true})
 if(redFlag){await alert(m.coach,'journal.redflag','Urgent symptom check-in','A client has acknowledged a symptom requiring clinical contact.',{motherId:req.user.id},`redflag:${entry.id}:coach`);const admins=await User.find({role:{$in:['admin','superadmin']}});for(const a of admins)await alert(a.id,'journal.redflag','Urgent care follow-up required','Contact the assigned coach; health details are restricted.',{motherId:req.user.id},`redflag:${entry.id}:${a.id}`)}
 res.json({entry:{...entry.toObject(),noteCipher:undefined},redFlag})
})
router.post('/me/journal/:id/acknowledge',...mother,async(req,res)=>{await Journal.updateOne({_id:id(req.params.id),mother:req.user.id},{$set:{acknowledgedAt:new Date()}});res.json({ok:true})})
router.get('/threads',...auth,async(req,res)=>{assert(isMother(req.user)||req.user.role==='expert','Chat is private.',403);res.json({items:await Thread.find(isMother(req.user)?{mother:req.user.id}:{expert:req.user.id}).populate('mother expert','name')})})
async function ownThread(req){const t=await Thread.findById(id(req.params.id));assert(t&&(String(t.mother)===req.user.id||String(t.expert)===req.user.id),'Thread not found.',404);return t}
router.get('/threads/:id/messages',...auth,async(req,res)=>{const t=await ownThread(req),p=page(req),messages=await Message.find({thread:t.id}).select('+bodyCipher').sort({createdAt:-1}).skip((p.page-1)*p.limit).limit(p.limit);await Message.updateMany({thread:t.id,sender:{$ne:req.user.id},readAt:null},{$set:{readAt:new Date()}});res.json({items:messages.reverse().map(m=>({...m.toObject(),body:decrypt(m.bodyCipher,''),bodyCipher:undefined})),...p,total:await Message.countDocuments({thread:t.id}),readOnly:+t.closesAt<Date.now()})})
router.post('/threads/:id/messages',...auth,async(req,res)=>{
 const t=await ownThread(req);assert(+t.closesAt>=Date.now(),'This thread is read-only 30 days after your last session.',403)
 const text=clean(req.body.body);assert(text.length>0&&text.length<=5000,'Message must be 1–5,000 characters.')
 const attachments=(req.body.attachments||[]).slice(0,5);for(const a of attachments)assert(await Document.exists({_id:id(a.documentId),owner:req.user.id}),'Attachment ownership mismatch.')
 const msg=await Message.create({thread:t.id,sender:req.user.id,bodyCipher:encrypt(text),attachments:attachments.map(a=>({documentId:a.documentId,name:clean(a.name)}))})
 const recipient=String(t.mother)===req.user.id?t.expert:t.mother
 emitUser(recipient,'message:new',{thread:t.id,id:msg.id})
 await (await import('./models.js')).Job.updateOne({key:'chat:'+msg.id},{$setOnInsert:{type:'chat',payload:{messageId:msg.id,recipient},dueAt:new Date(Date.now()+2*MIN)}},{upsert:true})
 if(/\b(self[- ]?harm|suicid\w*)\b/i.test(text)){const clinicians=await Expert.find({safetyOnCall:true,'verification.status':'approved'}).distinct('user');const staff=await User.find({$or:[{role:{$in:['admin','superadmin']}},{_id:{$in:clinicians}}]});for(const u of staff)await alert(u.id,'chat.safety','Urgent message safety review','A message was flagged for a safety review.',{messageId:msg.id});await Message.updateOne({_id:msg.id},{$set:{reported:true}})}
 res.status(201).json({id:msg.id})
})
router.post('/messages/:id/report',...auth,async(req,res)=>{const msg=await Message.findById(id(req.params.id));assert(msg,'Message not found.',404);const t=await Thread.findById(msg.thread);assert(t&&[String(t.mother),String(t.expert)].includes(req.user.id),'Access denied.',403);msg.reported=true;await msg.save();res.json({ok:true})})
router.get('/me/membership',...mother,async(req,res)=>res.json({profile:await motherFor(req.user),plans,subscription:await Subscription.findOne({mother:req.user.id}).sort({createdAt:-1})}))
router.post('/subscriptions',...mother,async(req,res)=>{await motherFor(req.user);res.json(await createSubscription(req.user,req.body.plan))})
router.post('/subscriptions/change',...mother,async(req,res)=>{
 const next=req.body.plan;assert(Object.hasOwn(plans,next),'Unknown plan.');const sub=await Subscription.findOne({mother:req.user.id,status:'active'});assert(sub,'No active subscription.',404);assert(next!==sub.plan,'This is already your plan.')
 const upgrade=plans[next].price>plans[sub.plan].price
 if(sub.providerId.startsWith('mock_')){
   if(upgrade){await Mother.updateOne({user:req.user.id},{$set:{plan:next},$inc:{credits:Math.max(0,plans[next].credits-plans[sub.plan].credits)}});sub.plan=next}else sub.pendingPlan=next
 }else if(next==='sanctuary'){await razor(`/subscriptions/${sub.providerId}/cancel`,{cancel_at_cycle_end:1});sub.pendingPlan=next}
 else{const planId=process.env[next==='village'?'RAZORPAY_VILLAGE_PLAN_ID':'RAZORPAY_PREMIUM_PLAN_ID'];assert(planId,'Configure subscription plan IDs.',503);await razor(`/subscriptions/${sub.providerId}`,{plan_id:planId,schedule_change_at:upgrade?'now':'cycle_end',customer_notify:1},'PATCH');sub.pendingPlan=next}
 await sub.save();res.json({subscription:sub,message:upgrade?'Upgrade submitted; credits are activated after verified payment.':'Downgrade scheduled for the next renewal.'})
})
router.get('/expert/earnings',...expert,async(req,res)=>{
 const e=await Expert.findOne({user:req.user.id}),bookings=await Booking.find({expert:req.user.id,status:'completed'}).sort({endAt:-1}),items=bookings.map(b=>({booking:b.id,date:b.endAt,...payoutFor(b,e.commissionPct),payableAfter:new Date(+b.endAt+48*HOUR),paid:!!b.payoutId}));const hosted=await Group.find({host:req.user.id,startAt:{$lt:new Date()}});for(const g of hosted){const end=new Date(+g.startAt+g.durationMin*MIN);if(+end>Date.now())continue;for(const reg of await GroupRegistration.find({group:g.id,status:'confirmed',amount:{$gt:0}})){const fee=Math.round(reg.amount*30)/100;items.push({booking:reg.id,date:end,gross:reg.amount,fee,net:Math.round((reg.amount-fee)*100)/100,payableAfter:new Date(+end+48*HOUR),paid:!!reg.payoutId,group:g.title})}}res.json({items,gross:items.reduce((s,x)=>s+x.gross,0),fee:items.reduce((s,x)=>s+x.fee,0),net:items.reduce((s,x)=>s+x.net,0),payouts:await Payout.find({expert:req.user.id}).sort({createdAt:-1})})
})
router.post('/bookings/:id/review',...mother,async(req,res)=>{
 const b=await ownBooking(req);assert(b.status==='completed'&&Date.now()-+b.endAt<=14*DAY,'Reviews are available for 14 days after a completed session.');assert(Number.isInteger(req.body.stars)&&req.body.stars>=1&&req.body.stars<=5,'Choose 1–5 stars.');await Review.create({booking:b.id,mother:req.user.id,expert:b.expert,stars:req.body.stars,text:clean(req.body.text).slice(0,2000)});const avg=await Review.aggregate([{$match:{expert:b.expert,status:'visible'}},{$group:{_id:null,rating:{$avg:'$stars'},count:{$sum:1}}}]);await Expert.updateOne({user:b.expert},{$set:{rating:avg[0]?.rating||0,reviewCount:avg[0]?.count||0}});res.json({ok:true})
})
router.get('/expert/reviews',...expert,async(req,res)=>list(res,Review,{expert:req.user.id},req,{path:'mother',select:'name'}))
router.post('/reviews/:id/reply',...expert,async(req,res)=>{assert(clean(req.body.text),'Enter a reply.');const r=await Review.findOneAndUpdate({_id:id(req.params.id),expert:req.user.id,reply:{$in:[null,'']}},{$set:{reply:clean(req.body.text).slice(0,2000)}},{new:true});assert(r,'Review already replied to or not found.',409);res.json({review:r})})
router.post('/reviews/:id/report',...auth,async(req,res)=>{assert(clean(req.body.reason),'Give a report reason.');await Review.updateOne({_id:id(req.params.id)},{$set:{reportReason:clean(req.body.reason).slice(0,500)}});res.json({ok:true})})
router.get('/groups',async(req,res)=>res.json({items:await Group.find({status:'live',startAt:{$gt:new Date()}}).select('-registrations').populate('host','name')}))
router.get('/expert/groups',...expert,async(req,res)=>list(res,Group,{host:req.user.id},req))
router.post('/expert/groups',...expert,async(req,res)=>{assert(clean(req.body.title)&&+new Date(req.body.startAt)>Date.now()&&Number.isInteger(req.body.capacity)&&req.body.capacity>=1&&req.body.capacity<=500&&req.body.durationMin>=15&&req.body.durationMin<=180&&Number(req.body.priceInr)>=0,'Enter valid group session details.');const g=await Group.create({host:req.user.id,title:clean(req.body.title),startAt:req.body.startAt,durationMin:req.body.durationMin,capacity:req.body.capacity,priceInr:req.body.priceInr,audience:clean(req.body.audience)});res.status(201).json({group:g})})
router.get('/me/library',...mother,async(req,res)=>{const m=await motherFor(req.user);res.json({bookmarks:m.bookmarks,groups:m.groups,sessions:await Group.find({'registrations.mother':req.user.id}).select('-registrations').populate('host','name')})})
router.put('/me/library',...mother,async(req,res)=>{const m=await motherFor(req.user);if(Array.isArray(req.body.bookmarks))m.bookmarks=req.body.bookmarks.slice(0,100).map(x=>clean(x).slice(0,500));if(Array.isArray(req.body.groups))m.groups=req.body.groups.slice(0,30).map(x=>clean(x).slice(0,80));await m.save();res.json({profile:m})})
router.get('/care/templates',...expert,async(req,res)=>res.json({items:await CareTemplate.find()}))
// Administrator routes expose operational metadata, never medical summaries or journals.
router.get('/admin/care/overview',...admin,async(req,res)=>{
 const all=await Booking.find({mother:{$exists:true}}).select('status payment service mode'),confirmed=all.filter(b=>['confirmed','in_progress','completed'].includes(b.status));res.json({mothers:await User.countDocuments({role:{$in:['user','mother']},status:'active'}),experts:await Expert.countDocuments({'verification.status':'approved'}),sessions:all.length,gmv:all.filter(b=>b.payment?.captured).reduce((s,b)=>s+b.payment.amount,0),pendingExperts:await Expert.countDocuments({'verification.status':'pending'}),pendingRequests:all.filter(b=>['requested','proposed'].includes(b.status)).length,refunds:all.filter(b=>b.payment?.refundState==='pending').length,reportedReviews:await Review.countDocuments({reportReason:{$exists:true,$ne:''}}),confirmRate:all.length?Math.round(confirmed.length/all.length*100):0})
})
router.get('/admin/care/experts',...admin,async(req,res)=>list(res,Expert,req.query.includeDrafts==='true'?{}:{'verification.status':{$ne:'draft'}},req,{path:'user',select:'name email status'}))
router.patch('/admin/experts/:id/verification',...admin,async(req,res)=>{
 const e=await Expert.findById(id(req.params.id));assert(e,'Expert not found.',404);const b=req.body,before=e.verification.toObject();assert(['approved','rejected','more_info','pending'].includes(b.status),'Invalid verification status.')
 assert(Array.isArray(b.checks)&&b.checks.length===5&&b.checks.every(v=>typeof v==='boolean'),'Five verification checks are required.')
 if(b.status==='approved'){assert(e.verification.status!=='draft','The expert must complete documents and submit the application first.');if(e.verification.documentPolicyVersion===2)assert(applicationChecklist(e).every(x=>x.ready&&x.status==='verified'),'Verify the latest required documents with valid expiry dates before approval.');assert(b.checks.every(Boolean),'Complete all five checks before approval.');assert(!credentialBlock({...e.toObject(),verification:{...e.verification.toObject(),expiresAt:undefined}}),'Verify all required documents with current expiry dates before approval.')}
 if(['rejected','more_info'].includes(b.status))assert(clean(b.reason).length>=3,'Provide a reason.')
 if(b.expiresAt)assert(validDate(b.expiresAt)&&+new Date(b.expiresAt)>Date.now(),'Enter a future credential expiry date.')
 e.verification={...e.verification.toObject(),status:b.status,autoPaused:false,checks:b.checks,reason:clean(b.reason),expiresAt:b.expiresAt||undefined};e.accepting=b.status==='approved';if(req.user.role==='superadmin'&&b.commissionPct!==undefined){assert([15,20].includes(Number(b.commissionPct)),'Commission must be 15 or 20%.');e.commissionPct=Number(b.commissionPct)}
 if(req.user.role==='superadmin')e.isCoach=b.isCoach===true
 await e.save();await User.updateOne({_id:e.user},{$set:{status:b.status==='approved'?'active':'pending',...(b.status==='approved'?{emailVerified:true,verificationMethod:'admin'}:{})}})
 await audit(req,'expert.verification',e.id,before,{status:b.status,checks:b.checks},b.reason);await alert(e.user,'expert.verification','Expert application updated',b.status==='approved'?'Approved. Set your services and availability to begin.':clean(b.reason)||'Your application is under review.');res.json({profile:e})
})
router.get('/admin/care/bookings',...admin,async(req,res)=>list(res,Booking,req.query.status?{status:req.query.status}:{},req,[{path:'mother expert',select:'name'},{path:'service',select:'title'}],'-request.noteCipher -notes'))
router.post('/admin/bookings/:id/refund',...admin,async(req,res)=>{const b=await Booking.findById(id(req.params.id));assert(b,'Booking not found.',404);assert([0.5,1].includes(Number(req.body.fraction))&&clean(req.body.reason).length>=3,'Choose full/50% refund and provide a reason.');const amount=b.payment.amount*Number(req.body.fraction);assert(req.user.role==='superadmin'||amount<=5000,'Refunds above ₹5,000 require superadmin.',403);assert(!b.payment.refunded,'Refund already processed.',409);b.payment.refundFraction=Number(req.body.fraction);b.payment.refundReason=clean(req.body.reason);b.payment.refundState='pending';await b.save();await refundBooking(b,Number(req.body.fraction));await audit(req,'booking.refund',b.id,{captured:b.payment.captured},{fraction:req.body.fraction},req.body.reason);res.json({ok:true})})
router.post('/admin/bookings/:id/reassign',...admin,async(req,res)=>{
 const b=await Booking.findById(id(req.params.id));assert(b&&b.status==='confirmed','Only confirmed bookings can be reassigned.');assert(clean(req.body.reason).length>=3,'Provide a reassignment reason.');const old=await Service.findById(b.service),s=await Service.findOne({_id:id(req.body.serviceId),active:true,type:old.type,durationMin:b.durationMin});assert(s,'Choose a replacement with the same service and duration.')
 await transaction(async session=>{for(const expertId of [String(b.expert),String(s.expert)].sort())await Expert.updateOne({user:expertId},{$inc:{lockVersion:1}},{session});const current=await Booking.findOne({_id:b.id,status:'confirmed',expert:b.expert}).session(session);assert(current,'Booking changed.',409);await checkSlot(s,b.startAt,session,{ignoreId:b.id,reschedule:true});current.expert=s.expert;current.expertKey=String(s.expert);current.expertId=String(s.expert);current.expertName=(await User.findById(s.expert).session(session)).name;current.service=s.id;await current.save({session})});await audit(req,'booking.reassign',b.id,{expert:b.expert},{expert:s.expert},req.body.reason);res.json({ok:true})
})
router.get('/admin/care/users',...admin,async(req,res)=>list(res,User,{},req,null,'name email role status createdAt'))
router.patch('/admin/users/:id/status',...admin,async(req,res)=>{const u=await User.findById(id(req.params.id));assert(u&&u.id!==req.user.id,'Cannot change your own status.');assert(!isAdmin(u)||req.user.role==='superadmin','Only superadmin can manage administrators.',403);assert(['active','suspended'].includes(req.body.status)&&clean(req.body.reason).length>=3,'A status and reason are required.');const before=u.status;u.status=req.body.status;u.tokenVersion++;await u.save();await audit(req,'user.status',u.id,before,u.status,req.body.reason);res.json({user:safeUser(u)})})
router.get('/admin/care/payments',...admin,async(req,res)=>list(res,Booking,{'payment.orderId':{$exists:true}},req,[{path:'mother expert',select:'name'}],'-request.noteCipher -notes'))
router.get('/admin/care/inquiries',...admin,async(req,res)=>list(res,Inquiry,{},req))
router.patch('/admin/care/inquiries/:id',...admin,async(req,res)=>{assert(['new','in_progress','resolved'].includes(req.body.status),'Invalid status.');await Inquiry.updateOne({_id:id(req.params.id)},{$set:{status:req.body.status}});await audit(req,'inquiry.status',req.params.id,null,req.body.status,'Status updated');res.json({ok:true})})
router.get('/admin/care/moderation',...admin,async(req,res)=>res.json({reviews:await Review.find({reportReason:{$exists:true,$ne:''}}).populate('mother expert','name'),messages:await Message.find({reported:true}).select('_id thread sender createdAt')}))
router.get('/admin/reported-messages/:id',...admin,async(req,res)=>{const msg=await Message.findOne({_id:id(req.params.id),reported:true}).select('+bodyCipher');assert(msg,'Reported message not found.',404);await audit(req,'reported_message.read',msg.id,null,null,'Reported content review');res.json({message:{...msg.toObject(),body:decrypt(msg.bodyCipher,''),bodyCipher:undefined}})})
router.patch('/admin/reviews/:id',...admin,async(req,res)=>{assert(['visible','removed'].includes(req.body.status)&&clean(req.body.reason),'Choose a moderation decision and reason.');const review=await Review.findByIdAndUpdate(id(req.params.id),{$set:{status:req.body.status},$unset:{reportReason:1}},{new:true});assert(review,'Review not found.',404);await audit(req,'review.moderate',review.id,null,req.body.status,req.body.reason);await alert(review.mother,'review.moderated','Review moderation update',clean(req.body.reason));res.json({ok:true})})
router.get('/admin/care/settings',...admin,async(req,res)=>res.json({items:await Settings.find(),templates:await CareTemplate.find(),plans,redFlags}))
router.put('/admin/care/settings',...admin,requireRole('superadmin'),async(req,res)=>{assert(['payoutTdsPct','supportEmail'].includes(req.body.key),'This setting is not editable through this endpoint.');if(req.body.key==='payoutTdsPct')assert(Number(req.body.value)>=0&&Number(req.body.value)<=30,'TDS rate must be 0–30%.');await Settings.updateOne({key:req.body.key},{$set:{value:req.body.value}},{upsert:true});await audit(req,'settings.update',req.body.key,null,req.body.value,'Settings updated');res.json({ok:true})})
router.post('/admin/care/templates',...admin,async(req,res)=>{assert(clean(req.body.title)&&['Nutrition','Movement','Mind'].includes(req.body.category),'Enter title and category.');res.json({template:await CareTemplate.create({title:clean(req.body.title),category:req.body.category,frequency:req.body.frequency||'daily'})})})
router.get('/admin/care/groups',...admin,async(req,res)=>list(res,Group,{},req,{path:'host',select:'name'}))
router.patch('/admin/care/groups/:id',...admin,async(req,res)=>{assert(['live','rejected'].includes(req.body.status),'Choose live or rejected.');await transaction(async session=>{const g=await Group.findById(id(req.params.id)).session(session);assert(g,'Group not found.',404);await Expert.updateOne({user:g.host},{$inc:{lockVersion:1}},{session});if(req.body.status==='live'){const end=new Date(+g.startAt+g.durationMin*MIN);assert(!await Booking.exists({expert:g.host,status:{$in:['confirmed','in_progress','held']},startAt:{$lt:end},endAt:{$gt:g.startAt}}).session(session),'Group overlaps an individual booking.',409);assert(!await Group.exists({_id:{$ne:g._id},host:g.host,status:'live',startAt:{$lt:end},$expr:{$gt:[{$add:['$startAt',{$multiply:['$durationMin',MIN]}]},g.startAt]}}).session(session),'Group overlaps another group.',409)}g.status=req.body.status;await g.save({session})});await audit(req,'group.review',req.params.id,null,req.body.status,req.body.reason||'Group review');res.json({ok:true})})
router.get('/admin/care/payouts',...admin,async(req,res)=>list(res,Payout,{},req,{path:'expert',select:'name email'}))
router.post('/admin/payouts/:id/mark-paid',...admin,requireRole('superadmin'),async(req,res)=>{assert(clean(req.body.utr).length>=5,'Enter the bank transfer UTR.');const p=await Payout.findOneAndUpdate({_id:id(req.params.id),status:'pending'},{$set:{status:'paid',utr:clean(req.body.utr)}},{new:true});assert(p,'Pending payout not found.',404);await audit(req,'payout.paid',p.id,null,{utr:p.utr},'Bank transfer recorded');await alert(p.expert,'payout.paid','Payout sent','Your earnings statement has been updated.');res.json({payout:p})})
router.get('/admin/care/audit',...admin,async(req,res)=>list(res,AuditLog,{},req))
// Replace legacy admin metadata reads to prevent accidental exposure of customer profile/context.
router.get('/admin/users',...admin,async(req,res)=>list(res,User,{role:{$in:['mother','user']}},req,null,'name email role status emailVerified createdAt'))
router.get('/admin/users/:id',...admin,async(req,res)=>{const item=await User.findById(id(req.params.id)).select('name email role status emailVerified createdAt');assert(item,'User not found.',404);res.json({item})})
router.get('/admin/users/export.csv',...admin,(_req,res)=>res.status(403).json({message:'Use the metadata-only Users view.'}))
export default router
