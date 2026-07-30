// Single source of truth for rides. Edit prices/names here — both the
// booking page and the payment order creation read from this file, so a
// guest can never pay a different amount than what's listed.

module.exports = [
  { id: 'gokart',    name: 'Go-Kart',         price: 150 },
  { id: 'rocket',    name: 'Rocket Ejecter',  price: 120 },
  { id: 'zipline',   name: 'Zip Line',        price: 150 },
  { id: 'commando',  name: 'Commando Course', price: 130 },
  { id: 'cycle360',  name: '360 Cycle',       price: 100 },
  { id: 'gyro',      name: 'Human Gyro',      price: 100 },
  { id: 'skyroller', name: 'Sky Roller',      price: 120 },
];
