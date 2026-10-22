import {Router} from 'express'
import mongoose from 'mongoose'
import {requireAuth,requireRole} from '../middleware/auth.js'
import {assert,clean} from '../utils/validation.js'
import {Expert,Document,Task,TaskCheck,CareTemplate} from './models.js'
import Booking from '../models/Booking.js'
import AuditLog from '../models/AuditLog.js'
import User from '../models/User.js'
import {credentialBlock,validateCredentialInput,documentExpiry,requiredCredentials} from './credentials.js'
import {normalizeSchedule,scheduledOn,scheduleDates,scheduleLabel} from './schedules.js'
import {slotsFor,alert} from './booking.js'
import {DAY,istDate,validDate} from './policy.js'
const router=Router(),expert=[requireAuth,requireRole('expert')],mother=[requireAuth,requireRole('mother')],admin=[requireAuth,requireRole('admin','superadmin')]
const id=x=>{assert(mongoose.isValidObjectId(x),'Invalid identifier.');return x}
async function client(req,motherId){assert(await Booking.exists({expert:req.user.id,mother:id(motherId),status:{$in:['confirmed','in_progress','completed']}}),'An eligible client booking is required.',403)}
async function audit(req,action,target,before,after,reason){await AuditLog.create({actor:req.user.id,actorEmail:req.user.email,action,resource:'care',resourceId:String(target),details:{before,after,reason}})}
router.post('/expert/profile/credentials',...expert,async(req,res)=>{
 const input=req.body,fields=validateCredentialInput(input),documentId=id(input.documentId)
 const document=await Document.findOne({_id:documentId,owner:req.user.id});assert(document,'Upload a document owned by your account.',403)
 const e=await Expert.findOne({user:req.user.id});assert(e,'Expert profile not found.',404)
 assert(!(e.verification.documents||[]).some(d=>String(d.documentId)===String(documentId)),'This document is already submitted.',409)
 const before=e.verification.toObject()
 e.verification.documents.push({documentId:String(documentId),name:document.name,...fields,status:'pending',submittedAt:new Date()})
 // Legacy approvals keep their original approval rules until an administrator explicitly adopts per-document verification.
 if(e.verification.status!=='approved')e.verification.documentPolicyVersion=2
 if(e.verification.status==='pending'&&e.verification.submittedAt)e.verification.status='draft'
 e.markModified('verification.documents');await e.save()
 await audit(req,'credential.submitted',e.id,{documentCount:before.documents?.length||0},{kind:fields.kind,documentId},'Document submitted for verification')
 res.status(201).json({profile:e})
})
router.patch('/admin/experts/:id/documents/:documentId',...admin,async(req,res)=>{
 const e=await Expert.findById(id(req.params.id));assert(e,'Expert not found.',404)
 const index=(e.verification.documents||[]).findIndex(d=>String(d.documentId)===req.params.documentId);assert(index>=0,'Document not found.',404)
 const before={...e.verification.documents[index]},input=req.body
 assert(['verified','rejected'].includes(input.status)&&clean(input.reason).length>=3,'Choose verified/rejected and enter a reason.')
 const fields=validateCredentialInput({kind:input.kind||before.kind,expiresOn:input.expiresOn===undefined?before.expiresOn:input.expiresOn})
 if(input.status==='verified')assert(!fields.expiresOn||documentExpiry(fields)>=Date.now(),'An expired document cannot be verified.')
 e.verification.documents[index]={...before,...fields,status:input.status,reviewReason:clean(input.reason).slice(0,1000),verifiedBy:req.user.id,verifiedAt:new Date()}
 e.markModified('verification.documents')
 // Adopt the strict policy when all four document categories have individually verified records.
 if(requiredCredentials.every(kind=>e.verification.documents.some(d=>d.kind===kind&&d.status==='verified')))e.verification.documentPolicyVersion=2
 if(credentialBlock(e)){e.accepting=false;e.verification.autoPaused=true}
 // Re-approval clears the automatic pause, but never silently changes the expert's manual accepting/paused setting.
 if(!credentialBlock(e))e.verification.autoPaused=false
 await e.save();await audit(req,'credential.'+input.status,e.id,before,e.verification.documents[index],input.reason)
 await alert(e.user,'credential.reviewed','Document review updated',`${fields.kind}: ${input.status}. ${clean(input.reason)}`,{documentId:req.params.documentId})
 res.json({profile:e})
})
router.get('/expert/bookings/:id/open-slots',...expert,async(req,res)=>{
 const b=await Booking.findOne({_id:id(req.params.id),expert:req.user.id,status:{$in:['requested','proposed']}});assert(b&&+b.request?.expiresAt>Date.now(),'Open booking request not found.',404)
 const mode=req.query.action||'propose',date=req.query.date
 assert(['accept','propose'].includes(mode)&&validDate(date),'Choose an action and valid date.')
 let items=await slotsFor(b.expert,b.service,date,date,{forRequest:true})
 if(mode==='accept'){const ranges={morning:[8,12],afternoon:[12,16],evening:[16,20]},range=ranges[b.request.window];items=date===b.request.date?items.filter(s=>{const hour=new Date(+new Date(s.startAt)+330*60000).getUTCHours();return range&&hour>=range[0]&&hour<range[1]}):[]}
 res.json({items,timezone:'Asia/Kolkata',request:{date:b.request.date,window:b.request.window},maxSelection:mode==='accept'?1:3})
})
router.post('/clients/:id/tasks',...expert,async(req,res)=>{
 await client(req,req.params.id);const input=req.body
 assert(clean(input.title).length>0&&['Nutrition','Movement','Mind'].includes(input.category),'Enter a task title and category.')
 const task=await Task.create({mother:req.params.id,expert:req.user.id,title:clean(input.title).slice(0,300),category:input.category,...normalizeSchedule(input),...scheduleDates(input)})
 await alert(req.params.id,'plan.updated','Care plan updated','Your expert assigned a task.');res.status(201).json({task})
})
router.patch('/tasks/:id',...expert,async(req,res)=>{
 const t=await Task.findOne({_id:id(req.params.id),expert:req.user.id});assert(t,'You can edit only your own tasks.',403);await client(req,t.mother)
 const input=req.body,fields={...normalizeSchedule(input,t.toObject()),...scheduleDates(input,t.toObject())}
 if(input.title!==undefined){assert(clean(input.title),'Task title is required.');fields.title=clean(input.title).slice(0,300)}
 if(input.category!==undefined){assert(['Nutrition','Movement','Mind'].includes(input.category),'Invalid category.');fields.category=input.category}
 Object.assign(t,fields);await t.save();await alert(t.mother,'plan.updated','Care plan updated','Your expert updated a task.');res.json({task:t})
})
router.post('/tasks/:id/check',...mother,async(req,res)=>{
 const t=await Task.findOne({_id:id(req.params.id),mother:req.user.id});assert(t,'Task not found.',404)
 const date=istDate();assert(scheduledOn(t,date),'This task is not scheduled for today.')
 if(req.body.completed===false)await TaskCheck.deleteOne({task:t.id,mother:req.user.id,date});else await TaskCheck.updateOne({task:t.id,date},{$setOnInsert:{mother:req.user.id}},{upsert:true})
 res.json({ok:true})
})
router.post('/clients/:id/tasks/from-template',...expert,async(req,res)=>{
 await client(req,req.params.id);const t=await CareTemplate.findById(id(req.body.templateId));assert(t,'Template not found.',404)
 const task=await Task.create({mother:req.params.id,expert:req.user.id,title:t.title,category:t.category,templateId:t.id,...normalizeSchedule({},t.toObject()),...scheduleDates(req.body)})
 await alert(req.params.id,'plan.updated','Care plan updated','Your expert assigned a template task.');res.status(201).json({task})
})
router.post('/admin/care/templates',...admin,async(req,res)=>{
 const input=req.body;assert(clean(input.title)&&['Nutrition','Movement','Mind'].includes(input.category),'Enter a title and category.')
 const template=await CareTemplate.create({title:clean(input.title).slice(0,300),category:input.category,...normalizeSchedule(input)})
 await audit(req,'template.created',template.id,null,{title:template.title},'Care template added');res.status(201).json({template})
})
router.patch('/me/interface-language',requireAuth,async(req,res)=>{
 const codes=['en','as','bn','brx','doi','gu','hi','kn','ks','kok','mai','ml','mni','mr','ne','or','pa','sa','sat','sd','ta','te','ur']
 assert(codes.includes(req.body.language),'Unsupported interface language.')
 await User.updateOne({_id:req.user.id},{$set:{interfaceLanguage:req.body.language}});res.json({language:req.body.language})
})
export default router
