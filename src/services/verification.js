import { createHmac, randomInt } from 'node:crypto'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { assert } from '../utils/validation.js'
import { sendMail } from './email.js'
export const developmentBypass = () =>
  process.env.NODE_ENV === 'development' &&
  process.env.OTP_DEV_BYPASS === 'true'
export const verified = (user) =>
  user.emailVerified &&
  (user.verificationMethod !== 'development' || developmentBypass())
export const otpDigest = (id, code) =>
  createHmac('sha256', process.env.JWT_SECRET)
    .update(String(id) + ':' + code)
    .digest('hex')
export const challengeFor = (user) =>
  jwt.sign(
    { sub: user.id, purpose: 'verify-email', version: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '30m' },
  )
export function readChallenge(token) {
  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    assert(
      false,
      'Verification session expired. Sign in to request a new code.',
      401,
    )
  }
  assert(
    payload.purpose === 'verify-email',
    'Invalid verification session.',
    401,
  )
  return payload
}
export async function issueOtp(user) {
  const now = new Date(),
    code = String(randomInt(100000, 1000000))
  const fresh = {
    $or: [
      { otpWindow: { $exists: false } },
      { otpWindow: null },
      { otpWindow: { $lte: new Date(+now - 3600000) } },
    ],
  }
  await User.updateOne(
    { _id: user.id, ...fresh },
    { $set: { otpWindow: now, otpSendCount: 0 } },
  )
  const claimed = await User.findOneAndUpdate(
    {
      _id: user.id,
      otpSendCount: { $lt: 5 },
      $or: [
        { otpSentAt: { $exists: false } },
        { otpSentAt: null },
        { otpSentAt: { $lte: new Date(+now - 60000) } },
      ],
    },
    {
      $set: {
        otpSentAt: now,
        otpHash: otpDigest(user.id, code),
        otpExpires: new Date(+now + 600000),
        otpAttempts: 0,
      },
      $inc: { otpSendCount: 1 },
    },
    { new: true },
  )
  assert(
    claimed,
    'Please wait 60 seconds between codes. Maximum 5 codes per hour.',
    429,
  )
  if (developmentBypass())
    return {
      devBypassAvailable: true,
      developmentCode: code,
      resendAfterSeconds: 60,
    }
  try {
    assert(
      await sendMail({
        to: user.email,
        subject: 'Verify your Garbhika email',
        text: `Your Garbhika verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
      }),
      'Email delivery is not configured.',
      503,
    )
    return { devBypassAvailable: false, resendAfterSeconds: 60 }
  } catch {
    await User.updateOne(
      { _id: user.id, otpHash: otpDigest(user.id, code) },
      {
        $unset: { otpHash: 1, otpExpires: 1, otpSentAt: 1 },
        $inc: { otpSendCount: -1 },
      },
    )
    assert(false, 'Could not send your code. Please try again shortly.', 503)
  }
}
