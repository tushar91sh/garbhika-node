import { Router } from 'express'
import { Group,GroupRegistration,Mother } from './models.js'
import { requireAuth,requireRole } from '../middleware/auth.js'
import { assert } from '../utils/validation.js'
import { motherFor,transaction,alert } from './booking.js'
import { paymentMock,razor,daily } from './integrations.js'
import { MIN } from './policy.js'
const router=Router()
export async function groupPayment(payment) {
 const reg=await GroupRegistration.findOne({orderId:payment.order_id});if(!reg)return false
 assert(payment.currency==='INR'&&payment.amount===Math.round(reg.amount*100),'Group payment amount mismatch.')
 if(payment.status!=='captured'||reg.status==='confirmed')return true
 const g=await Group.findById(reg.group)
 if(reg.status==='expired'||+reg.holdUntil<Date.now()||g.status!=='live'){
   reg.status='refund_pending';reg.paymentId=payment.id;await reg.save()
   if(!payment.id.startsWith('mock_'))await razor(`/payments/${payment.id}/refund`,{amount:payment.amount},'POST','group_refund_'+reg.id)
   reg.status='refunded';await reg.save();return true
 }
 await transaction(async session=>{
   await Group.updateOne({_id:g.id},{$inc:{lockVersion:1}},{session})
   const claim=await GroupRegistration.updateOne({_id:reg.id,status:'held'},{$set:{status:'confirmed',paymentId:payment.id}},{session})
   if(claim.modifiedCount)await Group.updateOne({_id:g.id,'registrations.mother':{$ne:reg.mother}},{$push:{registrations:{mother:reg.mother,paid:true}}},{session})
 })
 await alert(reg.mother,'group.confirmed','Group session confirmed',g.title,{groupId:g.id},'group-confirmed:'+reg.id);return true
}
router.post('/groups/:id/register',requireAuth,requireRole('mother'),async(req,res)=>{
 await motherFor(req.user)
 const reg=await transaction(async session=>{
  const g=await Group.findOneAndUpdate({_id:req.params.id,status:'live',startAt:{$gt:new Date()}},{$inc:{lockVersion:1}},{new:true,session});assert(g,'Session not found.',404)
  const exists=await GroupRegistration.findOne({group:g.id,mother:req.user.id}).session(session)
  assert(!exists||['expired','refunded'].includes(exists.status)||exists.status==='held'&&+exists.holdUntil<Date.now(),'Already registered or payment is pending.',409)
  const held=await GroupRegistration.countDocuments({group:g.id,status:'held',holdUntil:{$gt:new Date()}}).session(session)
  assert(g.registrations.length+held<g.capacity,'Session is full.',409)
  const membership=await Mother.findOne({user:req.user.id}).session(session)
  const amount=membership?.plan&&membership.plan!=='sanctuary'?0:g.priceInr||0,fields={group:g.id,mother:req.user.id,amount,status:amount?'held':'confirmed',holdUntil:new Date(Date.now()+10*MIN)}
  let registration
  if(exists){Object.assign(exists,fields);await exists.save({session});registration=exists}else [registration]=await GroupRegistration.create([fields],{session})
  if(!amount)await Group.updateOne({_id:g.id},{$push:{registrations:{mother:req.user.id,paid:true}}},{session})
  return registration
 })
 if(reg.amount){try{reg.orderId=paymentMock()?'mock_group_'+reg.id:(await razor('/orders',{amount:Math.round(reg.amount*100),currency:'INR',receipt:reg.id,payment_capture:1,notes:{groupRegistration:reg.id}})).id;await reg.save()}catch(e){reg.status='expired';await reg.save();throw e}}
 res.json({registration:reg,keyId:process.env.RAZORPAY_KEY_ID,mock:paymentMock()})
})
router.post('/group-registrations/:id/mock-payment',requireAuth,requireRole('mother'),async(req,res)=>{
 assert(paymentMock(),'Mock payments are available only in development.',403)
 const reg=await GroupRegistration.findOne({_id:req.params.id,mother:req.user.id});assert(reg,'Registration not found.',404)
 await groupPayment({order_id:reg.orderId,id:'mock_group_pay_'+reg.id,status:'captured',amount:reg.amount*100,currency:'INR'});res.json({ok:true})
})
router.get('/groups/:id/join-token',requireAuth,async(req,res)=>{
 const g=await Group.findById(req.params.id);assert(g&&g.status==='live','Session not found.',404)
 const host=String(g.host)===req.user.id;assert(host||g.registrations.some(r=>String(r.mother)===req.user.id),'Register for this session before joining.',403)
 const end=+g.startAt+g.durationMin*MIN;assert(Date.now()>=+g.startAt-10*MIN&&Date.now()<=end+15*MIN,'Join opens 10 minutes before start.',403)
 const name='garbhika-group-'+g.id;let room
 try{room=await daily('/rooms/'+name)}catch{room=await daily('/rooms',{name,privacy:'private',properties:{exp:Math.floor((end+HOUR)/1000),enable_recording:false,max_participants:g.capacity+1,enable_prejoin_ui:true}})}
 const token=await daily('/meeting-tokens',{properties:{room_name:name,user_id:req.user.id,user_name:req.user.name,is_owner:host,exp:Math.floor((end+15*MIN)/1000),enable_recording:false}})
 res.json({url:room.url,token:token.token})
})
const HOUR=60*MIN
export default router
