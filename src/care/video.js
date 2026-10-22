import { createHmac,timingSafeEqual } from 'node:crypto'
import Booking from '../models/Booking.js'
import { assert } from '../utils/validation.js'
import { daily,roomFor } from './integrations.js'
import { MIN } from './policy.js'
export async function joinToken(booking,user,{audioOnly=false}={}) {
 assert(['confirmed','in_progress'].includes(booking.status),'This session is not confirmed.',409)
 assert(String(booking.mother)===user.id||String(booking.expert)===user.id,'You are not a session participant.',403)
 assert(Date.now()>=+booking.startAt-10*MIN&&Date.now()<=+booking.endAt+15*MIN,'Join opens 10 minutes before the session and closes 15 minutes after the end.',403)
 const room=await roomFor(booking)
 const data=await daily('/meeting-tokens',{properties:{room_name:room.name,user_id:user.id,user_name:user.name,start_video_off:audioOnly,is_owner:user.role==='expert',nbf:Math.floor((+booking.startAt-10*MIN)/1000),exp:Math.floor((+booking.endAt+15*MIN)/1000),enable_recording:false}})
 return {url:room.url,token:data.token}
}
export async function videoWebhook(req,res,next) {
 try {
   const signature=req.get('x-webhook-signature'),timestamp=req.get('x-webhook-timestamp'),secret=process.env.DAILY_WEBHOOK_SECRET
   assert(secret&&signature&&timestamp,'Video webhook signature required.',401)
   // Daily signs the timestamp plus the raw JSON payload using the base64 webhook secret.
   const expected=createHmac('sha256',Buffer.from(secret,'base64')).update(timestamp+'.'+req.body.toString()).digest('base64')
   const a=Buffer.from(expected),b=Buffer.from(signature)
   assert(a.length===b.length&&timingSafeEqual(a,b)&&Math.abs(Date.now()/1000-Number(timestamp))<300,'Invalid or expired video webhook.',401)
   const event=JSON.parse(req.body.toString());if(event.test==='test')return res.json({received:true});const p=event.payload||{},name=p.room||p.room_name
   const booking=await Booking.findOne({roomId:name});if(!booking)return res.json({received:true})
   const side=String(p.user_id)===String(booking.mother)?'mother':String(p.user_id)===String(booking.expert)?'expert':null
   if(side&&event.type==='participant.joined')await Booking.updateOne({_id:booking.id,[`attendance.${side}JoinAt`]:{$exists:false}},{$set:{[`attendance.${side}JoinAt`]:new Date(event.event_ts*1000||Date.now())}})
   if(side&&event.type==='participant.left')await Booking.updateOne({_id:booking.id},{$set:{[`attendance.${side}LeaveAt`]:new Date()}})
   res.json({received:true})
 }catch(e){next(e)}
}
