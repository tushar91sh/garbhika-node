import {credentialBlock} from './credentials.js'
import mongoose from 'mongoose'
import { googleBusy } from './google.js'
import { emitUser } from './realtime.js'
import Booking from '../models/Booking.js'
import User from '../models/User.js'
import { Availability, Expert, Mother, Service, Thread, Notification, Job, Group, Settings } from './models.js'
import { assert } from '../utils/validation.js'
import { DAY,HOUR,MIN,istDate,activeStates,validDate,cancellationPolicy } from './policy.js'
import { encrypt } from './security.js'
import { razor,paymentMock } from './integrations.js'
export async function transaction(fn) {
  const session=await mongoose.startSession()
  try {let result;await session.withTransaction(async()=>{result=await fn(session)});return result}
  catch(e){if(/Transaction numbers|replica set|mongos/i.test(e.message)){e.status=503;e.message='Booking requires MongoDB Atlas or a local replica set. See GARBHIKA_SETUP.md.'}throw e}
  finally{await session.endSession()}
}
export async function motherFor(user) {
  let m=await Mother.findOne({user:user.id})
  if(!m) {
    const coach=await Expert.findOne({'verification.status':'approved',isCoach:true}).sort({createdAt:1})
    try{m=await Mother.create({user:user.id,coach:coach?.user,stage:user.profile?.stage==='Pregnant'?'pregnant':user.profile?.stage==='Postpartum'?'postpartum':'ttc',dueDate:user.profile?.dueDate||undefined,language:user.profile?.language||'English',interests:user.profile?.services||[]})}catch(e){if(e.code!==11000)throw e;m=await Mother.findOne({user:user.id})}
  }
  return m
}
export async function alert(user,type,title,body,payload={},key) {
  if(!user)return
  let n
  try{n=await Notification.create({user,type,title,body,payload,...(key?{dedupe:key}:{})})}catch(e){if(e.code===11000)return;throw e}
  emitUser(user,'notification:new',{id:n.id,title})
  await Job.updateOne({key:'channels:'+n.id},{$setOnInsert:{type:'channels',payload:{notification:n.id},dueAt:new Date()}},{upsert:true})
  await Job.updateOne({key:'email:'+n.id},{$setOnInsert:{type:'email',payload:{notification:n.id},dueAt:new Date()}},{upsert:true})
}
export async function both(booking,type,title) {
  await Promise.all([alert(booking.mother,type,title,'Check your sessions for details.',{bookingId:booking.id}),alert(booking.expert,type,title,'Check your dashboard for details.',{bookingId:booking.id})])
}
const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3))
export async function availabilityFor(id) {const defaults=(await Settings.findOne({key:'bookingDefaults'}))?.value||{};return await Availability.findOneAndUpdate({expert:id},{$setOnInsert:{expert:id,...defaults}},{new:true,upsert:true,setDefaultsOnInsert:true})}
export async function checkSlot(service,start,session,{ignoreId,now=Date.now(),reschedule=false}={}) {
  const options=session?{session}:{}
  const expert=await Expert.findOne({user:service.expert,...(!reschedule?{accepting:true}:{}),'verification.status':'approved'},null,options)
  assert(expert && !credentialBlock(expert,now),'Expert is unavailable.',409)
  assert(await User.exists({_id:service.expert,status:'active'}).session(session||null),'Expert account is unavailable.',409)
  const a=await Availability.findOne({expert:service.expert},null,options)
  assert(a,'Expert has not configured availability.',409)
  const startAt=new Date(start),endAt=new Date(+startAt+service.durationMin*MIN)
  assert(Number.isFinite(+startAt) && +startAt>=now+a.minNoticeH*HOUR && +startAt<=now+a.windowDays*DAY,'Choose a time inside the booking window and minimum notice.')
  const local=new Date(+startAt+330*MIN),date=istDate(startAt),dow=local.getUTCDay(),mm=local.getUTCHours()*60+local.getUTCMinutes()
  const overrides=a.overrides.filter(x=>x.date===date)
  const blocks=overrides.length?overrides.filter(x=>!x.closed):a.weekly.filter(x=>x.dow===dow)
  assert(blocks.some(x=>mm>=minutes(x.start)&&mm+service.durationMin<=minutes(x.end)),'This time is outside availability.',409)
  const query={expert:service.expert,_id:{$ne:ignoreId||new mongoose.Types.ObjectId()},$or:[{status:{$in:['confirmed','in_progress']}},{status:'held',holdUntil:{$gt:new Date(now)}}]}
  assert(!await Booking.exists({...query,startAt:{$lt:new Date(+endAt+a.bufferMin*MIN)},endAt:{$gt:new Date(+startAt-a.bufferMin*MIN)}}).session(session||null),'This time overlaps another booking.',409)
  assert(await Booking.countDocuments({...query,dateKey:date}).session(session||null)<a.maxPerDay,'The expert has reached the daily booking limit.',409)
  assert(!await Group.exists({host:service.expert,status:'live',startAt:{$lt:new Date(+endAt+a.bufferMin*MIN)},$expr:{$gt:[{$add:['$startAt',{$multiply:['$durationMin',MIN]}]},new Date(+startAt-a.bufferMin*MIN)]}}).session(session||null),'This time overlaps a group session.',409)
  const busy=await googleBusy(service.expert,date);assert(!busy.some(b=>+new Date(b.start)<+endAt+a.bufferMin*MIN&&+new Date(b.end)>+startAt-a.bufferMin*MIN),'This time conflicts with Google Calendar.',409)
  return {expert,a,startAt,endAt,dateKey:date,timeSlot:`${String(local.getUTCHours()).padStart(2,'0')}:${String(local.getUTCMinutes()).padStart(2,'0')}`}
}
export async function slotsFor(expertId,serviceId,from,to,{limit=Infinity,forRequest=false}={}) {
  const service=await Service.findOne({_id:serviceId,expert:expertId,active:true});assert(service,'Service not found.',404)
  assert(validDate(from)&&validDate(to)&&to>=from&&+new Date(to)-+new Date(from)<=31*DAY,'Choose a date range of up to 31 days.')
  const a=await availabilityFor(expertId);if(forRequest?!a.allowRequests:!a.allowInstant)return []
  const result=[]
  for(let date=+new Date(from);date<=+new Date(to);date+=DAY){const day=new Date(date).toISOString().slice(0,10),dow=new Date(date).getUTCDay(),ov=a.overrides.filter(x=>x.date===day),blocks=ov.length?ov.filter(x=>!x.closed):a.weekly.filter(x=>x.dow===dow)
    for(const block of blocks)for(let m=minutes(block.start);m+service.durationMin<=minutes(block.end);m+=service.durationMin+a.bufferMin){const start=new Date(`${day}T${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}:00+05:30`)
      try{const slot=await checkSlot(service,start);result.push({startAt:slot.startAt,endAt:slot.endAt});if(result.length>=limit)return result}catch(e){if(e.status!==400&&e.status!==409)throw e}
    }
  }return result
}
export async function createBooking(user,input,{welcome=false}={}) {
  const m=await motherFor(user);assert(m.consents.terms&&m.consents.privacy,'Complete onboarding and accept the terms/privacy policy before booking.')
  const service=await Service.findOne({_id:input.serviceId,active:true});assert(service,'Service not found.',404)
  assert(['instant','request'].includes(input.mode),'Choose instant or request booking.')
  assert(['credit','paid'].includes(input.paymentKind)||welcome&&input.paymentKind==='welcome','Choose credit or paid booking.')
  if(welcome)assert(input.mode==='instant'&&service.type==='guidance'&&String(service.expert)===String(m.coach),'The free welcome call must be with your assigned coach.')
  const expert=await Expert.findOne({user:service.expert,accepting:true,'verification.status':'approved'});assert(expert&&!credentialBlock(expert),'Expert is not bookable.',409)
  const a=await availabilityFor(service.expert);assert(input.mode==='instant'?a.allowInstant:a.allowRequests,'This booking mode is disabled.')
  if(input.mode==='request')assert(validDate(input.date)&&input.date>=istDate()&&+new Date(input.date)<=Date.now()+a.windowDays*DAY&&['morning','afternoon','evening'].includes(input.window),'Choose a valid request date and window.')
  if(input.paymentKind==='credit')assert(m.credits>0,'No membership credits are available.')
  const booking=await transaction(async session=>{
    await Expert.updateOne({_id:expert.id},{$inc:{lockVersion:1}},{session})
    let slot={dateKey:input.date,timeSlot:'request-'+new mongoose.Types.ObjectId(),startAt:undefined,endAt:undefined}
    if(input.mode==='instant')slot=await checkSlot(service,input.startAt,session)
    const instantCredit=input.mode==='instant'&&input.paymentKind==='credit',instantFree=welcome&&input.paymentKind==='welcome'
    if(instantFree)assert((await Mother.updateOne({_id:m.id,welcomeUsedAt:null},{$set:{welcomeUsedAt:new Date()}},{session})).modifiedCount,'Your free welcome call has already been used.',409)
    if(instantCredit)assert((await Mother.updateOne({_id:m.id,credits:{$gt:0}},{$inc:{credits:-1}},{session})).modifiedCount,'No credits are available.',409)
    const [b]=await Booking.create([{mother:user.id,user:user.id,expert:service.expert,service:service.id,mode:input.mode,name:user.name,email:user.email,expertKey:String(service.expert),expertId:String(service.expert),expertName:(await User.findById(service.expert).session(session))?.name,preferredDate:slot.startAt||new Date(input.date+'T12:00:00+05:30'),...Object.fromEntries(Object.entries(slot).filter(([k])=>k!=='expert'&&k!=='a')),durationMin:service.durationMin,status:input.mode==='request'?'requested':instantCredit||instantFree?'confirmed':'held',holdUntil:input.mode==='instant'?new Date(Date.now()+10*MIN):undefined,request:input.mode==='request'?{date:input.date,window:input.window,noteCipher:encrypt(String(input.note||'').slice(0,3000)),expiresAt:new Date(Date.now()+DAY)}:undefined,payment:{kind:input.paymentKind,amount:instantFree?0:service.priceInr,status:instantFree?'welcome':instantCredit?'credit_used':'pending',creditUsed:instantCredit,captured:instantCredit||instantFree}}],{session});return b
  })
  if(input.paymentKind==='paid'){
    try{
      if(paymentMock()){booking.payment.orderId='mock_'+booking.id;booking.payment.status='mock_pending'}
      else {const order=await razor('/orders',{amount:service.priceInr*100,currency:'INR',receipt:booking.id,notes:{bookingId:booking.id},payment_capture:input.mode==='instant'?1:0});booking.payment.orderId=order.id}
      await booking.save()
    }catch(e){await Booking.updateOne({_id:booking.id},{$set:{status:'expired'}});throw e}
  }
  if(booking.mode==='request')await Thread.updateOne({mother:booking.mother,expert:booking.expert},{$max:{closesAt:new Date(Date.now()+30*DAY)}},{upsert:true})
  if(booking.status==='confirmed')await onConfirmed(booking)
  else await both(booking,'booking.requested',input.mode==='request'?'New session time request':'Complete payment to hold your session')
  return booking
}
export async function onConfirmed(b) {
  if(process.env.DAILY_API_KEY)try{await (await import('./integrations.js')).roomFor(b)}catch(e){await Job.updateOne({key:'room:'+b.id},{$setOnInsert:{type:'room',payload:{bookingId:b.id},dueAt:new Date()}},{upsert:true})}
  await Thread.updateOne({mother:b.mother,expert:b.expert},{$max:{closesAt:new Date(+b.endAt+30*DAY)}},{upsert:true})
  await both(b,'booking.confirmed','Session confirmed')
  for(const offset of [24*HOUR,15*MIN])await Job.updateOne({key:`reminder:${b.id}:${offset}`},{$set:{type:'reminder',payload:{bookingId:b.id},dueAt:new Date(+b.startAt-offset)},$unset:{doneAt:1,lockedUntil:1,lastError:1},$setOnInsert:{attempts:0}},{upsert:true})
}
export async function confirmRequest(b,startAt) {
  const service=await Service.findById(b.service);assert(service,'Service unavailable.',409)
  const updated=await transaction(async session=>{
    await Expert.updateOne({user:b.expert},{$inc:{lockVersion:1}},{session})
    const current=await Booking.findById(b.id).session(session);assert(['requested','proposed'].includes(current.status)&&+current.request.expiresAt>Date.now(),'Request expired or already resolved.',409)
    const slot=await checkSlot(service,startAt,session)
    const local=slot.startAt;const localHour=new Date(+local+330*MIN).getUTCHours();const windowRange={morning:[8,12],afternoon:[12,16],evening:[16,20]}[current.request.window];assert(current.status==='proposed'||istDate(local)===current.request.date&&localHour>=windowRange[0]&&localHour<windowRange[1],'Accept a time on the requested date or propose alternatives.')
    if(current.payment.kind==='credit')assert((await Mother.updateOne({user:b.mother,credits:{$gt:0}},{$inc:{credits:-1}},{session})).modifiedCount,'Mother has no remaining credits.',409)
    else assert(['authorized','captured','mock_authorized'].includes(current.payment.status),'Payment authorization has not arrived. Ask the mother to complete checkout.',409)
    Object.assign(current,{startAt:slot.startAt,endAt:slot.endAt,dateKey:slot.dateKey,timeSlot:slot.timeSlot,status:current.payment.kind==='credit'||current.payment.captured?'confirmed':'held',holdUntil:new Date(Date.now()+10*MIN)})
    if(current.payment.kind==='credit'){current.payment.creditUsed=true;current.payment.captured=true;current.payment.status='credit_used'}
    await current.save({session});return current
  })
  if(updated.payment.kind==='paid'&&!updated.payment.captured){
    if(paymentMock()&&String(updated.payment.paymentId).startsWith('mock_')){updated.payment.status='captured';updated.payment.captured=true;updated.status='confirmed';await updated.save()}
    else await razor(`/payments/${updated.payment.paymentId}/capture`,{amount:Math.round(updated.payment.amount*100),currency:'INR'})
  }
  if(updated.status==='confirmed')await onConfirmed(updated)
  return updated
}
export async function cancelBooking(b,by,reason) {
  assert(['held','requested','proposed','confirmed'].includes(b.status),'This booking can no longer be cancelled.',409)
  assert(String(reason||'').trim().length>=3,'A cancellation reason is required.')
  const policy=cancellationPolicy(b,by)
  const current=await Booking.findOneAndUpdate({_id:b.id,status:b.status},{$set:{status:by==='expert'?'cancelled_by_expert':'cancelled_by_mother',cancel:{by,at:new Date(),reason:String(reason).slice(0,500)},'payment.refundFraction':policy.fraction,'payment.refundReason':reason,'payment.refundState':'pending'}},{new:true})
  assert(current,'Booking changed. Refresh and retry.',409)
  if(policy.goodwill)await Mother.updateOne({user:b.mother},{$inc:{goodwillInr:policy.goodwill}})
  await refundBooking(current,policy.fraction)
  await both(current,'booking.cancelled','Session cancelled')
  return current
}
export async function refundBooking(b,fraction) {
  if(b.payment.refunded)return b
  if(b.payment.kind==='credit') {
    await transaction(async session=>{
      const claim=await Booking.updateOne({_id:b.id,'payment.refunded':{$ne:true}},{$set:{'payment.refunded':true,'payment.refundState':'processed'}},{session})
      if(claim.modifiedCount && b.payment.creditUsed && fraction===1)await Mother.updateOne({user:b.mother},{$inc:{credits:1}},{session})
    })
  } else if(b.payment.captured && b.payment.paymentId) {
    if(!String(b.payment.paymentId).startsWith('mock_'))await razor(`/payments/${b.payment.paymentId}/refund`,{amount:Math.round(b.payment.amount*fraction*100),notes:{bookingId:b.id}},'POST','refund_'+b.id)
    await Booking.updateOne({_id:b.id},{$set:{'payment.refunded':true,'payment.refundState':'submitted','payment.refundedInr':b.payment.amount*fraction}})
  }else await Booking.updateOne({_id:b.id},{$set:{'payment.refundState':'not_captured'}})
  return Booking.findById(b.id)
}
