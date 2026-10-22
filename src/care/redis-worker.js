import { tickJobs } from './jobs.js'
export async function startRedisWorker(){
 const [{Queue,Worker},RedisModule]=await Promise.all([import('bullmq'),import('ioredis')])
 const Redis=RedisModule.default,connection=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:null})
 const queue=new Queue('garbhika-care',{connection})
 await queue.add('tick',{}, {jobId:'care-tick',repeat:{every:30000},removeOnComplete:50,removeOnFail:100})
 const worker=new Worker('garbhika-care',async()=>tickJobs(),{connection,concurrency:1})
 worker.on('error',e=>console.error('Care queue:',e.message))
 return ()=>{worker.close().finally(()=>queue.close()).finally(()=>connection.quit())}
}
