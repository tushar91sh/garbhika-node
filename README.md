# Garbhika API

See ../SETUP_AUTH_AND_DASHBOARDS.md for complete setup and migration notes. Node.js 20.19+ and MongoDB are required.

## Authentication endpoints

- POST /api/auth/register: name, email, password, confirmPassword, acceptTerms=true, optional marketingOptIn. Always creates a customer. Always returns a verification challenge and never an access token; signup proceeds to the OTP screen in every environment.
- POST /api/auth/login: customer email and password. Unverified users receive a verification challenge without an access token.
- POST /api/auth/admin/login: environment-provisioned admin username and password.
- POST /api/auth/verification/resend: challenge. Per-account cooldown and hourly limit.
- POST /api/auth/verification/confirm: challenge and 6-digit code. Five attempts, 10-minute expiry, single-use.
- POST /api/auth/verification/development-bypass: challenge. Available only for explicit NODE_ENV=development and OTP_DEV_BYPASS=true; requires user action on OTP page.
- GET /api/auth/me: authenticated current user.
- POST /api/auth/logout: revokes all sessions for current account.
- POST /api/auth/forgot-password: customer email. Generic response.
- POST /api/auth/reset-password: single-use reset token and new password; revokes existing sessions.

## Customer endpoints

GET/PATCH /api/me, POST /api/me/password, GET /api/me/bookings, PATCH /api/me/bookings/:id/cancel, PATCH /api/me/journey (stage, dueDate, services, language, context). Profile changes are scoped to the authenticated account. Admin credentials are managed by environment, never by customer APIs.

## Admin endpoints

GET /api/admin/stats, /audit, /:resource, /:resource/:id and /:resource/export.csv. Resources: users (customers only), inquiries, bookings, subscribers and community. PATCH /api/admin/:resource/:id/status for bookings/inquiries. No role-promotion endpoint.

## Other endpoints

GET /api/health, /experts, /community, /bookings/availability. POST /api/bookings, /inquiries, /newsletter/subscribe, /community/join. GET /api/newsletter/unsubscribe?token=...

Use npm test for lightweight checks and npm run test:integration for disposable-database integration checks. npm run admin:make provisions only the configured environment administrator; it does not promote a public signup.
