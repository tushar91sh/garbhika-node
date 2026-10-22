import { randomBytes } from 'node:crypto'
let client
async function s3(){if(!client){const {S3Client}=await import('@aws-sdk/client-s3');client=new S3Client({region:process.env.AWS_REGION||'ap-south-1'})}return client}
export async function uploadPrivate(buffer,mime){
 if(!process.env.AWS_S3_BUCKET)return null
 if(!process.env.AWS_KMS_KEY_ID)throw Object.assign(new Error('Configure AWS_KMS_KEY_ID for private S3 documents.'),{status:503})
 const {PutObjectCommand}=await import('@aws-sdk/client-s3'),key='garbhika/private/'+randomBytes(24).toString('hex')
 await (await s3()).send(new PutObjectCommand({Bucket:process.env.AWS_S3_BUCKET,Key:key,Body:buffer,ContentType:mime,ServerSideEncryption:'aws:kms',SSEKMSKeyId:process.env.AWS_KMS_KEY_ID}));return key
}
export async function downloadUrl(key,name){const {GetObjectCommand}=await import('@aws-sdk/client-s3'),{getSignedUrl}=await import('@aws-sdk/s3-request-presigner');return getSignedUrl(await s3(),new GetObjectCommand({Bucket:process.env.AWS_S3_BUCKET,Key:key,ResponseContentDisposition:`attachment; filename="${name.replace(/["\\\r\n]/g,'_')}"`}),{expiresIn:60})}
export async function loadHealthKey(){if(!process.env.HEALTH_DATA_KMS_CIPHERTEXT)return;const {KMSClient,DecryptCommand}=await import('@aws-sdk/client-kms'),kms=new KMSClient({region:process.env.AWS_REGION||'ap-south-1'}),data=await kms.send(new DecryptCommand({CiphertextBlob:Buffer.from(process.env.HEALTH_DATA_KMS_CIPHERTEXT,'base64'),...(process.env.AWS_KMS_KEY_ID?{KeyId:process.env.AWS_KMS_KEY_ID}:{})}));if(data.Plaintext?.length!==32)throw new Error('KMS health key must decrypt to exactly 32 bytes.');process.env.HEALTH_DATA_KEY=Buffer.from(data.Plaintext).toString('hex')}
