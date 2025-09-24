// server.js
const path = require('path');
const express = require('express');
const colors = require('colors');
const cors = require("cors");
require('dotenv').config();

const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

const connectDB = require('./config/db');
const { errorHandler } = require('./middleware/errorMiddleware');

// Connect to MongoDB Atlas
connectDB();
console.log(process.env.MONGO_URI);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/avatar', require('./routes/avatarRoutes'));
app.use('/api/verifications', require('./routes/verificationRoutes'));
app.use("/api/vc-requests", require("./routes/vcRequestRoutes"));
// Error handling middleware
app.use(errorHandler);

// Logger for debugging routes
app.post('/test-upload', (req, res, next) => {
  console.log('Headers:', req.headers);
  next();
}, upload.single('photo'), (req, res) => {
  console.log('req.file:', req.file);
  res.send(req.file ? 'File received' : 'No file received');
});


// Start server
const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () =>
  console.log(`Server running on port ${port}`)
);
