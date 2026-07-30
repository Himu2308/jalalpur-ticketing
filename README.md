# Jalalpur Fun — Ticketing System

Real backend + database + Razorpay payments for ride ticketing. Three pages:

- `/index.html` — guest booking + payment
- `/staff.html` — ride operators validate tickets
- `/admin.html` — revenue and sales dashboard

## 1. Local setup

```bash
npm install
cp .env.example .env
```

Open `.env` and fill in:

- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from your Razorpay dashboard (see step 2)
- `STAFF_KEY` — any long random string, e.g. `park-staff-9f2a7c`
- `ADMIN_KEY` — a different long random string, only you should know this

Then run:

```bash
npm start
```

Visit `http://localhost:3000`.

## 2. Get Razorpay keys

1. Sign up at [razorpay.com](https://razorpay.com) — you'll need your park's PAN and a bank account for payouts (KYC).
2. While KYC is pending, Razorpay gives you **Test Mode** keys immediately — use these to build and test everything below with fake card/UPI numbers. Test payment methods are listed in Razorpay's docs.
3. Once KYC is approved, switch to **Live Mode** keys (Dashboard → Settings → API Keys) and swap them into `.env` — no code changes needed.

## 3. How the payment flow works (so you can explain/debug it)

1. Guest picks rides → frontend calls `POST /api/orders/create` with the cart
2. Server re-calculates the price from `rides.js` (never trusts the browser) and asks Razorpay to create an order
3. Razorpay's checkout popup opens in the guest's browser, they pay
4. On success, the frontend calls `POST /api/orders/verify` with Razorpay's response
5. Server verifies the cryptographic signature Razorpay sent — **only if this matches** does it create tickets in the database and generate QR codes
6. Tickets are returned and displayed as ticket stubs

This means a ticket can only ever be created after a real, verified payment — there's no way to skip the payment step from the browser.

## 4. Deploying (Render.com — free tier works for a single small park)

1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service → connect your repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add your `.env` values under Render's "Environment" tab (never commit `.env` to GitHub)
6. Important: SQLite needs a persistent disk on Render, or your database resets on every redeploy.
   Add a Render **Disk**, mount it at `/data`, and set `DB_PATH=/data/tickets.db` in your environment variables.
7. Deploy. You'll get a URL like `https://jalalpur-fun.onrender.com` — bookmark `/index.html`, `/staff.html`, `/admin.html` on the right devices.

(Railway.app and Fly.io work the same way if you prefer those.)

## 5. Day-to-day usage

- **Staff devices**: open `/staff.html` on a phone/tablet at each ride, sign in once with the staff key (it stays saved for that browser session)
- **Your phone/laptop**: open `/admin.html`, sign in with the admin key, to check revenue anytime
- **Guests**: `/index.html` — you can put this link in your Instagram bio, a QR poster at the entrance, or WhatsApp

## 6. Before going fully live — a few upgrades worth doing

- **Webhook verification**: right now payment verification happens via the browser response signature, which is standard and secure, but Razorpay also recommends listening to their server-side webhook as a second confirmation in case a guest closes the browser mid-payment. Worth adding once you're comfortable with the basics.
- **Per-staff PINs**: currently all staff share one key. Fine for a small team; if you grow, swap for individual short PINs so you know who validated what.
- **Backups**: since tickets live in a single SQLite file, set up a daily backup of `tickets.db` (Render disks can be snapshotted, or just download the file periodically).
- **Rate limiting**: add basic rate limiting on `/api/tickets/validate` so the endpoint can't be hammered.

## 7. File overview

```
server.js       - all API routes
db.js           - SQLite schema
rides.js        - ride names/prices (edit this to add/remove rides)
public/         - the three frontend pages + shared styles
.env.example    - copy to .env and fill in secrets
```
