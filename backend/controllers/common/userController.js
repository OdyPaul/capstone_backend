const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const asyncHandler = require("express-async-handler");
const User = require("../../models/common/userModel");
const UserImage = require('../../models/common/userImageModel');

// ---------------- HELPERS ----------------
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// ---------------- MOBILE CONTROLLERS ----------------

// @desc    Register new mobile user (student by default)
// @route   POST /api/mobile/users
// @access  Public
const registerMobileUser = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    res.status(400);
    throw new Error("Please add all fields");
  }

  const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (exists) {
    res.status(400);
    throw new Error("User already exists");
  }

  const hashed = await bcrypt.hash(password, 10);

  const user = await User.create({
    kind: "mobile",
    role: "student",
    username,
    email,
    password: hashed,
  });

  res.status(201).json({
    _id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    verified: user.verified ?? "unverified",
    token: generateToken(user._id),
  });
});

// @desc    Login mobile user
// @route   POST /api/mobile/users/login
// @access  Public
const loginMobileUser = asyncHandler(async (req, res) => {
  const emailNorm = String(req.body.email || "").toLowerCase().trim();
  const { password } = req.body;

  const user = await User.findOne({ email: emailNorm, kind: "mobile" });
  if (user && (await bcrypt.compare(password, user.password))) {
    return res.json({
      _id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      verified: user.verified ?? "unverified",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      token: generateToken(user._id),
    });
  }

  res.status(400);
  throw new Error("Invalid credentials");
});

// ---------------- WEB CONTROLLERS ----------------

