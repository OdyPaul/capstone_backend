const Redis = require('ioredis');

const url = process.env.REDIS_URL;
if (!url) console.warn('⚠️ REDIS_URL not set — Redis features disabled');

const redis = url ? new Redis(url, { maxRetriesPerRequest: null }) : null;

module.exports = { redis };
