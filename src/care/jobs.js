import {processCredentialReminders} from './credentials.js'
import { loadCarePolicy } from './configuration.js'
import Booking from '../models/Booking.js'
import { sendOtherChannels } from './channels.js'
import User from '../models/User.js'
import { Job,Notification,Message,Expert,Note,Mother,Subscription,Payout,Settings,Journal,Task,TaskCheck,Thread,Document,AccessLog,Refresh,Review,Group,GroupRegistration } from './models.js'
import { alert,both,refundBooking,transaction } from './booking.js'
import { sendMail } from '../services/email.js'
import { DAY,HOUR,MIN,payoutFor } from './policy.js'
async function deliver(job) {
 if(job.type==='room'){const b=await Booking.findById(job.payload.bookingId);if(b?.status==='confirmed')await (await import('./integrations.js')).roomFor(b)}
 if(job.type==='email'){
  const n=await Notification.findById(job.payload.notification);if(!n)return
  const user=await User.findById(n.user),m=await Mother.findOne({user:n.user})
  if(!user||user.status==='deleted')return
  if((m?.channels||user.notificationChannels)?.email===false&&!/payment|subscription|account/.test(n.type))return
  const sent=await sendMail({to:user.email,subject:'Garbhika: '+n.title,text:n.body+'\nOpen your dashboard for details.'})
  if(!sent)throw new Error('Email delivery is not configured')
 }
 if(job.type==='channels'){const n=await Notification.findById(job.payload.notification);if(n){const user=await User.findById(n.user);if(user&&user.status!=='deleted')await sendOtherChannels(n,user)}}
 if(job.type==='reminder'){const b=await Booking.findById(job.payload.bookingId);if(b?.status==='confirmed')await both(b,'session.reminder','Your session starts soon')}
 if(job.type==='chat'){const msg=await Message.findById(job.payload.messageId);if(msg&&!msg.readAt)await alert(job.payload.recipient,'chat.unread','New message','You have an unread message. Open Messages to reply.',{threadId:msg.thread},'chat-notification:'+msg.id)}
}
export async function tickJobs() {
 await loadCarePolicy()
 const now=new Date()
 const staff=await User.find({role:{$in:['admin','superadmin']},status:'active'}).select('_id')
 for(const b of await Booking.find({status:{$in:['requested','proposed']},'request.expiresAt':{$gt:now,$lte:new Date(Date.now()+4*HOUR)}}).limit(100)){await alert(b.expert,'request.expiring','Request expires soon','Respond within four hours.',{bookingId:b.id},'request-expiry:'+b.id);for(const a of staff)await alert(a.id,'request.expiring','Session request needs attention','An expert request is approaching expiry.',{bookingId:b.id},'request-expiry:'+b.id+':'+a.id)}
 // Backfill coach assignment for mothers who joined before a coach was approved.
 const coach=await Expert.findOne({isCoach:true,'verification.status':'approved',accepting:true})
 if(coach)for(const m of await Mother.find({coach:null}).limit(100)){m.coach=coach.user;await m.save();await Thread.updateOne({mother:m.user,expert:coach.user},{$max:{closesAt:new Date(Date.now()+365*DAY)}},{upsert:true})}
 for(let i=0;i<25;i++){
  const job=await Job.findOneAndUpdate({doneAt:null,dueAt:{$lte:now},$or:[{lockedUntil:null},{lockedUntil:{$lt:now}}],attempts:{$lt:10}},{$set:{lockedUntil:new Date(Date.now()+MIN)},$inc:{attempts:1}},{new:true,sort:{dueAt:1}})
  if(!job)break
  try{await deliver(job);await Job.updateOne({_id:job.id},{$set:{doneAt:new Date()},$unset:{lastError:1}})}catch(e){await Job.updateOne({_id:job.id},{$set:{lastError:e.message,lockedUntil:null,dueAt:new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000)}})}
 }
 for(const b of await Booking.find({$or:[{status:{$in:['requested','proposed']},'request.expiresAt':{$lte:now}},{status:'held',holdUntil:{$lte:now}}]}).limit(100)){
  const claim=await Booking.updateOne({_id:b.id,status:b.status},{$set:{status:'expired','payment.refundFraction':1,'payment.refundState':'pending'}})
  if(claim.modifiedCount){await refundBooking(b,1);await both(b,'booking.expired','Session request or payment hold expired');if(b.mode==='request'){const service=await (await import('./models.js')).Service.findById(b.service);const alternatives=await (await import('./models.js')).Service.find({type:service?.type,active:true,expert:{$ne:b.expert}}).limit(10);const similar=[];for(const candidate of alternatives){const from=new Date(Date.now()+DAY).toISOString().slice(0,10),to=new Date(Date.now()+7*DAY).toISOString().slice(0,10);try{const slots=await (await import('./booking.js')).slotsFor(candidate.expert,candidate.id,from,to,{limit:1});if(slots.length)similar.push({expertId:candidate.expert,serviceId:candidate.id,startAt:slots[0].startAt})}catch{}if(similar.length===3)break}await alert(b.mother,'booking.alternatives','Find another session','Open Sessions to book another available expert.',{alternatives:similar},'alternatives:'+b.id)}}
 }
 for(const b of await Booking.find({'payment.refundState':'pending'}).limit(25))try{await refundBooking(b,b.payment.refundFraction||1)}catch(e){console.warn('Refund retry deferred:',b.id,e.message)}
 // Confirmed calls only: attendance comes from the signature-verified provider webhook.
 for(const b of await Booking.find({status:{$in:['confirmed','in_progress']},startAt:{$lte:new Date(Date.now()-15*MIN)}}).limit(100)){
  const mother=!!b.attendance?.motherJoinAt,expert=!!b.attendance?.expertJoinAt
  if(!expert||!mother){
    const status=!expert?'no_show_expert':'no_show_mother';const claim=await Booking.updateOne({_id:b.id,status:{$in:['confirmed','in_progress']}},{$set:{status,...(!expert?{'payment.refundState':'pending','payment.refundFraction':1}:{})}})
    if(claim.modifiedCount&&!expert){await Mother.updateOne({user:b.mother},{$inc:{goodwillInr:200}});await refundBooking(b,1)}
  }else if(+b.endAt<=Date.now()){const result=await Booking.updateOne({_id:b.id,status:{$in:['confirmed','in_progress']}},{$set:{status:'completed'}});if(result.modifiedCount)await both(b,'session.completed','Session completed')}
  else if(b.status==='confirmed')await Booking.updateOne({_id:b.id,status:'confirmed'},{$set:{status:'in_progress'}})
 }
 await processCredentialReminders({Expert,User,alert})
 for(const b of await Booking.find({status:'completed',endAt:{$lte:new Date(Date.now()-DAY)}}).limit(100))if(!await Note.exists({booking:b.id,status:'published'}))await alert(b.expert,'note.overdue','Session note overdue','Publish the note to release this session’s payout.',{bookingId:b.id},'overdue-note:'+b.id)
 for(const m of await Mother.find({renewsAt:{$lte:now},plan:{$ne:'sanctuary'}})){
  const sub=await Subscription.findOne({mother:m.user,status:'active'}).sort({createdAt:-1})
  if(sub?.providerId?.startsWith('mock_')){
    const {plans}=await import('./policy.js'),next=sub.pendingPlan||sub.plan,end=new Date(Date.now()+30*DAY)
    await Mother.updateOne({_id:m.id,renewsAt:{$lte:now}},{$set:{plan:next,credits:plans[next].credits,renewsAt:end}})
    sub.plan=next;sub.pendingPlan=null;sub.currentPeriodEnd=end;if(next==='sanctuary')sub.status='cancelled';await sub.save()
  }else if(!sub||Date.now()-+m.renewsAt>7*DAY){await Mother.updateOne({_id:m.id},{$set:{plan:'sanctuary',credits:0},$unset:{renewsAt:1}})}
 }
 const local=new Date(Date.now()+330*MIN)
 if([1,16].includes(local.getUTCDate()))await createPayoutBatches()
 for(const m of await Mother.find({deletionAt:{$lte:now}}).limit(10)){
  const upcoming=await Booking.exists({mother:m.user,status:{$in:['confirmed','in_progress','held','requested','proposed']}})
  if(upcoming)continue // Resolve bookings/refunds before erasure.
  await transaction(async session=>{
    for(const model of [Journal,Task,TaskCheck,Thread,Document,Refresh])await model.deleteMany(model===Refresh?{user:m.user}:model===Document?{owner:m.user}:{mother:m.user}).session(session)
    // Retain financial and clinical records separately; pseudonymize the user identifier fields.
    await User.updateOne({_id:m.user},{$set:{name:'Deleted account',email:`deleted-${m.user}@invalid.local`,status:'deleted',profile:{},passwordHash:await User.hashPassword('deleted-'+Date.now())},$inc:{tokenVersion:1}},{session})
    await Mother.deleteOne({_id:m.id},{session})
  })
 }
}
export async function createPayoutBatches() {
 const experts=await Expert.find({'verification.status':'approved'})
 const rate=Number((await Settings.findOne({key:'payoutTdsPct'}))?.value||0)
 for(const e of experts){const candidates=await Booking.find({expert:e.user,status:'completed',endAt:{$lte:new Date(Date.now()-48*HOUR)},payoutId:null}),eligible=[]
  for(const b of candidates)if(await Note.exists({booking:b.id,status:'published'}))eligible.push(b)
  const hosted=await Group.find({host:e.user,startAt:{$lte:new Date(Date.now()-48*HOUR)}}),groupIds=hosted.filter(g=>+g.startAt+g.durationMin*MIN<=Date.now()-48*HOUR).map(g=>g.id)
  const groupCandidates=await GroupRegistration.find({group:{$in:groupIds},status:'confirmed',amount:{$gt:0},payoutId:null})
  if(!eligible.length&&!groupCandidates.length)continue
  await transaction(async session=>{
    await Expert.updateOne({_id:e.id},{$inc:{lockVersion:1}},{session})
    const fresh=await Booking.find({_id:{$in:eligible.map(b=>b.id)},payoutId:null}).session(session);const freshGroups=await GroupRegistration.find({_id:{$in:groupCandidates.map(g=>g.id)},payoutId:null}).session(session);if(!fresh.length&&!freshGroups.length)return
    const totals=[...fresh.map(b=>payoutFor(b,e.commissionPct)),...freshGroups.map(g=>({gross:g.amount,fee:Math.round(g.amount*30)/100}))],gross=totals.reduce((s,x)=>s+x.gross,0),fee=totals.reduce((s,x)=>s+x.fee,0),tds=Math.round((gross-fee)*rate)/100
    const [p]=await Payout.create([{expert:e.user,bookings:fresh.map(b=>b.id),groupRegistrations:freshGroups.map(g=>g.id),gross,fee,tds,net:Math.round((gross-fee-tds)*100)/100,periodStart:fresh.length?fresh.reduce((a,b)=>+a.endAt<+b.endAt?a:b).endAt:new Date(),periodEnd:new Date(),status:'pending'}],{session})
    await Booking.updateMany({_id:{$in:fresh.map(b=>b.id)}},{$set:{payoutId:p.id}},{session})
    await GroupRegistration.updateMany({_id:{$in:freshGroups.map(g=>g.id)}},{$set:{payoutId:p.id}},{session})
  })
 }
}
export async function startJobs() {
 if(process.env.REDIS_URL){const {startRedisWorker}=await import('./redis-worker.js');return startRedisWorker()}
 let busy=false
 const run=async()=>{if(busy)return;busy=true;try{await tickJobs()}catch(e){console.error('Care worker:',e.message)}finally{busy=false}}
 const timer=setInterval(run,30000);timer.unref();run();return ()=>clearInterval(timer)
}
