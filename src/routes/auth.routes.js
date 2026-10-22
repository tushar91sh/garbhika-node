import { Router } from 'express'
import { issueSession, rotateSession, clearCookie } from '../care/security.js'
import { Refresh } from '../care/models.js'
import User from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import {
  assert,
  clean,
  passwordOk,
  safeUser,
  validEmail,
} from '../utils/validation.js'
import { createResetToken, sha256 } from '../services/tokens.js'
import { sendMail, clientUrl } from '../services/email.js'
import {
  challengeFor,
  developmentBypass,
  verified,
  readChallenge,
  issueOtp,
  otpDigest,
} from '../services/verification.js'
const router = Router()
router.post('/register', async (req, res) => {
  const name = clean(req.body.name),
    email = clean(req.body.email).toLowerCase(),
    password = req.body.password
  assert(
    name.length >= 2 && name.length <= 80,
    'Name must be between 2 and 80 characters.',
  )
  assert(validEmail(email), 'Please enter a valid email address.')
  assert(
    passwordOk(password),
    'Password must be at least 8 characters and no more than 72 UTF-8 bytes.',
  )
  assert(password === req.body.confirmPassword, 'Passwords do not match.')
  assert(
    req.body.acceptTerms === true,
    'Please accept the terms and privacy policy.',
  )
  assert(
    email !== (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    'This email cannot be used for customer signup.',
    409,
  )
  assert(
    !(await User.exists({ email })),
    'An account with this email already exists. Sign in or reset your password.',
    409,
  )
  const bypass = developmentBypass()
  const user = await User.create({
    name,
    email,
    passwordHash: await User.hashPassword(password),
    role: 'mother',
    emailVerified: false,
    verificationMethod: null,
    termsAcceptedAt: new Date(),
    termsVersion: '2026-10-16',
    marketingOptIn: req.body.marketingOptIn === true,
  })
  const challenge = challengeFor(user)
  try {
    const delivery = await issueOtp(user)
    res
      .status(201)
      .json({ verificationRequired: true, challenge, email, ...delivery })
  } catch {
    res.status(201).json({
      verificationRequired: true,
      challenge,
      email,
      deliveryFailed: true,
      devBypassAvailable: bypass,
      message: 'Account created. Use Resend code to retry email delivery.',
    })
  }
})
router.post('/login', async (req, res) => {
  const email = clean(req.body.email).toLowerCase(),
    password = req.body.password
  assert(
    validEmail(email) &&
      typeof password === 'string' &&
      password.length > 0 &&
      Buffer.byteLength(password) <= 72,
    'Enter a valid email and password.',
  )
  const user = await User.findOne({
    email,
    role: { $in: ['user','mother','expert'] },
    envManagedAdmin: { $ne: true },
  }).select('+passwordHash')
  assert(
    user && (await user.verifyPassword(password)),
    'Incorrect email or password.',
    401,
  )
  await User.updateOne(
    { _id: user.id, tokenVersion: { $exists: false } },
    { $set: { tokenVersion: 0 } },
  )
  assert(!['suspended','deleted'].includes(user.status), 'This account is not active.',403)
  if (!(user.role==='expert'&&user.status==='pending') && !verified(user))
    return res.json({
      verificationRequired: true,
      challenge: challengeFor(user),
      email: user.email,
      devBypassAvailable: developmentBypass(),
    })
  user.lastLoginAt=new Date();await user.save()
  res.json(await issueSession(user,res))
})
router.post('/admin/login', async (req, res) => {
  const username = clean(req.body.username).toLowerCase(),
    password = req.body.password
  assert(
    username &&
      typeof password === 'string' &&
      password.length > 0 &&
      Buffer.byteLength(password) <= 72,
    'Enter your admin username and password.',
  )
  const user = await User.findOne({
    adminUsername: username,
    role: { $in: ['admin','superadmin'] },
    envManagedAdmin: true,
  }).select('+passwordHash')
  assert(
    user && (await user.verifyPassword(password)),
    'Incorrect username or password.',
    401,
  )
  assert(user.status!=='suspended'&&user.status!=='deleted','This account is not active.',403)
  res.json(await issueSession(user,res))
})
router.post('/verification/resend', async (req, res) => {
  const payload = readChallenge(req.body.challenge)
  const user = await User.findOne({
    _id: payload.sub,
    role: { $in: ['user','mother','expert'] },
    tokenVersion: payload.version,
  })
  assert(
    user && !verified(user),
    'Verification session is no longer valid.',
    400,
  )
  const delivery = await issueOtp(user)
  res.json({
    message: developmentBypass()
      ? 'Development code generated. It expires in 10 minutes.'
      : 'A new code has been sent. It expires in 10 minutes.',
    ...delivery,
  })
})
router.post('/verification/confirm', async (req, res) => {
  const payload = readChallenge(req.body.challenge),
    code = clean(req.body.code)
  assert(/^\d{6}$/.test(code), 'Enter the six-digit email code.')
  const filter = {
    _id: payload.sub,
    role: { $in: ['user','mother','expert'] },
    tokenVersion: payload.version,
    otpExpires: { $gt: new Date() },
    otpAttempts: { $lt: 5 },
  }
  const attempt = await User.findOneAndUpdate(
    filter,
    { $inc: { otpAttempts: 1 } },
    { new: true },
  )
  assert(attempt, 'Code expired or attempt limit reached. Request a new code.')
  const user = await User.findOneAndUpdate(
    {
      ...filter,
      otpAttempts: { $lte: 5 },
      otpHash: otpDigest(payload.sub, code),
    },
    {
      $set: {
        emailVerified: true,
        verificationMethod: developmentBypass() ? 'development' : 'brevo',
      },
      $unset: { otpHash: 1, otpExpires: 1, otpSentAt: 1 },
    },
    { new: true },
  )
  assert(
    user,
    'Incorrect code. Request a new code after 5 unsuccessful attempts.',
  )
  res.json(await issueSession(user,res))
})
router.post('/verification/development-bypass', async (req, res) => {
  assert(
    developmentBypass(),
    'This action is available only in development.',
    404,
  )
  const payload = readChallenge(req.body.challenge)
  const user = await User.findOneAndUpdate(
    {
      _id: payload.sub,
      role: { $in: ['user','mother','expert'] },
      tokenVersion: payload.version,
      emailVerified: false,
    },
    {
      $set: { emailVerified: true, verificationMethod: 'development' },
      $unset: { otpHash: 1, otpExpires: 1, otpSentAt: 1 },
    },
    { new: true },
  )
  assert(user, 'Verification session is no longer valid.')
  res.json(await issueSession(user,res))
})
router.post('/refresh', async (req,res) => {
 const origin=req.get('origin');const allowed=(process.env.CLIENT_URL||'http://localhost:5173').split(',').map(s=>s.trim())
 assert(!origin||allowed.includes(origin),'Origin not allowed.',403)
 res.json(await rotateSession(req,res))
})
router.get('/me', requireAuth, (req, res) =>
  res.json({ user: safeUser(req.user) }),
)
router.post('/logout', requireAuth, async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } })
  await Refresh.deleteMany({user:req.user.id})
  clearCookie(res)
  res.json({ message: 'Signed out on all devices.' })
})
router.post('/forgot-password', async (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  assert(validEmail(email), 'Enter a valid email address.')
  const user = await User.findOne({
    email,
    role: { $in: ['user','mother','expert'] },
    envManagedAdmin: { $ne: true },
  })
  if (user) {
    const { token, hash, expires } = createResetToken()
    await User.updateOne(
      { _id: user.id },
      { $set: { resetTokenHash: hash, resetTokenExpires: expires } },
    )
    try {
      const sent = await sendMail({
        to: email,
        subject: 'Reset your Garbhika password',
        text: `Set a new password within 30 minutes: ${clientUrl()}/reset-password?token=${token}`,
      })
      if (!sent)
        console.warn(
          'Password-reset email unavailable; configure Brevo or SMTP.',
        )
    } catch {
      console.warn(
        'Password-reset delivery failed; please check email configuration.',
      )
    }
  }
  res.json({
    message: 'If an account exists for that email, a reset link has been sent.',
  })
})
router.post('/reset-password', async (req, res) => {
  assert(
    /^[a-f0-9]{64}$/.test(clean(req.body.token)),
    'This reset link is invalid or has expired.',
  )
  assert(
    passwordOk(req.body.password),
    'Password must be at least 8 characters and no more than 72 UTF-8 bytes.',
  )
  const user = await User.findOneAndUpdate(
    {
      role: { $in: ['user','mother','expert'] },
      envManagedAdmin: { $ne: true },
      resetTokenHash: sha256(req.body.token),
      resetTokenExpires: { $gt: new Date() },
    },
    {
      $set: { passwordHash: await User.hashPassword(req.body.password) },
      $unset: { resetTokenHash: 1, resetTokenExpires: 1 },
      $inc: { tokenVersion: 1 },
    },
    { new: true },
  )
  assert(user, 'This reset link is invalid or has expired.')
  res.json({ message: 'Password updated. Please sign in again.' })
})
export default router
