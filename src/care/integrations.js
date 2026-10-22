import { assert } from '../utils/validation.js'
export const paymentMock=()=>process.env.NODE_ENV==='development'&&process.env.CARE_MOCK_PAYMENTS==='true'
export async function razor(path,body,method='POST',idempotency) {
  assert(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,'Configure Razorpay keys on the backend.',503)
  const response=await fetch(`https://api.razorpay.com/v1${path}`,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+Buffer.from(process.env.RAZORPAY_KEY_ID+':'+process.env.RAZORPAY_KEY_SECRET).toString('base64'),'Content-Type':'application/json',...(idempotency?{'X-Refund-Idempotency':idempotency}:{})},...(body?{body:JSON.stringify(body)}:{})})
  const data=await response.json();assert(response.ok,data.error?.description||'Payment provider unavailable.',502);return data
}
export async function daily(path,body) {
  assert(process.env.DAILY_API_KEY,'Configure DAILY_API_KEY to enable private video sessions.',503)
  const r=await fetch('https://api.daily.co/v1'+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.DAILY_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert(r.ok,'Video provider unavailable.',502);return d
}
export async function roomFor(booking) {
  const name='garbhika-'+booking.id
  if(booking.roomUrl)return {name,url:booking.roomUrl}
  let room
  try {room=await daily('/rooms',{name,privacy:'private',properties:{exp:Math.floor((+booking.endAt+3600000)/1000),enable_recording:false,max_participants:2,enable_prejoin_ui:true}})}
  catch(error) {if(error.status!==502)throw error;room=await daily('/rooms/'+name)}
  booking.roomUrl=room.url;booking.roomId=name;await booking.save();return room
}
