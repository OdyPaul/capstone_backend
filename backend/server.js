// backend/server.js
const path = require('path');
const express = require('express');
const colors = require('colors');
const cors = require('cors');
const qs = require('qs');
require('dotenv').config();

const { connectAll } = require('./config/db');
const { errorHandler } = require('./middleware/errorMiddleware');
const { redis } = require('./lib/redis');

const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const paramPollutionGuard = require('./middleware/paramPollutionGuard');

(async () => {
  await connectAll();

  const app = express();

  // ---- Core hardening flags ----
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Use your custom query parser BEFORE middlewares that read req.query
  app.set('query parser', (str) => qs.parse(str));

  // ---- Security headers (API-friendly) ----
  app.use(helmet());
  // allow images/QRs to be embedded cross-origin (optional but handy)
  app.use(helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }));

  // Only send HSTS in prod (and only if clients use HTTPS to reach you)
  if (process.env.NODE_ENV === 'production') {
    app.use(helmet.hsts({ maxAge: 15552000 })); // ~180 days
  }

  // ---- CORS allow-list ----
  const ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const corsOptions = {
    origin(origin, cb) {
      if (!origin) return cb(null, true);            // non-browser tools
      if (ORIGINS.length === 0) return cb(null, true); // dev: allow all
      if (ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: false,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));

  // ---- Body parsers (cap sizes) ----
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));

  // ---- Request sanitizers ----
  app.use(mongoSanitize());                 // strips $/.
  app.use(paramPollutionGuard(['programs']));// keep arrays for specific keys

  // ---- Redis ping (optional visibility) ----
  (async () => {
    if (redis) {
      try {
        console.log('🟢 Redis ping:', await redis.ping());
      } catch (e) {
        console.error('🔴 Redis ping failed:', e.message);
      }
    } else {
      console.warn('⚠️ REDIS_URL missing → running without Redis features');
    }
  })();

  // ---- Health ----
  app.get('/', (_req, res) => res.send('✅ API is running...'));

  // ---- Routes ----
  app.use('/api/web/templates', require('./routes/web/vcTemplateRoutes'));
  app.use('/api/web',          require('./routes/web/userRoutes'));           // web users
  app.use('/api/mobile',       require('./routes/mobile/userRoutes'));        // mobile auth/users
  app.use('/api/web',          require('./routes/web/vcRoutes'));             // VC: drafts/sign/anchor/etc
  app.use('/api/web',          require('./routes/web/pdfRoutes'));            // PDF render/download
  app.use('/api/web',          require('./routes/web/settingsRoutes'));       // issuer metadata/settings
  app.use('/api/web/student',  require('./routes/studentRoutes'));            // student queries
  app.use('/api/web',          require('./routes/web/draftVcRoutes'));
  app.use('/api/web',          require('./routes/web/paymentRoutes'));
  app.use('/api/web',          require('./routes/web/claimRoutes'));
  app.use('/',                 require('./routes/web/claimPublicRoutes'));

  // Mobile features
  app.use('/api/uploads',              require('./routes/mobile/uploadRoutes'));
  app.use('/api/vc-requests',          require('./routes/mobile/vcRoutes'));
  app.use('/api/verification-request', require('./routes/mobile/verificationRoutes'));

  // ---- Errors (last) ----
  app.use(errorHandler);

  const port = process.env.PORT || 5000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`.yellow.bold);
    if (ORIGINS.length) console.log('CORS allow-list:', ORIGINS);
    else console.log('CORS allow-list empty → allowing all origins (dev)');
  });
})();
