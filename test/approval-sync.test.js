import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { bookingReadiness } from '../src/care/bookability.js'
import { createApp } from '../src/app.js'
import User from '../src/models/User.js'
import AuditLog from '../src/models/AuditLog.js'
import { Expert, Service, Availability, Notification, Job } from '../src/care/models.js'
const profile=()=>({verification:{status:'approved',documentPolicyVersion:2,documents:['identity','degree','registration','insurance'].map(kind=>({kind,status:'verified',expiresOn:'2099-12-31'}))},accepting:true})
const service={title:'Prenatal consultation',active:true,durationMin:45,priceInr:1200}
const hours={weekly:[{dow:1,start:'09:00',end:'17:00'}],allowInstant:true,allowRequests:true}
test('booking readiness checks credentials, approval, account, services, hours, modes and accepting',()=>{
 const ready=(p=profile(),u={status:'active'},ss=[service],a=hours)=>bookingReadiness(p,u,ss,a)
 assert.equal(ready().listed,true)
 for(const status of ['draft','pending','rejected','more_info']){const p=profile();p.verification.status=status;assert.equal(ready(p).listed,false)}
 for(const status of ['pending','suspended'])assert.equal(ready(profile(),{status}).listed,false)
 assert.equal(ready(profile(),{status:'active'},[]).listed,false)
 assert.equal(ready(profile(),{status:'active'},[{...service,active:false}]).listed,false)
 assert.equal(ready(profile(),{status:'active'},[service],{...hours,weekly:[]}).listed,false)
 assert.equal(ready(profile(),{status:'active'},[service],{...hours,allowInstant:false,allowRequests:false}).listed,false)
 assert.equal(ready({...profile(),accepting:false}).listed,false)
 const expired=profile();expired.verification.documents[2].expiresOn='2000-01-01';assert.equal(ready(expired).listed,false)
 const requestOnly=ready(profile(),{status:'active'},[service],{...hours,allowInstant:false})
 assert.equal(requestOnly.listed,true);assert.deepEqual(requestOnly.modes,{instant:false,request:true})
})
test('approval reaches expert existing session; customer visibility follows service setup and pause',async t=>{
 process.env.JWT_SECRET='approval-sync-test-key-at-least-32-characters'
 const admin={id:'100000000000000000000001',role:'admin',status:'active',tokenVersion:0}
 const expert={id:'100000000000000000000002',_id:'100000000000000000000002',name:'Test Expert',email:'expert@example.test',role:'expert',status:'pending',emailVerified:false,tokenVersion:0,profile:{}}
 const e={...profile(),id:'200000000000000000000001',_id:'200000000000000000000001',user:expert.id,headline:'Prenatal expert',bank:{account:'private'},registration:'private'}
 e.verification.status='pending';e.verification.checks=[false,false,false,false,false]
 e.verification.toObject=function(){return {...this}};e.toObject=()=>({...e});e.save=async()=>e
 let services=[]
 t.mock.method(User,'find',()=>({distinct:async()=>[expert.id]}))
 t.mock.method(User,'findById',async id=>String(id)===admin.id?admin:expert)
 t.mock.method(User,'updateOne',async(_q,change)=>{Object.assign(expert,change.$set);return {modifiedCount:1}})
 t.mock.method(Expert,'findById',async()=>e);t.mock.method(Expert,'findOne',async()=>e)
 t.mock.method(Expert,'find',()=>({populate:()=>({lean:async()=>[{...e,user:expert}]})}))
 const query=data=>({then:(ok,bad)=>Promise.resolve(data).then(ok,bad),lean:async()=>data})
 t.mock.method(Service,'find',()=>query(services));t.mock.method(Availability,'findOne',()=>query({...hours,allowInstant:false}))
 t.mock.method(AuditLog,'create',async()=>({}));t.mock.method(Notification,'create',async()=>({id:'notice'}));t.mock.method(Job,'updateOne',async()=>({}))
 const token=u=>jwt.sign({sub:u.id,purpose:'access',version:0},process.env.JWT_SECRET)
 const app=createApp(),expertToken=token(expert),get=path=>request(app).get('/api'+path).set('Authorization','Bearer '+expertToken)
 assert.equal((await get('/expert/profile/booking-readiness')).body.approved,false)
 const approval=await request(app).patch('/api/admin/experts/'+e.id+'/verification').set('Authorization','Bearer '+token(admin)).send({status:'approved',checks:[true,true,true,true,true]})
 assert.equal(approval.status,200,JSON.stringify(approval.body));assert.equal(expert.status,'active')
 const me=await get('/auth/me');assert.equal(me.status,200);assert.equal(me.body.user.status,'active')
 // Session reads must not consume the 30-attempt login/OTP quota.
 for(let i=0;i<31;i++)assert.equal((await get('/auth/me')).status,200)
 assert.equal((await get('/expert/profile')).body.profile.verification.status,'approved')
 let ready=await get('/expert/profile/booking-readiness');assert.equal(ready.body.approved,true);assert.equal(ready.body.listed,false)
 assert.equal((await request(app).get('/api/experts')).body.items.length,0)
 services=[{...service,_id:'300000000000000000000001',expert:expert.id}]
 ready=await get('/expert/profile/booking-readiness');assert.equal(ready.body.listed,true)
 const directory=await request(app).get('/api/experts');assert.equal(directory.body.items.length,1)
 assert.equal(directory.body.items[0].bank,undefined);assert.equal(directory.body.items[0].registration,undefined)
 assert.deepEqual(directory.body.items[0].bookingModes,{instant:false,request:true})
 e.accepting=false;assert.equal((await request(app).get('/api/experts')).body.items.length,0)
})
