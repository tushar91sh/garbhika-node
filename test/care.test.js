import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createHmac,randomBytes } from 'node:crypto'
import { createApp } from '../src/app.js'
import { canSeeHealth,cancellationPolicy,pregnancy,payoutFor,HOUR,DAY,validDate } from '../src/care/policy.js'
import { encrypt,decrypt,encryptBuffer,decryptBuffer,validSignature } from '../src/care/security.js'
import { paymentMock } from '../src/care/integrations.js'
import { requireRole } from '../src/middleware/auth.js'
import { Service,Mother } from '../src/care/models.js'
import Booking from '../src/models/Booking.js'
process.env.JWT_SECRET='care-test-secret-longer-than-32-characters'
process.env.NODE_ENV='test'
const app=createApp()
test('private care APIs reject anonymous access before database work',async()=>{
 for(const path of ['/api/me/dashboard','/api/me/care-profile','/api/me/journal','/api/me/care-plan','/api/threads','/api/expert/availability','/api/expert/clients','/api/admin/care/overview','/api/admin/care/users','/api/admin/care/settings','/api/care/bookings'])assert.equal((await request(app).get(path)).status,401,path)
})
test('malformed expert application is rejected before database work',async()=>{assert.equal((await request(app).post('/api/expert/apply').send({name:'A',email:'bad',password:'short',role:'superadmin'})).status,400)})
test('health reads require booking, profile consent and journal-entry sharing; admins denied',()=>{
 const mother={user:'mother',consents:{shareMedical:true}}
 for(const role of ['admin','superadmin'])assert.equal(canSeeHealth({actor:{id:'staff',role},mother,hasBooking:true}),false)
 assert.equal(canSeeHealth({actor:{id:'mother',role:'mother'},mother,hasBooking:false}),true)
 assert.equal(canSeeHealth({actor:{id:'expert',role:'expert'},mother,hasBooking:true}),true)
 assert.equal(canSeeHealth({actor:{id:'expert',role:'expert'},mother,hasBooking:false}),false)
 assert.equal(canSeeHealth({actor:{id:'expert',role:'expert'},mother:{...mother,consents:{shareMedical:false}},hasBooking:true}),false)
 assert.equal(canSeeHealth({actor:{id:'expert',role:'expert'},mother,hasBooking:true,shared:false}),false)
})
test('cancellation exact 12-hour boundary, late cancellation and expert goodwill',()=>{
 const now=Date.now(),b={status:'confirmed',startAt:new Date(now+12*HOUR)}
 assert.equal(cancellationPolicy(b,'mother',now).fraction,1)
 assert.equal(cancellationPolicy({...b,startAt:new Date(now+12*HOUR-1)},'mother',now).fraction,.5)
 assert.deepEqual(cancellationPolicy(b,'expert',now),{fraction:1,goodwill:200})
 assert.equal(cancellationPolicy({...b,status:'requested'},'mother',now).fraction,1)
})
test('AES-GCM health encryption round trip and authenticated tamper detection',()=>{
 const value={allergies:'Penicillin',note:'private'},cipher=encrypt(value)
 assert.ok(!cipher.includes('Penicillin'));assert.deepEqual(decrypt(cipher),value)
 const parts=cipher.split('.'),data=Buffer.from(parts[2],'base64');data[0]^=1;parts[2]=data.toString('base64');assert.throws(()=>decrypt(parts.join('.')))
})
test('10 MB binary attachments remain below the MongoDB document limit',()=>{const data=randomBytes(10*1024*1024),cipher=encryptBuffer(data);assert.equal(cipher.length,data.length+28);assert.deepEqual(decryptBuffer(cipher),data)})
test('payment webhook signatures bind exact raw bytes',()=>{
 const body=Buffer.from('{"event":"payment.captured"}'),secret='webhook-test',signature=createHmac('sha256',secret).update(body).digest('hex')
 assert.equal(validSignature(body,signature,secret),true);assert.equal(validSignature(Buffer.from('{}'),signature,secret),false);assert.equal(validSignature(body,'bad',secret),false);assert.equal(validSignature(body,undefined,secret),false)
})
test('forged payment/video webhooks never reach database handlers',async()=>{for(const path of ['/api/webhooks/razorpay','/api/webhooks/video'])assert.equal((await request(app).post(path).send({event:'payment.captured'})).status,401)})
test('mock payments cannot be enabled in production, staging or test',()=>{
 const prior={mode:process.env.NODE_ENV,mock:process.env.CARE_MOCK_PAYMENTS};process.env.CARE_MOCK_PAYMENTS='true'
 for(const mode of ['production','staging','test','']){process.env.NODE_ENV=mode;assert.equal(paymentMock(),false)}
 process.env.NODE_ENV='development';assert.equal(paymentMock(),true)
 process.env.NODE_ENV=prior.mode;if(prior.mock===undefined)delete process.env.CARE_MOCK_PAYMENTS;else process.env.CARE_MOCK_PAYMENTS=prior.mock
})
test('pending experts only access verification; legacy users retain mother permissions',()=>{
 const check=(user,path,roles)=>{let status=200,next=false;requireRole(...roles)({user,path},{status:n=>({json:()=>{status=n}})},()=>{next=true});return {status,next}}
 assert.equal(check({role:'expert',status:'pending'},'/expert/profile',['expert']).next,true)
 assert.equal(check({role:'expert',status:'pending'},'/expert/clients',['expert']).status,403)
 assert.equal(check({role:'mother',status:'active'},'/expert/clients',['expert']).status,403)
 assert.equal(check({role:'user',status:'active'},'/me/dashboard',['mother']).next,true)
})
test('models reject out-of-range prices, negative credits and accept unique request slots',()=>{
 const expert='000000000000000000000001'
 assert.ok(new Service({expert,type:'nutrition',durationMin:45,priceInr:499}).validateSync())
 assert.ok(new Service({expert,type:'nutrition',durationMin:45,priceInr:3001}).validateSync())
 assert.ok(new Mother({user:expert,credits:-1}).validateSync())
 assert.equal(new Booking({name:'Test',email:'t@e.com',preferredDate:new Date(),dateKey:'2030-01-01',timeSlot:'request-unique',expertKey:expert,mode:'request'}).validateSync(),undefined)
})
test('pregnancy and postpartum week calculations',()=>{
 const now=Date.parse('2026-10-18T00:00:00Z');assert.equal(pregnancy({stage:'pregnant',dueDate:new Date(now+112*DAY)},now).week,24);assert.equal(pregnancy({stage:'postpartum',babyDob:new Date(now-21*DAY)},now).week,3);assert.equal(pregnancy({stage:'ttc'},now).week,null)
})
test('paid sessions and credit session expert earnings use different policies',()=>{assert.deepEqual(payoutFor({payment:{kind:'paid',amount:1200},durationMin:45},20),{gross:1200,fee:240,net:960});assert.equal(payoutFor({payment:{kind:'credit'},durationMin:45}).net,950);assert.equal(payoutFor({payment:{kind:'credit'},durationMin:30}).net,600)})
test('calendar dates reject rollover and timestamps',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);assert.equal(validDate('2026-10-18T00:00:00Z'),false)})
