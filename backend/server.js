const path = require('path');
const express = require('express');
const colors = require('colors');
const cors = require("cors");
require('dotenv').config();

const connectDB = require('./config/db');
const { errorHandler } = require('./middleware/errorMiddleware');

// Connect to MongoDB
connectDB();

const app = express();

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------- Routes ----------
app.use('/api/web', require('./routes/userRoutes'));      // Web users (admin/staff/dev)
app.use('/api/mobile', require('./routes/mobileRoutes')); // Mobile app routes (students, avatars, vcRequests)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// ---------- Error handler (must be last) ----------
app.use(errorHandler);

// ---------- Start server ----------
const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () =>
  console.log(`🚀 Server running on port ${port}`.yellow.bold)
);
