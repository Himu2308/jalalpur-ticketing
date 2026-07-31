require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { nanoid } = require('nanoid');
const Razorpay = require('razorpay');

const db = require('./db');
const RIDES = require('./rides');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

function findRide(rideId) {
  return RIDES.find((r) => r.id === rideId);
}

function genCode() {
  return 'JF-' + nanoid(8).toUpperCase();
}

// ---------- auth middleware ----------
// Simple shared-secret auth for admin devices.
function requireKey(envVar) {
  return (req, res, next) => {
    const key = req.header('x-app-key');
    if (!key || key !== process.env[envVar]) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

// ---------- per-ride staff auth ----------
// Each ride gets its own staff key, set as STAFF_KEY_<RIDE_ID> in the
// environment (e.g. STAFF_KEY_GOKART). Whichever key a device signs in
// with determines the ONE ride that device is allowed to validate tickets
// for — enforced here on the server, not just hidden in the UI, so a
// Go-Kart operator's device can never validate a Zip Line ticket even if
// they wanted to.
function findRideForStaffKey(key) {
  if (!key) return null;
  return RIDES.find((r) => {
    const envVar = 'STAFF_KEY_' + r.id.toUpperCase();
    return process.env[envVar] && process.env[envVar] === key;
  }) || null;
}

function requireRideStaffKey(req, res, next) {
  const key = req.header('x-app-key');
  const ride = findRideForStaffKey(key);
  if (!ride) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.assignedRide = ride;
  next();
}

// ---------- public: rides ----------
app.get('/api/rides', (req, res) => {
  res.json(RIDES);
});

// ---------- public: config ----------
// Lets the frontend know whether to show the real Razorpay checkout or the
// no-payment demo flow. Controlled entirely by the DEMO_MODE env var —
// leave it unset (or "false") for real payments.
app.get('/api/config', (req, res) => {
  res.json({ demoMode: process.env.DEMO_MODE === 'true' });
});

// ---------- payments: create order ----------
// Guest sends what's in their cart; server recalculates the price from
// rides.js (never trusts a price sent by the client) and asks Razorpay
// to create an order for that exact amount.
app.post('/api/orders/create', async (req, res) => {
  try {
    const items = req.body.items || []; // [{ rideId, qty }]
    let amount = 0;
    const validatedItems = [];
    for (const item of items) {
      const ride = findRide(item.rideId);
      const qty = Math.max(0, parseInt(item.qty, 10) || 0);
      if (!ride || qty === 0) continue;
      amount += ride.price * qty;
      validatedItems.push({ rideId: ride.id, qty });
    }
    if (amount <= 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100, // paise
      currency: 'INR',
      receipt: 'jf_' + Date.now(),
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      items: validatedItems,
    });
  } catch (err) {
    console.error('order create failed', err);
    res.status(500).json({ error: 'Could not create order' });
  }
});

// ---------- payments: verify + issue tickets ----------
// Only after Razorpay's signature checks out do we create tickets. This is
// what stops someone from calling the API directly and getting a free ride.
app.post('/api/orders/verify', async (req, res) => {
  try {
    const { orderId, paymentId, signature, items } = req.body;
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    if (expected !== signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const insert = db.prepare(`
      INSERT INTO tickets (code, ride_id, ride_name, price, status, razorpay_order_id, razorpay_payment_id, created_at)
      VALUES (?, ?, ?, ?, 'valid', ?, ?, ?)
    `);

    const tickets = [];
    for (const item of items || []) {
      const ride = findRide(item.rideId);
      if (!ride) continue;
      const qty = Math.max(0, parseInt(item.qty, 10) || 0);
      for (let i = 0; i < qty; i++) {
        const code = genCode();
        const createdAt = Date.now();
        insert.run(code, ride.id, ride.name, ride.price, orderId, paymentId, createdAt);
        const qrDataUrl = await QRCode.toDataURL(code, { margin: 2, width: 220 });
        tickets.push({
          code,
          rideId: ride.id,
          rideName: ride.name,
          price: ride.price,
          status: 'valid',
          createdAt,
          qrDataUrl,
        });
      }
    }

    res.json({ tickets });
  } catch (err) {
    console.error('order verify failed', err);
    res.status(500).json({ error: 'Could not verify payment' });
  }
});

// ---------- demo: create tickets with no real payment ----------
// Only active when DEMO_MODE=true in the environment. Lets you demo the
// full booking → scan → admin flow without touching Razorpay at all.
// Turn this OFF (unset DEMO_MODE, or set it to "false") before real launch.
app.post('/api/tickets/demo-create', async (req, res) => {
  if (process.env.DEMO_MODE !== 'true') {
    return res.status(403).json({ error: 'Demo mode is not enabled' });
  }
  try {
    const items = req.body.items || [];
    const insert = db.prepare(`
      INSERT INTO tickets (code, ride_id, ride_name, price, status, razorpay_order_id, razorpay_payment_id, created_at)
      VALUES (?, ?, ?, ?, 'valid', 'DEMO', 'DEMO', ?)
    `);
    const tickets = [];
    for (const item of items) {
      const ride = findRide(item.rideId);
      if (!ride) continue;
      const qty = Math.max(0, parseInt(item.qty, 10) || 0);
      for (let i = 0; i < qty; i++) {
        const code = genCode();
        const createdAt = Date.now();
        insert.run(code, ride.id, ride.name, ride.price, createdAt);
        const qrDataUrl = await QRCode.toDataURL(code, { margin: 2, width: 220 });
        tickets.push({ code, rideId: ride.id, rideName: ride.name, price: ride.price, status: 'valid', createdAt, qrDataUrl });
      }
    }
    res.json({ tickets });
  } catch (err) {
    console.error('demo create failed', err);
    res.status(500).json({ error: 'Could not create demo tickets' });
  }
});

// ---------- staff: who am I signed in as ----------
// Frontend calls this right after sign-in to confirm which ride this
// device/key is locked to, and display it clearly to the operator.
app.get('/api/staff/whoami', requireRideStaffKey, (req, res) => {
  res.json({ rideId: req.assignedRide.id, rideName: req.assignedRide.name });
});

// ---------- staff: validate a ticket ----------
// A device can only validate tickets for the ONE ride its key is assigned
// to (see requireRideStaffKey above). Trying to validate a ticket for a
// different ride is rejected with 403, regardless of what the frontend
// sends — this can't be bypassed from the browser.
app.post('/api/tickets/validate', requireRideStaffKey, (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Code required' });

  const ticket = db.prepare('SELECT * FROM tickets WHERE code = ?').get(code);
  if (!ticket) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (ticket.ride_id !== req.assignedRide.id) {
    return res.status(403).json({ error: 'wrong_ride', ticket, assignedRideName: req.assignedRide.name });
  }
  if (ticket.status === 'used') {
    return res.status(409).json({ error: 'already_used', ticket });
  }

  const usedAt = Date.now();
  db.prepare('UPDATE tickets SET status = ?, used_at = ? WHERE code = ?').run('used', usedAt, code);
  ticket.status = 'used';
  ticket.used_at = usedAt;
  res.json({ ticket });
});

// ---------- admin: summary ----------
app.get('/api/admin/summary', requireKey('ADMIN_KEY'), (req, res) => {
  const tickets = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
  const revenue = tickets.reduce((sum, t) => sum + t.price, 0);
  const used = tickets.filter((t) => t.status === 'used').length;

  const byRide = {};
  for (const t of tickets) {
    byRide[t.ride_id] = byRide[t.ride_id] || { name: t.ride_name, count: 0, revenue: 0 };
    byRide[t.ride_id].count += 1;
    byRide[t.ride_id].revenue += t.price;
  }
  const rideRows = Object.values(byRide).sort((a, b) => b.count - a.count);

  res.json({
    revenue,
    sold: tickets.length,
    used,
    rideRows,
    recent: tickets.slice(0, 25),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jalalpur Fun ticketing server running on port ${PORT}`);
});
