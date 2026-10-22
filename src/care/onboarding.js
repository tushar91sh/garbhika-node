import {Router} from 'express'
import rateLimit from 'express-rate-limit'
import {requireAuth,requireRole} from '../middleware/auth.js'
import {assert,clean} from '../utils/validation.js'
import User from '../models/User.js'
import AuditLog from '../models/AuditLog.js'
import {Expert} from './models.js'
import {requiredCredentials,documentExpiry} from './credentials.js'
import {alert} from './booking.js'

export function applicationChecklist(profile,now=Date.now()) {
 const documents=profile.verification?.documents||[]
 return requiredCredentials.map(kind=>{
  const doc=documents.filter(d=>d.kind===kind).at(-1)
  const expiry=doc&&documentExpiry(doc)
  const missing=!doc, rejected=doc?.status==='rejected'
  const invalidExpiry=!!doc&&(['registration','insurance'].includes(kind)&&expiry===null||expiry!==null&&(!Number.isFinite(expiry)||expiry<now))
  return {kind,ready:!missing&&!rejected&&!invalidExpiry,documentId:doc?.documentId,name:doc?.name,expiresOn:doc?.expiresOn,status:missing?'missing':invalidExpiry?'expired':doc.status||'pending',reason:doc?.reviewReason||''}
 })
}
const router=Router(),expert=[requireAuth,requireRole('expert')]
// Account creation is rate limited separately from normal page/API requests.
router.post('/expert/apply',rateLimit({windowMs:15*60*1000,limit:15}),(_req,_res,next)=>next())
router.get('/expert/profile/application',...expert,async(req,res)=>{
 const profile=await Expert.findOne({user:req.user.id});assert(profile,'Expert profile not found.',404)
 res.json({status:profile.verification.status,reason:profile.verification.reason,submittedAt:profile.verification.submittedAt,checklist:applicationChecklist(profile)})
})
router.post('/expert/profile/application/submit',...expert,async(req,res)=>{
 const profile=await Expert.findOne({user:req.user.id});assert(profile,'Expert profile not found.',404)
 assert(profile.verification.status!=='approved','Your application is already approved.',409)
 const checks=applicationChecklist(profile),missing=checks.filter(x=>!x.ready)
 assert(!missing.length,'Complete these documents before submitting: '+missing.map(x=>x.kind+' ('+x.status+')').join(', '))
 assert(clean(profile.headline)&&clean(profile.city)&&profile.languages?.length&&clean(profile.registration),'Complete your professional details before submitting.')
 if(profile.verification.submittedAt&&profile.verification.status==='pending')return res.json({profile,message:'Your application is already pending admin review.'})
 const updated=await Expert.findOneAndUpdate({_id:profile.id,updatedAt:profile.updatedAt,'verification.status':{$ne:'approved'}},{$set:{'verification.status':'pending','verification.submittedAt':new Date(),'verification.documentPolicyVersion':2,'verification.checks':[false,false,false,false,false],accepting:false}},{new:true})
 assert(updated,'Application changed. Refresh and try again.',409)
 await AuditLog.create({actor:req.user.id,actorEmail:req.user.email,action:'expert.application.submitted',resource:'care',resourceId:profile.id,details:{resubmission:!!profile.verification.submittedAt}})
 for(const a of await User.find({role:{$in:['admin','superadmin']},status:'active'}))await alert(a.id,'expert.applied','Expert application ready for review',req.user.name,{expertId:profile.id})
 res.json({profile:updated,message:'Application submitted. Pending admin review.'})
})
export default router
