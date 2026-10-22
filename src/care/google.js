import { Router } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { Expert,Availability } from './models.js'
import { requireAuth,requireRole } from '../middleware/auth.js'
import { encrypt,decrypt } from './security.js'
import { assert } from '../utils/validation.js'
const router=Router(),cache=new Map()
async function token(body){const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET})});const data=await response.json();assert(response.ok,'Google Calendar authorization failed. Reconnect your calendar.',502);return data}
router.get('/expert/google/status',requireAuth,requireRole('expert'),async(req,res)=>{const e=await Expert.findOne({user:req.user.id}).select('+googleCipher');res.json({connected:!!e?.googleCipher})})
router.get('/expert/google/connect',requireAuth,requireRole('expert'),async(req,res)=>{
 assert(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REDIRECT_URI,'Configure Google OAuth client and redirect URI.',503)
 const state=jwt.sign({sub:req.user.id,purpose:'google-calendar',version:req.user.tokenVersion||0},process.env.JWT_SECRET,{expiresIn:'10m'})
 const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:process.env.GOOGLE_REDIRECT_URI,response_type:'code',scope:'https://www.googleapis.com/auth/calendar.readonly',access_type:'offline',prompt:'consent',state})
 res.json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+q})
})
router.get('/expert/google/callback',async(req,res)=>{
 let state;try{state=jwt.verify(req.query.state,process.env.JWT_SECRET)}catch{assert(false,'Calendar connection expired.',401)}
 assert(state.purpose==='google-calendar','Invalid OAuth state.',401)
 const user=await User.findById(state.sub);assert(user&&user.role==='expert'&&user.status==='active'&&user.tokenVersion===state.version,'Expert session changed. Start again.',403)
 assert(typeof req.query.code==='string','Calendar access was not granted.')
 const data=await token({grant_type:'authorization_code',code:req.query.code,redirect_uri:process.env.GOOGLE_REDIRECT_URI});assert(data.refresh_token,'A refresh token is required. Reconnect and grant access.')
 await Expert.updateOne({user:user.id},{$set:{googleCipher:encrypt({refreshToken:data.refresh_token,accessToken:data.access_token,expiresAt:Date.now()+data.expires_in*1000})}})
 cache.clear();res.redirect((process.env.CLIENT_URL||'http://localhost:5173').split(',')[0]+'/expert/calendar?calendar=connected')
})
router.post('/expert/google/disconnect',requireAuth,requireRole('expert'),async(req,res)=>{await Expert.updateOne({user:req.user.id},{$unset:{googleCipher:1}});cache.clear();res.json({ok:true})})
export async function googleBusy(expertId,date){
 const cacheKey=String(expertId)+':'+date,previous=cache.get(cacheKey);if(previous&&previous.expiresAt>Date.now())return previous.items
 const e=await Expert.findOne({user:expertId}).select('+googleCipher');if(!e?.googleCipher){cache.set(cacheKey,{expiresAt:Date.now()+30000,items:[]});return []}
 const credentials=decrypt(e.googleCipher)
 if(credentials.expiresAt<Date.now()+60000){const data=await token({grant_type:'refresh_token',refresh_token:credentials.refreshToken});credentials.accessToken=data.access_token;credentials.expiresAt=Date.now()+data.expires_in*1000}
 const from=new Date(date+'T00:00:00+05:30'),to=new Date(+from+86400000)
 const r=await fetch('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+credentials.accessToken,'Content-Type':'application/json'},body:JSON.stringify({timeMin:from.toISOString(),timeMax:to.toISOString(),items:[{id:'primary'}]})});const data=await r.json();assert(r.ok&&!data.calendars?.primary?.errors,'Could not verify Google Calendar availability. Retry or reconnect the calendar.',503)
 const items=data.calendars?.primary?.busy||[];cache.set(cacheKey,{expiresAt:Date.now()+30000,items});if(cache.size>500)cache.delete(cache.keys().next().value);return items
}
export default router
