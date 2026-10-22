import User from '../models/User.js'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { Mother,PushSubscription } from './models.js'
import { assert } from '../utils/validation.js'
const router=Router()
router.get('/me/notification-preferences',requireAuth,async(req,res)=>{const m=await Mother.findOne({user:req.user.id});res.json({channels:m?.channels||req.user.notificationChannels||{email:true,inapp:true},phone:m?.notificationPhone||req.user.notificationPhone||'',pushPublicKey:process.env.VAPID_PUBLIC_KEY||'',whatsappConfigured:!!process.env.WHATSAPP_ACCESS_TOKEN})})
router.put('/me/notification-preferences',requireAuth,async(req,res)=>{
 const m=await Mother.findOne({user:req.user.id});
 const channels={email:req.body.channels?.email!==false,inapp:req.body.channels?.inapp!==false,push:req.body.channels?.push===true,whatsapp:req.body.channels?.whatsapp===true}
 if(channels.whatsapp)assert(/^\+[1-9]\d{7,14}$/.test(req.body.phone||''),'Enter your WhatsApp number with country code.')
 if(m){m.channels=channels;m.notificationPhone=req.body.phone||'';await m.save()}await User.updateOne({_id:req.user.id},{$set:{notificationChannels:channels,notificationPhone:req.body.phone||''}});res.json({ok:true})
})
router.post('/me/push-subscriptions',requireAuth,async(req,res)=>{
 const b=req.body;let url;try{url=new URL(b.endpoint)}catch{}
 assert(url?.protocol==='https:'&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)&&!url.username&&!url.password,'Unsupported push endpoint.')
 assert(typeof b.keys?.p256dh==='string'&&b.keys.p256dh.length<200&&typeof b.keys?.auth==='string'&&b.keys.auth.length<100,'Invalid push encryption keys.')
 await PushSubscription.updateOne({endpoint:b.endpoint},{$set:{user:req.user.id,keys:b.keys}},{upsert:true});res.json({ok:true})
})
export async function sendOtherChannels(n,user) {
 const mother=await Mother.findOne({user:user.id}),m=mother||{channels:user.notificationChannels,notificationPhone:user.notificationPhone,consents:{whatsapp:user.notificationChannels?.whatsapp===true}}
 if(m?.channels?.push&&process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY){
  const webpush=(await import('web-push')).default;webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:support@garbhika.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY)
  for(const s of await PushSubscription.find({user:user.id}))try{await webpush.sendNotification({endpoint:s.endpoint,keys:s.keys},JSON.stringify({title:n.title,body:'Open Garbhika for details.',url:'/dashboard'}))}catch(e){if([404,410].includes(e.statusCode))await PushSubscription.deleteOne({_id:s.id});else throw e}
 }
 if(m?.channels?.whatsapp&&m.consents?.whatsapp&&m.notificationPhone&&process.env.WHATSAPP_ACCESS_TOKEN){
  const template=process.env.WHATSAPP_NOTIFICATION_TEMPLATE;assert(template&&process.env.WHATSAPP_PHONE_NUMBER_ID,'Configure an approved WhatsApp template and phone number ID.',503)
  const version=process.env.WHATSAPP_GRAPH_VERSION||'v22.0',r=await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:m.notificationPhone.replace('+',''),type:'template',template:{name:template,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE||'en'},components:[{type:'body',parameters:[{type:'text',text:n.title}]}]}})});assert(r.ok,'WhatsApp delivery failed.',502)
 }
}
export default router
