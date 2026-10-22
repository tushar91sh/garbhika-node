import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import {MongoMemoryReplSet} from 'mongodb-memory-server'
import {createApp} from '../src/app.js'
import User from '../src/models/User.js'
import Booking from '../src/models/Booking.js'
import * as M from '../src/care/models.js'
import {adherence} from '../src/care/enhancements.js'
import {decrypt} from '../src/care/security.js'
import {createBooking,availabilityFor} from '../src/care/booking.js'
let db,app,mother,expert,admin,owner,service
const token=u=>jwt.sign({sub:u.id,purpose:'access',version:0},process.env.JWT_SECRET,{expiresIn:'15m'})
const as=(u,method,path)=>request(app)[method]('/api'+path).set('Authorization','Bearer '+token(u))
const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10)
before(async()=>{
 process.env.NODE_ENV='development';process.env.CARE_MOCK_PAYMENTS='true';process.env.JWT_SECRET='integration-care-secret-32-characters-long'
 db=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},instanceOpts:[{args:['--nounixsocket']}],replSet:{count:1,storageEngine:'wiredTiger'}})
 await mongoose.connect(db.getUri());await Promise.all([User.init(),Booking.init(),...Object.values(M).filter(m=>m.init).map(m=>m.init())]);app=createApp()
 const make=(role,name)=>User.create({name,email:role+'@care.test',role,passwordHash:'unused',emailVerified:true,status:'active'})
 mother=await make('mother','Test Mother');expert=await make('expert','Test Expert');admin=await make('admin','Test Admin');owner=await make('superadmin','Test Owner')
 await M.Mother.create({user:mother.id,consents:{terms:true,privacy:true,shareMedical:true},credits:4,plan:'village'})
 await M.Expert.create({user:expert.id,accepting:true,verification:{status:'approved'},isCoach:true})
 service=await M.Service.create({expert:expert.id,type:'nutrition',title:'Nutrition session',durationMin:45,priceInr:1200})
 await M.Availability.create({expert:expert.id,weekly:Array.from({length:7},(_,dow)=>({dow,start:'08:00',end:'20:00'})),minNoticeH:0})
},{timeout:180000})
after(async()=>{await mongoose.disconnect();await db?.stop()})
test('concurrent bookings allow only one slot and one credit debit; held index remains unique',async()=>{
 const result=await Promise.allSettled([1,2].map(()=>createBooking(mother,{serviceId:service.id,mode:'instant',startAt:date+'T10:00:00+05:30',paymentKind:'credit'})))
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(result));assert.equal((await M.Mother.findOne({user:mother.id})).credits,3)
 const b=result.find(r=>r.status==='fulfilled').value;const clone=b.toObject();delete clone._id;clone.status='held';await assert.rejects(()=>Booking.create(clone),e=>e.code===11000)
})
test('members enter priced groups free and may leave and re-register',async()=>{
 const g=await M.Group.create({host:expert.id,title:'Member support',startAt:new Date(Date.now()+10*86400000),durationMin:60,capacity:2,priceInr:800,status:'live'})
 const r=await as(mother,'post','/groups/'+g.id+'/register').send({});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.registration.amount,0)
 assert.equal((await as(mother,'post','/groups/'+g.id+'/leave').send({})).status,200)
 assert.equal((await as(mother,'post','/groups/'+g.id+'/register').send({})).status,200)
})
test('live notes encrypt storage and deny mother/admin access',async()=>{
 const b=await Booking.findOne({mother:mother.id});assert.equal((await as(expert,'put','/bookings/'+b.id+'/live-notes').send({text:'Confidential draft'})).status,200)
 const raw=await M.LiveNote.findOne({booking:b.id}).select('+cipher');assert.ok(!raw.cipher.includes('Confidential'));assert.equal(decrypt(raw.cipher),'Confidential draft')
 for(const u of [mother,admin])assert.equal((await as(u,'get','/bookings/'+b.id+'/live-notes')).status,403)
 assert.equal((await as(expert,'get','/bookings/'+b.id+'/live-notes')).body.text,'Confidential draft')
})
test('note revisions retain history without exposing ciphertext on mother home',async()=>{
 const b=await Booking.findOne({mother:mother.id});b.status='completed';b.endAt=new Date();await b.save()
 const payload={summary:'Visible summary',recommendations:['Rest'],privateNotes:'Sensitive private note',status:'published'}
 assert.equal((await as(expert,'post','/bookings/'+b.id+'/note').send(payload)).status,200)
 const n=await M.Note.findOne({booking:b.id});assert.equal((await as(expert,'patch','/notes/'+n.id).send({...payload,summary:'Updated summary'})).status,200)
 const home=await as(mother,'get','/me/dashboard');assert.equal(home.status,200);assert.equal(home.body.latestNote.versions,undefined);assert.equal(home.body.latestNote.privateCipher,undefined)
 const detail=await as(expert,'get','/bookings/'+b.id+'/note');assert.equal(detail.body.note.privateNotes,payload.privateNotes)
})
test('adherence respects task dates, duplicate checks and optional tasks',()=>{
 const tasks=[{_id:'a',frequency:'daily',startAt:new Date('2026-10-20')},{_id:'b',frequency:'weekly'},{_id:'c',frequency:'as needed'}]
 const checks=[{task:'a',date:'2026-10-20'},{task:'a',date:'2026-10-20'},{task:'a',date:'2026-10-21'},{task:'b',date:'2026-10-21'}]
 assert.deepEqual(adherence(tasks,checks,new Date('2026-10-22T10:00:00Z')),{from:'2026-10-19',to:'2026-10-22',expected:4,completed:3,percent:75})
})
test('refund approval is audited, returns a credit once and rejects repeated decisions',async()=>{
 const b=await Booking.findOne({mother:mother.id});const r=await as(mother,'post','/bookings/'+b.id+'/refund-request').send({reason:'Technical failure'});assert.equal(r.status,201,JSON.stringify(r.body))
 assert.equal((await as(admin,'get','/admin/care/refund-requests')).body.items.length,1)
 const path='/admin/refund-requests/'+r.body.request._id+'/decision',payload={status:'approved',fraction:1,reason:'Verified technical issue'}
 const decision=await as(admin,'post',path).send(payload);assert.equal(decision.status,200,JSON.stringify(decision.body));assert.equal((await M.Mother.findOne({user:mother.id})).credits,4)
 assert.ok(await (await import('../src/models/AuditLog.js')).default.exists({action:'refund.approved'}));assert.equal((await as(admin,'post',path).send(payload)).status,409)
})
test('superadmin policies enforce roles and apply new availability defaults',async()=>{
 const payload={key:'bookingDefaults',value:{bufferMin:20,minNoticeH:6,windowDays:21,maxPerDay:5},reason:'Platform defaults'}
 assert.equal((await as(admin,'put','/admin/care/settings').send(payload)).status,403);assert.equal((await as(owner,'put','/admin/care/settings').send(payload)).status,200)
 const a=await availabilityFor(new mongoose.Types.ObjectId());assert.equal(a.bufferMin,20);assert.equal(a.minNoticeH,6)
 assert.equal((await as(owner,'put','/admin/care/settings').send({key:'defaultCommissionPct',value:'no'})).status,400)
})
test('extended client view maintains consent and access logs',async()=>{
 let d=await as(expert,'get','/expert/clients/'+mother.id);assert.equal(d.status,200);assert.ok(d.body.health);assert.ok(d.body.adherence)
 await M.Mother.updateOne({user:mother.id},{$set:{'consents.shareMedical':false}});d=await as(expert,'get','/expert/clients/'+mother.id);assert.equal(d.body.health,null)
 assert.equal((await as(admin,'get','/expert/clients/'+mother.id)).status,403);assert.ok(await M.AccessLog.exists({actor:expert.id,mother:mother.id,resource:'medical'}))
})
test('community reports enter moderation and decisions warn author with audit',async()=>{
 const p=await as(mother,'post','/community/posts').send({body:'Supportive community conversation'});assert.equal(p.status,201)
 const path='/community/posts/'+p.body.post._id+'/report';assert.equal((await as(mother,'post',path).send({reason:'Needs review'})).status,200)
 assert.equal((await as(admin,'get','/admin/care/community-reports')).body.items.length,1)
 assert.equal((await as(admin,'patch','/admin/community/posts/'+p.body.post._id).send({status:'removed',reason:'Moderation reviewed'})).status,200)
 assert.equal((await as(mother,'get','/community/posts')).body.items.length,0)
 assert.ok(await M.Notification.exists({user:mother.id,type:'community.moderated'}))
})
test('free welcome call is one per mother and consumes no credit',async()=>{
 await M.Mother.updateOne({user:mother.id},{$set:{coach:expert.id}})
 await M.Service.create({expert:expert.id,type:'guidance',title:'Welcome guidance',durationMin:30,priceInr:500})
 const status=await as(mother,'get','/me/welcome-call');assert.equal(status.body.available,true)
 const credits=(await M.Mother.findOne({user:mother.id})).credits
 const payload={startAt:date+'T15:00:00+05:30'}
 const r=await as(mother,'post','/me/welcome-call').send(payload);assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.booking.payment.amount,0);assert.equal(r.body.booking.status,'confirmed')
 assert.equal((await M.Mother.findOne({user:mother.id})).credits,credits)
 assert.equal((await as(mother,'post','/me/welcome-call').send(payload)).status,409)
})
test('individual credential review, expiry, replacement and role enforcement',async()=>{
 const doc=await M.Document.create({owner:expert.id,name:'Insurance.pdf',mime:'application/pdf',size:10})
 const submitted=await as(expert,'post','/expert/profile/credentials').send({documentId:doc.id,kind:'insurance',expiresOn:'2031-03-20'});assert.equal(submitted.status,201,JSON.stringify(submitted.body))
 const profile=await M.Expert.findOne({user:expert.id}),path='/admin/experts/'+profile.id+'/documents/'+doc.id
 assert.equal((await as(mother,'patch',path).send({status:'verified',reason:'Checked registration'})).status,403)
 assert.equal((await as(admin,'patch',path).send({status:'verified',reason:'Checked original and dates'})).status,200)
 assert.equal((await M.Expert.findById(profile.id)).verification.documents[0].status,'verified')
 assert.equal((await as(admin,'patch',path).send({status:'verified',expiresOn:'2000-01-01',reason:'Expired original'})).status,400)
})
test('custom care task saves weekday schedule and blocks unscheduled check-ins',async()=>{
 const dow=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})).getDay(),other=(dow+1)%7
 const added=await as(expert,'post','/clients/'+mother.id+'/tasks').send({title:'Scheduled movement',category:'Movement',frequency:'custom',schedule:{mode:'weekdays',weekdays:[other]}})
 assert.equal(added.status,201,JSON.stringify(added.body));const task=added.body.task
 assert.equal((await as(mother,'post','/tasks/'+task._id+'/check').send({completed:true})).status,400)
 assert.equal((await as(expert,'patch','/tasks/'+task._id).send({frequency:'custom',schedule:{mode:'weekdays',weekdays:[dow]}})).status,200)
 assert.equal((await as(mother,'post','/tasks/'+task._id+'/check').send({completed:true})).status,200)
 const plan=await as(mother,'get','/me/care-plan');assert.ok(plan.body.items.find(t=>t._id===task._id).scheduleLabel)
})
test('request-only experts can propose server-generated slots; duplicates and stolen requests are denied',async()=>{
 await M.Availability.updateOne({expert:expert.id},{$set:{allowInstant:false,allowRequests:true}})
 const b=await createBooking(mother,{serviceId:service.id,mode:'request',date,window:'morning',paymentKind:'credit'})
 const path='/expert/bookings/'+b.id+'/open-slots?date='+date+'&action=propose',r=await as(expert,'get',path)
 assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.body.items.length)
 assert.equal((await as(mother,'get',path)).status,403)
 const slot=r.body.items[0].startAt
 assert.equal((await as(expert,'post','/bookings/'+b.id+'/propose').send({slots:[slot,slot]})).status,400)
 assert.equal((await as(expert,'post','/bookings/'+b.id+'/propose').send({slots:[slot]})).status,200)
 await M.Availability.updateOne({expert:expert.id},{$set:{allowInstant:true}})
})
test('all 22 interface-language preferences persist and reject arbitrary values',async()=>{
 for(const language of ['as','bn','brx','doi','gu','hi','kn','ks','kok','mai','ml','mni','mr','ne','or','pa','sa','sat','sd','ta','te','ur'])assert.equal((await as(mother,'patch','/me/interface-language').send({language})).status,200)
 assert.equal((await as(mother,'patch','/me/interface-language').send({language:'anything'})).status,400)
 const me=await as(mother,'get','/auth/me');assert.equal(me.body.user.interfaceLanguage,'ur')
})
test('document reminders are deduplicated at 30/7 days and expiry pauses new bookings',async()=>{
 const {processCredentialReminders}=await import('../src/care/credentials.js'),{alert}=await import('../src/care/booking.js')
 const u=await User.create({name:'Renewal Test Expert',email:'renewal@care.test',role:'expert',emailVerified:true,status:'active',passwordHash:'unused'})
 const docId=new mongoose.Types.ObjectId().toString(),documents=['identity','degree','registration','insurance'].map(kind=>({kind,documentId:kind==='insurance'?docId:new mongoose.Types.ObjectId().toString(),status:'verified',expiresOn:kind==='insurance'?'2030-03-30':kind==='registration'?'2031-03-30':null}))
 const e=await M.Expert.create({user:u.id,accepting:true,verification:{status:'approved',documentPolicyVersion:2,documents}})
 const run=now=>processCredentialReminders({now:Date.parse(now),Expert:M.Expert,User,alert})
 await run('2030-03-01T12:00:00Z');await run('2030-03-01T12:00:00Z')
 assert.equal(await M.Notification.countDocuments({user:u.id,'payload.documentId':docId,type:'credential.expiring'}),1)
 await run('2030-03-24T12:00:00Z');assert.equal(await M.Notification.countDocuments({user:u.id,'payload.documentId':docId,type:'credential.expiring'}),2)
 await run('2030-03-31T12:00:00Z');const paused=await M.Expert.findById(e.id);assert.equal(paused.accepting,false);assert.equal(paused.verification.autoPaused,true)
 assert.ok(await M.Notification.exists({user:admin.id,'payload.documentId':docId,type:'credential.review'}))
})

