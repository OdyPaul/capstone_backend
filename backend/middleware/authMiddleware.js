const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
// const User = require('../models/userModel'); // not needed for test

const protect = asyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // Decode token without DB check
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // For testing: assume user is admin
      req.user = {
        id: decoded.id,
        isAdmin: true, // force admin for testing
        name: decoded.name || "Test Admin",
        email: decoded.email || "admin@test.com",
      };

      console.log("Test protect user:", req.user);
      next();
    } catch (error) {
      console.log(error);
      res.status(401);
      throw new Error('Not authorized');
    }
  } else {
    res.status(401);
    throw new Error('Not authorized, no token');
  }
});

const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(401);
    throw new Error('Not authorized as admin');
  }
};

const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode ? res.statusCode : 500;
  res.status(statusCode);
  res.json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

module.exports = {
  protect,
  admin,
  errorHandler,
};
