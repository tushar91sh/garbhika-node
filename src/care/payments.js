import Booking from '../models/Booking.js'
import { groupPayment } from './groups.js'
import { Mother, Subscription, WebhookEvent } from './models.js'
import { assert } from '../utils/validation.js'
import { validSignature } from './security.js'
import { paymentMock,razor } from './integrations.js'
import { onConfirmed,refundBooking,transaction,alert } from './booking.js'
import { plans,DAY } from './policy.js'
export async function processPayment(payment) {
 const b=await Booking.findOne({'payment.orderId':payment.order_id});if(!b){await groupPayment(payment);return}
 assert(payment.currency==='INR'&&payment.amount===Math.round(b.payment.amount*100),'Payment amount/currency mismatch.',400)
 if(b.payment.captured && b.payment.paymentId===payment.id)return
 if(!['authorized','captured'].includes(payment.status))return
 b.payment.paymentId=payment.id;b.payment.status=payment.status;b.payment.captured=payment.status==='captured'
 if(['cancelled_by_mother','cancelled_by_expert','declined','expired'].includes(b.status)){
   await b.save();if(b.payment.captured)await refundBooking(b,b.payment.refundFraction||1);return
 }
 if(b.mode==='instant' || b.status==='held'){
   if(b.holdUntil && +b.holdUntil<Date.now()){b.status='expired';await b.save();if(b.payment.captured)await refundBooking(b,1);return}
   if(payment.status==='captured')b.status='confirmed'
 }
 await b.save()
 if(b.status==='confirmed')await onConfirmed(b)
}
export async function paymentWebhook(req,res,next) {
 try{
   assert(validSignature(req.body,req.get('x-razorpay-signature'),process.env.RAZORPAY_WEBHOOK_SECRET),'Invalid webhook signature.',401)
   const event=JSON.parse(req.body.toString()),key=req.get('x-razorpay-event-id')
   if(key&&await WebhookEvent.exists({key,processedAt:{$exists:true}}))return res.json({received:true})
   const p=event.payload?.payment?.entity
   if(p&&['payment.authorized','payment.captured','order.paid'].includes(event.event))await processPayment(p)
   if(event.event==='subscription.charged'){
     const provider=event.payload?.subscription?.entity,sub=await Subscription.findOne({providerId:provider?.id})
     if(sub&&p){await transaction(async session=>{
       const seen=await WebhookEvent.exists({key:'renewal:'+p.id}).session(session);if(seen)return
       const plan=sub.pendingPlan||sub.plan
       await Mother.updateOne({user:sub.mother},{$set:{plan,credits:plans[plan].credits,renewsAt:new Date(provider.current_end*1000)}},{session})
       await Subscription.updateOne({_id:sub.id},{$set:{plan,status:'active',currentPeriodEnd:new Date(provider.current_end*1000),paymentId:p.id,pendingPlan:null,renewalFailures:0}},{session})
       await WebhookEvent.create([{key:'renewal:'+p.id,processedAt:new Date()}],{session})
     });await alert(sub.mother,'subscription.renewed','Membership renewed','Your session credits have been reset.')}
   }
   if(['subscription.halted','subscription.cancelled','subscription.completed'].includes(event.event)){
     const provider=event.payload?.subscription?.entity
     const sub=await Subscription.findOneAndUpdate({providerId:provider?.id},{$set:{status:event.event.split('.')[1]}},{new:true})
     if(sub)await alert(sub.mother,'subscription.changed','Membership status changed','Open Membership for payment and renewal details.')
   }
   if(key)await WebhookEvent.updateOne({key},{$set:{processedAt:new Date()}},{upsert:true})
   res.json({received:true})
 }catch(e){next(e)}
}
export async function mockPayment(b) {
 assert(paymentMock(),'Mock payments are available only in explicit development mode.',403)
 assert(b.payment.orderId?.startsWith('mock_'),'This order is not a mock order.')
 if(b.payment.captured)return b
 const status=b.mode==='request'&&b.status!=='held'?'authorized':'captured'
 await processPayment({order_id:b.payment.orderId,id:'mock_pay_'+b.id,status,amount:Math.round(b.payment.amount*100),currency:'INR'})
 return Booking.findById(b.id)
}
export async function createSubscription(user,plan) {
 assert(['village','premium'].includes(plan),'Choose a paid membership.')
 assert(!await Subscription.exists({mother:user.id,status:{$in:['active','created','authenticated']}}),'Manage or cancel your current membership first.',409)
 if(paymentMock()){
   const end=new Date(Date.now()+30*DAY)
   const sub=await Subscription.create({mother:user.id,plan,status:'active',currentPeriodEnd:end,providerId:'mock_'+Date.now()})
   await Mother.updateOne({user:user.id},{$set:{plan,credits:plans[plan].credits,renewsAt:end}})
   return {subscription:sub,mock:true}
 }
 const planId=process.env[plan==='village'?'RAZORPAY_VILLAGE_PLAN_ID':'RAZORPAY_PREMIUM_PLAN_ID'];assert(planId,'Configure Razorpay recurring plan IDs.',503)
 const provider=await razor('/subscriptions',{plan_id:planId,total_count:120,quantity:1,customer_notify:1,notes:{mother:user.id,plan}})
 const sub=await Subscription.create({mother:user.id,plan,status:'created',providerId:provider.id})
 return {subscription:sub,subscriptionId:provider.id,keyId:process.env.RAZORPAY_KEY_ID}
}
