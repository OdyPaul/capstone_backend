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
  // 1) Connect to all DBs before mounting routes
  await connectAll();

  const app = express();

  // If running behind Render/Proxy, this helps with some header handling
  app.set('trust proxy', 1);

  // 2) CORS — put this BEFORE all routes and before most middleware
  // You can set CORS_ORIGINS="http://localhost:5173,https://your-frontend.example"
  const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Ensure caches/proxies treat per-origin responses separately
  app.use((req, res, next) => {
    res.header('Vary', 'Origin');
    next();
  });

  app.use(cors({
    origin(origin, cb) {
      // Allow non-browser clients (no Origin) and configured origins
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false, // set true only if you send cookies
  }));

  // Fast-path for preflight
  app.options('*', cors());
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // 3) Standard middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.set('query parser', (str) => qs.parse(str));

  // 4) Health
  app.get('/', (_req, res) => res.send('✅ API is running...'));

  // 5) Routes
  app.use('/api/web/templates', require('./routes/web/vcTemplateRoutes'));

  app.use('/api/web', require('./routes/web/userRoutes'));           // web users (admin/staff/dev)
  app.use('/api/mobile', require('./routes/mobile/userRoutes'));     // mobile auth/users

  app.use('/api/web', require('./routes/web/vcRoutes'));             // VC: drafts/sign/anchor/etc
  app.use('/api/web', require('./routes/web/pdfRoutes'));            // PDF render/download
  app.use('/api/web', require('./routes/web/settingsRoutes'));       // issuer metadata/settings

  // student queries
  app.use('/api/web/student', require('./routes/studentRoutes'));
  app.use('/api/web', require('./routes/web/draftVcRoutes'));

  // mobile feature routes
  app.use('/api/uploads', require('./routes/mobile/uploadRoutes'));  // image uploads
  app.use('/api/vc-requests', require('./routes/mobile/vcRoutes'));  // mobile VC requests
  app.use('/api/verification-request', require('./routes/mobile/verificationRoutes'));

  // Optional: static files
  // app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // 6) Error handler (last)
  app.use(errorHandler);

  // 7) Start
  const port = process.env.PORT || 5000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`.yellow.bold);
    console.log('CORS allowed origins:', ALLOWED_ORIGINS);
  });
})();
