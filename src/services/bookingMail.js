import { sendMailSafely, clientUrl } from './email.js'

const footer = 'Garbhika — this is an automated message. Reply to this email or contact us through the website if you need help.'

export function sendBookingReceived(booking) {
  sendMailSafely({
    to: booking.email,
    subject: 'We received your Garbhika consultation request',
    text: `Hi ${booking.name},\n\nThank you. We have received your consultation request for ${booking.dateKey} at ${booking.timeSlot}.\nWe will confirm by email shortly.\n\n${footer}`,
  })
}

export function sendBookingStatus(booking) {
  const messages = {
    confirmed: `Your consultation on ${booking.dateKey} at ${booking.timeSlot} is confirmed.`,
    cancelled: `Your consultation on ${booking.dateKey} at ${booking.timeSlot} has been cancelled.`,
    completed: `Thank you for your consultation on ${booking.dateKey}.`,
  }
  if (!messages[booking.status]) return
  sendMailSafely({
    to: booking.email,
    subject: `Garbhika consultation ${booking.status}`,
    text: `Hi ${booking.name},\n\n${messages[booking.status]}\nManage your bookings: ${clientUrl()}/dashboard\n\n${footer}`,
  })
}

export function sendPasswordReset(user, token) {
  sendMailSafely({
    to: user.email,
    subject: 'Reset your Garbhika password',
    text: `Hi ${user.name},\n\nUse this link to set a new password. It expires in 30 minutes and can be used once:\n${clientUrl()}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
  })
}
