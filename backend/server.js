// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const qs = require('qs');
require('dotenv').config();

const { connectAll } = require('./config/db');
const { errorHandler } = require('./middleware/errorMiddleware');
const { redis } = require('./lib/redis');
const { mongoSanitizeSafe } = require('./middleware/mongoSanitizeSafe');
const paramPollutionGuard = require('./middleware/paramPollutionGuard');

(async () => {
  await connectAll();
  const app = express();

  // Core
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('query parser', (str) => qs.parse(str));

  // Security
  app.use(helmet());
  app.use(helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }));
  if (process.env.NODE_ENV === 'production') {
    app.use(helmet.hsts({ maxAge: 15552000 }));
  }

  // CORS
  const ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const corsOptions = {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (ORIGINS.length === 0) return cb(null, true);
      if (ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: false,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
    optionsSuccessStatus: 204,
  };
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));

  // Global parsers (light)
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));

  // Sanitizers
  app.use(mongoSanitizeSafe({ replaceWith: '_' }));
  app.use(paramPollutionGuard(['programs']));

  // Redis visibility
  (async () => {
    if (redis) {
      try { console.log('🟢 Redis ping:', await redis.ping()); }
      catch (e) { console.error('🔴 Redis ping failed:', e.message); }
    } else {
      console.warn(' REDIS_URL missing → running without Redis features');
    }
  })();

  // Health
  app.get('/', (_req, res) => res.send('✅ API is running...'));
    app.use('/api', require('./routes/utils/colorRoute'));
  // ---------- Routes ----------
  // Common users (merged web + mobile user routes)
  app.use('/api', require('./routes/common/userRoutes'));

  // Web area (non-user web routes) with larger body limits
  const web = express.Router();
  web.use(express.json({ limit: '2mb' }));
  web.use(express.urlencoded({ extended: true, limit: '2mb' }));

  web.use('/templates', require('./routes/web/vcTemplateRoutes'));
  web.use(require('./routes/web/vcRoutes'));
  web.use(require('./routes/web/pdfRoutes'));
  web.use(require('./routes/web/settingsRoutes'));
  web.use(require('./routes/students/studentRoutes'));
  web.use(require('./routes/web/draftVcRoutes'));
  web.use(require('./routes/web/paymentRoutes'));
  web.use(require('./routes/web/claimRoutes'));
  web.use('/stats', require('./routes/web/statsRoutes'));
  web.use(require('./routes/web/auditLogRoutes'));
  
  app.use('/api/web', web);
  app.use('/api/verification-request', require('./routes/mobile/verificationRoutes'));
  // ✅ Mount verification routes directly under /api so paths match the frontend
  app.use('/api', require('./routes/web/verificationRoutes'));
  // Public claims
  app.use('/', require('./routes/web/claimPublicRoutes'));

  // Shared images (user profile images, etc.)
  app.use('/api/images', require('./routes/common/userImageRoutes'));

  // Mobile features (non-user mobile routes)
  app.use('/api/uploads', require('./routes/mobile/uploadRoutes'));
  app.use('/api/vc-requests', require('./routes/mobile/vcRoutes'));
  app.use('/api/mobile', require('./routes/mobile/students'));
  

  // Errors
  app.use(errorHandler);

  const port = process.env.PORT || 5000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
    if (ORIGINS.length) console.log('CORS allow-list:', ORIGINS);
    else console.log('CORS allow-list empty → allowing all origins (dev)');
  });
})();
