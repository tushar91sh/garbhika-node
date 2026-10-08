# Garbhika API

Production-oriented Express and MongoDB backend for the Garbhika React website.

## Features

- JWT registration, login and current-user endpoint
- Contact enquiry persistence
- General and expert-specific consultation booking persistence
- Newsletter subscription and community membership persistence
- Experts and community content endpoints used by the existing UI
- Admin-only paginated records and booking/enquiry status updates
- Server-side validation, password hashing, security headers, CORS and rate limiting
- Optional SMTP notification emails

## Setup

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Set `MONGODB_URI` and a long random `JWT_SECRET` in `server/.env`. The frontend development server proxies `/api` to `http://localhost:5000`.

From the project root, after installing both dependency sets, run both applications together:

```bash
npm run dev:all
```

## Public API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Start JWT session |
| GET | `/api/auth/me` | Return authenticated user |
| POST | `/api/inquiries` | Submit Contact form |
| POST | `/api/bookings` | Submit consultation or expert booking |
| POST | `/api/newsletter/subscribe` | Subscribe email |
| POST | `/api/community/join` | Join community |
| GET | `/api/experts` | Get expert cards |
| GET | `/api/community` | Get community page data |

## Admin API

Register an email listed in `ADMIN_EMAILS`, then send its JWT as `Authorization: Bearer <token>`.

- `GET /api/admin/inquiries`
- `GET /api/admin/bookings`
- `GET /api/admin/subscribers`
- `GET /api/admin/community`
- `PATCH /api/admin/inquiries/:id/status`
- `PATCH /api/admin/bookings/:id/status`

List endpoints accept `page` and `limit` query parameters.

## SEO

The frontend now applies the PDF-approved title and meta description for all 17 specified routes, plus canonical and Open Graph tags. `/faqs/` also emits the required `FAQPage` JSON-LD schema containing all ten FAQ pairs.
