import {Settings} from './models.js'
import {plans,redFlags} from './policy.js'
let last=0
export async function loadCarePolicy(force=false){
 if(!force&&Date.now()-last<5000)return
 for(const setting of await Settings.find({key:{$in:['plans','redFlags']}})){
  if(setting.key==='plans')for(const k of ['sanctuary','village','premium'])if(setting.value?.[k])Object.assign(plans[k],setting.value[k])
  // Baseline safety flags cannot be removed through settings.
  if(setting.key==='redFlags'&&Array.isArray(setting.value))for(const flag of setting.value)if(!redFlags.includes(flag))redFlags.push(flag)
 }
 last=Date.now()
}
