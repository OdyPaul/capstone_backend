const { pub } = require('./redis');

async function notify(type, payload = {}) {
  if (!pub) return;
  try {
    await pub.publish('events', JSON.stringify({ type, ...payload, ts: Date.now() }));
  } catch (e) {
    console.warn('notify failed:', e.message);
  }
}
module.exports = { notify };
