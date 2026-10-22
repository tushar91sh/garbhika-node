import test from 'node:test'
import assert from 'node:assert/strict'
import {credentialBlock,documentExpiry,validateCredentialInput} from '../src/care/credentials.js'
import {normalizeSchedule,scheduledOn,weeklyAdherence} from '../src/care/schedules.js'
const now=Date.parse('2030-03-20T06:00:00Z')
test('registration/insurance require expiry and validate calendar dates',()=>{assert.throws(()=>validateCredentialInput({kind:'insurance'}));assert.throws(()=>validateCredentialInput({kind:'registration',expiresOn:'2030-02-30'}));assert.throws(()=>validateCredentialInput({kind:'made-up'}));assert.equal(validateCredentialInput({kind:'degree'}).expiresOn,null)})
test('credentials expire at end of day in IST, with verified replacements superseding expired documents',()=>{
 assert.equal(documentExpiry({expiresOn:'2030-03-20'}),Date.parse('2030-03-20T18:29:59.999Z'))
 const documents=['identity','degree','registration','insurance'].map(kind=>({kind,status:'verified',expiresOn:['registration','insurance'].includes(kind)?'2030-03-19':null}))
 const profile={verification:{documentPolicyVersion:2,documents}};assert.ok(credentialBlock(profile,now))
 documents.push({kind:'registration',status:'verified',expiresOn:'2031-03-20'},{kind:'insurance',status:'verified',expiresOn:'2031-03-20'})
 assert.equal(credentialBlock(profile,now),null)
 documents.at(-1).status='pending';assert.ok(credentialBlock(profile,now))
})
test('weekly schedule validation rejects duplicates and impossible counts',()=>{for(const count of [0,8,2.5])assert.throws(()=>normalizeSchedule({frequency:'custom',schedule:{mode:'times_per_week',count}}));assert.throws(()=>normalizeSchedule({frequency:'custom',schedule:{mode:'weekdays',weekdays:[1,1]}}));assert.throws(()=>normalizeSchedule({frequency:'custom',schedule:{mode:'weekdays',weekdays:[]}}))})
test('weekday completion and adherence ignore unscheduled checks and future/end dates',()=>{
 const t={_id:'a',...normalizeSchedule({frequency:'custom',schedule:{mode:'weekdays',weekdays:[1,3,5]}}),startAt:'2026-10-19T00:00:00+05:30'}
 assert.equal(scheduledOn(t,'2026-10-20'),false);assert.equal(scheduledOn(t,'2026-10-21'),true)
 const d=weeklyAdherence([t],[{task:'a',date:'2026-10-19'},{task:'a',date:'2026-10-20'},{task:'a',date:'2026-10-23'}],new Date('2026-10-22T10:00:00Z'));assert.equal(d.expected,2);assert.equal(d.completed,1);assert.equal(d.percent,50)
})
test('weekly count supports every count from one through seven',()=>{for(let count=1;count<=7;count++){const t={_id:'a',...normalizeSchedule({frequency:'custom',schedule:{mode:'times_per_week',count}})};const r=weeklyAdherence([t],[],new Date('2026-10-25T12:00:00Z'));assert.equal(r.expected,count)}})
