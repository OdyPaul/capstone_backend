const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const User = require("../models/common/userModel"); // ✅ adjust path if needed

// Protect routes (any logged-in user)
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = await User.findById(decoded.id).select("-password");

      if (!req.user) {
        res.status(401);
        throw new Error("User not found");
      }

      next();
    } catch (error) {
      console.error(error);
      res.status(401);
      throw new Error("Not authorized, token failed");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token");
  }
});

// Admin-only
const admin = (req, res, next) => {
  if (req.user && (req.user.role === "admin" || req.user.role === "superadmin")) {
    next();
  } else {
    res.status(401);
    throw new Error("Not authorized as admin or superadmin");
  }
};


// Mobile student-only
const mobileUser = (req, res, next) => {
  if (req.user && req.user.role === "student") {
    next();
  } else {
    res.status(403);
    throw new Error("Not authorized (students only)");
  }
};

const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user) {
    res.status(401);
    throw new Error('Not authenticated');
  }
  if (!roles.includes(req.user.role)) {
    res.status(403);
    throw new Error('Forbidden: insufficient role');
  }
  next();
};
module.exports = {
  protect,
  admin,
  mobileUser,
  allowRoles,
};
