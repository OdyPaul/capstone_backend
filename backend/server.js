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

  // 2) Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.set('query parser', (str) => qs.parse(str));

  // 3) Health
  app.get('/', (_req, res) => res.send('✅ API is running...'));

  // 4) Routes (deduplicated)
  app.use('/api/web/templates', require('./routes/web/vcTemplateRoutes'));
  app.use('/api/web', require('./routes/web/userRoutes'));           // web users (admin/staff/dev)
  app.use('/api/mobile', require('./routes/mobile/userRoutes'));     // mobile auth/users
  app.use('/api/web', require('./routes/web/vcRoutes'));             // VC: drafts/sign/anchor/etc
  app.use('/api/web', require('./routes/web/pdfRoutes'));            // PDF render/download
  app.use('/api/web', require('./routes/web/settingsRoutes'));       // issuer metadata/settings
  app.use('/api/student', require('./routes/studentRoutes'));        // student queries
  app.use('/api/web', require('./routes/web/draftVcRoutes'));
  
  // mobile feature routes
  app.use('/api/uploads', require('./routes/mobile/uploadRoutes'));  // image uploads
  app.use('/api/vc-requests', require('./routes/mobile/vcRoutes'));  // mobile VC requests
  app.use('/api/verification-request', require('./routes/mobile/verificationRoutes'));

  // Optional: static files
  // app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // 5) Error handler (last)
  app.use(errorHandler);

  // 6) Start
  const port = process.env.PORT || 5000;
  app.listen(port, '0.0.0.0', () =>
    console.log(`🚀 Server running on port ${port}`.yellow.bold)
  );
})();