// @desc    Create new web user (admin/superadmin/developer) — SUPERADMIN ONLY
// @route   POST /api/web/users
// @access  Private (superadmin)
const registerWebUser = asyncHandler(async (req, res) => {
  const {
    username,
    email,
    password,
    role = "admin",
    fullName,
    age,
    address,
    gender,
    contactNo,
    profilePicture,
    profileImageId,
  } = req.body;

  if (!username || !email || !password) {
    res.status(400);
    throw new Error("Missing required fields");
  }

  if (!["admin", "superadmin", "developer"].includes(role)) {
    res.status(400);
    throw new Error("Invalid role");
  }

  const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (exists) {
    res.status(400);
    throw new Error("User already exists");
  }

  const hashed = await bcrypt.hash(password, 10);

  let profileUrl = profilePicture || null;
  let imgDoc = null;

  if (profileImageId) {
    imgDoc = await UserImage.findById(profileImageId);
    if (!imgDoc) {
      res.status(400);
      throw new Error("Invalid profileImageId");
    }
    if (imgDoc.purpose !== "profile") {
      res.status(400);
      throw new Error("Image purpose mismatch");
    }
    if (imgDoc.ownerUser) {
      res.status(409);
      throw new Error("Image already attached to another user");
    }
    profileUrl = imgDoc.url;
  }

  const user = await User.create({
    kind: "web",
    role,
    username,
    email,
    password: hashed,
    fullName,
    age,
    address,
    gender,
    contactNo,
    profilePicture: profileUrl || undefined,
  });

  if (imgDoc) {
    imgDoc.ownerUser = user._id;
    await imgDoc.save();
  }

  res.status(201).json({
    user: {
      _id: user._id,
      username: user.username,
      fullName: user.fullName || null,
      age: user.age ?? null,
      address: user.address || null,
      gender: user.gender || null,
      contactNo: user.contactNo || null,
      profilePicture: user.profilePicture || null,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

// @desc    Login web user
// @route   POST /api/web/users/login
// @access  Public
const loginWebUser = asyncHandler(async (req, res) => {
  const emailNorm = String(req.body.email || "").toLowerCase().trim();
  const { password } = req.body;

  const user = await User.findOne({ email: emailNorm, kind: "web" });

  if (user && (await bcrypt.compare(password, user.password))) {
    const allowed = ["admin", "superadmin", "developer"];
    if (!allowed.includes(user.role)) {
      res.status(403);
      throw new Error("Unauthorized role");
    }

    return res.json({
      _id: user._id,
      username: user.username,
      fullName: user.fullName || null,
      email: user.email,
      role: user.role,
      profilePicture: user.profilePicture,
      token: generateToken(user._id),
    });
  }

  res.status(400);
  throw new Error("Invalid credentials");
});

// @desc    Update a web user
// @route   PUT /api/web/users/:id
// @access  Private
const updateWebUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const target = await User.findById(id);
  if (!target) {
    res.status(404);
    throw new Error("User not found");
  }
  if (target.kind !== "web") {
    res.status(400);
    throw new Error("Only web users can be edited here");
  }

  const requester = req.user;
  const isSuperadmin = requester.role === "superadmin";
  const isSelf = requester._id.toString() === target._id.toString();

  if (!isSuperadmin && !isSelf) {
    res.status(403);
    throw new Error("Not authorized");
  }

  const body = req.body?.data || req.body || {};

  const currentPassword =
    body.currentPassword ?? body.passwordCurrent ?? body.adminPassword ?? null;

  if (isSuperadmin) {
    if (!currentPassword) {
      res.status(401);
      throw new Error("Current password required");
    }

    const freshRequester = await User.findById(requester._id);
    const ok = await bcrypt.compare(String(currentPassword), freshRequester.password || "");
    if (!ok) {
      res.status(401);
      throw new Error("Invalid current password");
    }
  }

  const {
    username,
    fullName,
    age,
    address,
    gender,
    email,
    password,
    contactNo,
    role,
    profilePicture,
    profileImageId,
  } = body;

  if (!isSuperadmin && typeof role !== "undefined" && role !== target.role) {
    res.status(403);
    throw new Error("Only superadmin can change role");
  }

  if (username !== undefined) target.username = username;
  if (fullName !== undefined) target.fullName = fullName;
  if (age !== undefined) target.age = age;
  if (address !== undefined) target.address = address;
  if (gender !== undefined) target.gender = gender;
  if (email !== undefined) target.email = email;
  if (contactNo !== undefined) target.contactNo = contactNo;
  if (isSuperadmin && role !== undefined) target.role = role;

  if (password && String(password).trim().length > 0) {
    target.password = await bcrypt.hash(password, 10);
  }

  let imgDoc = null;
  if (profileImageId) {
    imgDoc = await UserImage.findById(profileImageId);
    if (!imgDoc) {
      res.status(400);
      throw new Error("Invalid profileImageId");
    }
    if (imgDoc.purpose !== "profile") {
      res.status(400);
      throw new Error("Image purpose mismatch");
    }
    if (imgDoc.ownerUser && imgDoc.ownerUser.toString() !== target._id.toString()) {
      res.status(409);
      throw new Error("Image already attached to another user");
    }
    target.profilePicture = imgDoc.url;
  } else if (profilePicture !== undefined) {
    target.profilePicture = profilePicture || null;
  }

  await target.save();
  if (imgDoc) {
    imgDoc.ownerUser = target._id;
    await imgDoc.save();
  }

  const safe = await User.findById(target._id).select("-password");
  res.status(200).json({ user: safe });
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
  const kind = req.query.kind || "web"; // 'web' | 'mobile' | 'all'
  const filter = kind === "all" ? {} : { kind };
  const users = await User.find(filter).select("-password");
  res.status(200).json(users);
});

// @desc    Logout (JWT is stateless, nothing to revoke)
// @route   POST /api/web/users/logout
// @access  Private
const logoutWebUser = asyncHandler(async (_req, res) => {
  res.status(204).end();
});

module.exports = {
  registerMobileUser,
  loginMobileUser,
  registerWebUser,
  updateWebUser,
  loginWebUser,
  getUsers,
  getMe,
  logoutWebUser,
};
