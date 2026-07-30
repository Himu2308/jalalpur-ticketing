const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './tickets.db');
db.pragma('journal_mode = WAL');

// One row per single-ride ticket. A guest buying 2 Go-Kart rides gets
// 2 separate rows/QR codes, each independently valid/used — this is what
// lets someone re-ride by simply buying (and scanning) another ticket.
db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    code TEXT PRIMARY KEY,
    ride_id TEXT NOT NULL,
    ride_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'valid',      -- 'valid' | 'used'
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    created_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
  CREATE INDEX IF NOT EXISTS idx_tickets_ride ON tickets(ride_id);
`);

module.exports = db;
