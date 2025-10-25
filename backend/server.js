// backend/server.js
const path = require('path');
const express = require('express');
const colors = require('colors');
const cors = require('cors');
const qs = require('qs');
require('dotenv').config();

const { connectAll } = require('./config/db');
const { errorHandler } = require('./middleware/errorMiddleware');

(async () => {
  await connectAll();

  const app = express();

  // ---- CORS ---------------------------------------------------------------
  // Comma-separated list of allowed web origins (e.g. "http://localhost:5173")
  const ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const corsOptions = {
    origin(origin, cb) {
      // allow non-browser requests (curl, server-to-server)
      if (!origin) return cb(null, true);
      // if no env set, allow everything (dev)
      if (ORIGINS.length === 0) return cb(null, true);
      // strict allow-list
      if (ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: false, // set true only if you use cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));
  // IMPORTANT: avoid bare "*" with Express’ path-to-regexp; use a regex:
  app.options(/.*/, cors(corsOptions));
  // ------------------------------------------------------------------------

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.set('query parser', (str) => qs.parse(str));

  // Health
  app.get('/', (_req, res) => res.send('✅ API is running...'));

  // Routes
  app.use('/api/web/templates', require('./routes/web/vcTemplateRoutes'));
  app.use('/api/web', require('./routes/web/userRoutes'));           // web users (admin/staff/dev)
  app.use('/api/mobile', require('./routes/mobile/userRoutes'));     // mobile auth/users
  app.use('/api/web', require('./routes/web/vcRoutes'));             // VC: drafts/sign/anchor/etc
  app.use('/api/web', require('./routes/web/pdfRoutes'));            // PDF render/download
  app.use('/api/web', require('./routes/web/settingsRoutes'));       // issuer metadata/settings
  app.use('/api/web/student', require('./routes/studentRoutes'));    // student queries
  app.use('/api/web', require('./routes/web/draftVcRoutes'));
  app.use('/api/web', require('./routes/web/paymentRoutes'));
  app.use('/api/web', require('./routes/web/claimRoutes'));

  app.use('/',        require('./routes/web/claimPublicRoutes'));



  // Mobile feature routes
  app.use('/api/uploads', require('./routes/mobile/uploadRoutes'));  // image uploads
  app.use('/api/vc-requests', require('./routes/mobile/vcRoutes'));  // mobile VC requests
  app.use('/api/verification-request', require('./routes/mobile/verificationRoutes'));
  

  // Optional static files
  // app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // Errors (last)
  app.use(errorHandler);

  const port = process.env.PORT || 5000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`.yellow.bold);
    if (ORIGINS.length) {
      console.log('CORS allow-list:', ORIGINS);
    } else {
      console.log('CORS allow-list empty → allowing all origins (dev)');
    }
  });
})();
