const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const asyncHandler = require("express-async-handler");
const User = require("../../models/common/userModel");

// ---------------- HELPERS ----------------
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

// ---------------- MOBILE CONTROLLERS ----------------

// @desc    Register new mobile user (student by default)
// @route   POST /api/mobile/users
// @access  Public
const registerMobileUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("Please add all fields");
  }

  const userExist = await User.findOne({ email });
  if (userExist) {
    res.status(400);
    throw new Error("User already exists");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    role: "student", // ✅ always student on mobile
  });

  if (user) {
    res.status(201).json({
      _id: user.id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id),
    });
  } else {
    res.status(400);
    throw new Error("Invalid user data");
  }
});

// @desc    Login mobile user
// @route   POST /api/mobile/users/login
// @access  Public
const loginMobileUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (user && (await bcrypt.compare(password, user.password))) {
    res.json({
      _id: user._id, // use _id to be explicit
      name: user.name,
      email: user.email,
      role: user.role,
      verified: user.verified ?? "unverified",
      did: user.did ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      token: generateToken(user._id),
    });
  } else {
    res.status(400);
    throw new Error("Invalid credentials");
  }
});


// ---------------- WEB CONTROLLERS ----------------

// @desc    Register new web user (role required / defaults to staff)
// @route   POST /api/web/users
// @access  Public
const registerWebUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("Please add all required fields");
  }

  const userExist = await User.findOne({ email });
  if (userExist) {
    res.status(400);
    throw new Error("User already exists");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    role: role || "staff",
  });

  if (user) {
    res.status(201).json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } else {
    res.status(400);
    throw new Error("Invalid user data");
  }
});

// @desc    Login web user
// @route   POST /api/web/users/login
// @access  Public
const loginWebUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (user && (await bcrypt.compare(password, user.password))) {
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } else {
    res.status(400);
    throw new Error("Invalid credentials");
  }
});

// ---------------- SHARED CONTROLLERS ----------------

// @desc    Get logged-in user profile
// @route   GET /api/.../users/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  res.status(200).json(req.user);
});

// @desc    Get all users (Web admin only)
// @route   GET /api/web/users
// @access  Private/Admin
const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select("-password");
  res.status(200).json(users);
});


// @desc Update user's DID (wallet address)
// @route PUT /api/users/:id/did
// @access Private (only same user or admin)
const updateUserDID = asyncHandler(async (req, res) => {
  const { walletAddress } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // ✅ Allow only the same user or an admin
  if (req.user._id.toString() !== user._id.toString() && req.user.role !== "admin") {
    res.status(403);
    throw new Error("Not authorized");
  }

  // ✅ Allow unlinking (walletAddress = null)
  if (walletAddress === null || walletAddress === "") {
    user.did = null;
  } else {
    user.did = walletAddress;
  }

  await user.save();

  res.status(200).json({
    message: walletAddress ? "Wallet linked successfully" : "Wallet disconnected successfully",
    user,
  });
});

module.exports = {
  // Mobile
  registerMobileUser,
  loginMobileUser,
  updateUserDID,
  // Web
  registerWebUser,
  loginWebUser,
  getUsers,

  // Shared
  getMe,
};
