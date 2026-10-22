import Booking from '../models/Booking.js'
import { Mother,AccessLog,Journal,Note } from './models.js'
import { canSeeHealth } from './policy.js'
import { decrypt } from './security.js'
import { assert } from '../utils/validation.js'
export async function healthAccess(actor,motherId) {
 const m=await Mother.findOne({user:motherId}).select('+medicalCipher');assert(m,'Mother profile not found.',404)
 const hasBooking=actor.role==='expert'&&await Booking.exists({expert:actor.id,mother:motherId,status:{$in:['confirmed','in_progress','completed']}})
 assert(canSeeHealth({actor,mother:m,hasBooking:!!hasBooking}),'Medical sharing consent and an eligible booking are required.',403)
 return m
}
export async function sharedHealth(actor,motherId) {
 const m=await healthAccess(actor,motherId)
 await AccessLog.create({actor:actor.id,mother:motherId,resource:'medical'})
 const journals=await Journal.find({mother:motherId,...(actor.id!==String(motherId)?{shared:true}:{})}).select('+noteCipher').sort({date:-1}).limit(7)
 await AccessLog.create({actor:actor.id,mother:motherId,resource:'journal'})
 return {medical:decrypt(m.medicalCipher,{}),journal:journals.map(j=>({...j.toObject(),note:decrypt(j.noteCipher,''),noteCipher:undefined}))}
}
export async function notesFor(actor,motherId) {
 const own=actor.id===String(motherId)
 if(!own)assert(actor.role==='expert'&&await Booking.exists({expert:actor.id,mother:motherId,status:{$in:['confirmed','in_progress','completed']}}),'No eligible booking with this mother.',403)
 const notes=await Note.find({mother:motherId,...(own?{status:'published'}:{})}).select(own?'':' +privateCipher').sort({createdAt:-1}).limit(100)
 await AccessLog.create({actor:actor.id,mother:motherId,resource:'note'})
 return notes.map(n=>({...n.toObject(),privateNotes:own?undefined:decrypt(n.privateCipher,''),privateCipher:undefined,versions:undefined}))
}