test('expert application stays draft until all documents are submitted, then supports correction and approval',async()=>{
 const payload={name:'Application Expert',email:'application@care.test',password:'TestPass123!',headline:'Nutrition specialist',registration:'REG-123',city:'Noida',yearsExp:3,languages:['Hindi'],acceptTerms:true}
 const created=await request(app).post('/api/expert/apply').send(payload);assert.equal(created.status,201,JSON.stringify(created.body))
 const user=await User.findOne({email:payload.email}),profile=await M.Expert.findOne({user:user.id})
 assert.equal(profile.verification.status,'draft')
 assert.equal((await as(admin,'get','/admin/care/experts')).body.items.some(x=>x._id===profile.id),false)
 assert.equal(await M.Notification.countDocuments({type:'expert.applied','payload.expertId':profile.id}),0)
 const login=await request(app).post('/api/auth/login').send({email:payload.email,password:payload.password});assert.equal(login.status,200,JSON.stringify(login.body))
 const submit=()=>as(user,'post','/expert/profile/application/submit').send({})
 assert.equal((await submit()).status,400)
 const approval={status:'approved',checks:[true,true,true,true,true]}
 assert.equal((await as(admin,'patch','/admin/experts/'+profile.id+'/verification').send(approval)).status,400)
 const ids={}
 for(const kind of ['identity','degree','registration','insurance']){
  const file=await as(user,'post','/care/documents').send({name:kind+'.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nTest credential').toString('base64')});assert.equal(file.status,201,JSON.stringify(file.body));ids[kind]=file.body.document._id
  const data={documentId:ids[kind],kind,...(['registration','insurance'].includes(kind)?{expiresOn:'2032-12-31'}:{})}
  if(kind==='insurance')assert.equal((await as(user,'post','/expert/profile/credentials').send({...data,expiresOn:null})).status,400)
  assert.equal((await as(user,'post','/expert/profile/credentials').send(data)).status,201)
 }
 assert.equal((await submit()).status,200)
 assert.equal((await as(admin,'get','/admin/care/experts')).body.items.some(x=>x._id===profile.id),true)
 await submit();assert.equal(await M.Notification.countDocuments({user:admin.id,type:'expert.applied','payload.expertId':profile.id}),1)
 assert.equal((await as(admin,'patch','/admin/experts/'+profile.id+'/verification').send(approval)).status,400)
 const review=(kind,status='verified')=>as(admin,'patch','/admin/experts/'+profile.id+'/documents/'+ids[kind]).send({kind,status,expiresOn:['registration','insurance'].includes(kind)?'2032-12-31':null,reason:status==='rejected'?'Please upload a readable certificate':'Document checked'})
 for(const kind of ['identity','degree','registration'])assert.equal((await review(kind)).status,200)
 assert.equal((await review('insurance','rejected')).status,200)
 assert.equal((await as(admin,'patch','/admin/experts/'+profile.id+'/verification').send({status:'more_info',checks:[true,true,true,true,false],reason:'Replace unreadable insurance'})).status,200)
 const state=await as(user,'get','/expert/profile/application');assert.equal(state.body.reason,'Replace unreadable insurance');assert.equal(state.body.checklist.find(x=>x.kind==='insurance').status,'rejected');assert.equal((await submit()).status,400)
 const replacement=await as(user,'post','/care/documents').send({name:'new-insurance.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nReplacement').toString('base64')});ids.insurance=replacement.body.document._id
 assert.equal((await as(mother,'post','/expert/profile/credentials').send({documentId:ids.insurance,kind:'identity'})).status,403)
 assert.equal((await as(user,'post','/expert/profile/credentials').send({documentId:ids.insurance,kind:'insurance',expiresOn:'2032-12-31'})).status,201)
 assert.equal((await submit()).status,200);assert.equal((await review('insurance')).status,200)
 assert.equal((await as(admin,'patch','/admin/experts/'+profile.id+'/verification').send(approval)).status,200)
 assert.equal((await User.findById(user.id)).status,'active')
 assert.equal((await M.Expert.findById(profile.id)).verification.documents.length,5)
})

test('submitted applications return to draft on replacement and reject expired credentials',async()=>{
 const u=await User.create({name:'Draft correction',email:'draft-correction@care.test',role:'expert',status:'pending',passwordHash:'unused'})
 const p=await M.Expert.create({user:u.id,headline:'Coach',city:'Noida',languages:['Hindi'],registration:'R123',verification:{status:'pending',documentPolicyVersion:2,submittedAt:new Date()}})
 const doc=await M.Document.create({owner:u.id,name:'expired.pdf',mime:'application/pdf',size:10})
 assert.equal((await as(u,'post','/expert/profile/credentials').send({documentId:doc.id,kind:'registration',expiresOn:'2020-01-01'})).status,201)
 assert.equal((await M.Expert.findById(p.id)).verification.status,'draft')
 const state=await as(u,'get','/expert/profile/application');assert.equal(state.body.checklist.find(x=>x.kind==='registration').status,'expired')
 assert.equal((await as(u,'post','/expert/profile/application/submit').send({})).status,400)
 assert.equal((await as(mother,'get','/expert/profile/application')).status,403)
})
