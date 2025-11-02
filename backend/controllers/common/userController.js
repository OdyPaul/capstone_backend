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
// POST /api/mobile/users (Public)
const registerMobileUser = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) { res.status(400); throw new Error('Please add all fields'); }

  const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (exists) { res.status(400); throw new Error('User already exists'); }

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(password, salt);

  const user = await User.create({
    kind: 'mobile',
    role: 'student',
    username,
    email,
    password: hashed,
  });

  res.status(201).json({
    _id: user.id, username: user.username, email: user.email,
    role: user.role, did: user.did ?? null, verified: user.verified ?? 'unverified',
    token: generateToken(user._id),
  });
});

// @desc    Login mobile user
// @route   POST /api/mobile/users/login
// @access  Public
const loginMobileUser = asyncHandler(async (req, res) => {
  const emailNorm = String(req.body.email || '').toLowerCase().trim();
  const { password } = req.body;
  const user = await User.findOne({ email: emailNorm, kind: 'mobile' });
  if (user && await bcrypt.compare(password, user.password)) {
    return res.json({
      _id: user._id, username: user.username, email: user.email,
      role: user.role, verified: user.verified ?? 'unverified', did: user.did ?? null,
      createdAt: user.createdAt, updatedAt: user.updatedAt, token: generateToken(user._id),
    });
  }
  res.status(400); throw new Error('Invalid credentials');
});

// ---------------- WEB CONTROLLERS ----------------


// @desc    Create new web user (admin/superadmin/developer) — SUPERADMIN ONLY
// @route   POST /api/web/users
// @access  Private (superadmin)
// POST /api/web/users (Private: superadmin only)
const registerWebUser = asyncHandler(async (req, res) => {
  const {
    username, email, password, role = 'admin',
    fullName, age, address, gender, contactNo,
    profilePicture,   // optional URL/data-URI (still supported)
    profileImageId,   // 👈 NEW preferred path: points to UserImage
  } = req.body;

  if (!username || !email || !password) { res.status(400); throw new Error('Missing required fields'); }
  if (!['admin','superadmin','developer'].includes(role)) { res.status(400); throw new Error('Invalid role'); }

  const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (exists) { res.status(400); throw new Error('User already exists'); }

  const hashed = await bcrypt.hash(password, 10);

  let profileUrl = profilePicture || null;
  let imgDoc = null;

  if (profileImageId) {
    imgDoc = await UserImage.findById(profileImageId);
    if (!imgDoc) { res.status(400); throw new Error('Invalid profileImageId'); }
    if (imgDoc.purpose !== 'profile') { res.status(400); throw new Error('Image purpose mismatch'); }
    if (imgDoc.ownerUser && imgDoc.ownerUser.toString() !== req.user._id.toString()) {
      // If it’s already attached to some other user, block reuse.
      res.status(409); throw new Error('Image already attached to another user');
    }
    profileUrl = imgDoc.url;
  }

  const user = await User.create({
    kind: 'web',
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

  // If the image was staged, attach it now
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
    }
  });
});



// @desc    Login web user
// @route   POST /api/web/users/login
// @access  Public
const loginWebUser = asyncHandler(async (req, res) => {
  const emailNorm = String(req.body.email || '').toLowerCase().trim();
  const { password } = req.body;
  const user = await User.findOne({ email: emailNorm, kind: 'web' });
  if (user && await bcrypt.compare(password, user.password)) {
    const allowed = ['admin', 'superadmin', 'developer'];
    if (!allowed.includes(user.role)) { res.status(403); throw new Error('Unauthorized role'); }
    return res.json({
      _id: user._id, username: user.username, fullName: user.fullName || null,
      email: user.email, role: user.role,profilePicture: user.profilePicture, token: generateToken(user._id),
    });
  }
  res.status(400); throw new Error('Invalid credentials');
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
  const kind = (req.query.kind || 'web'); // 'web' | 'mobile' | 'all'
  const filter = kind === 'all' ? {} : { kind };
  const users = await User.find(filter).select('-password');
  res.status(200).json(users);
});


// @desc    Update user's DID (wallet address)
// @route   PUT /api/users/:id/did
// @access  Private (only same user or admin)
// controllers/common/userController.js
const updateUserDID = asyncHandler(async (req, res) => {
  const { walletAddress } = req.body;

  const target = await User.findById(req.params.id);
  if (!target) { res.status(404); throw new Error('User not found'); }

  const requesterIsSelf = req.user._id.toString() === target._id.toString();
  const requesterIsPriv = ['admin','superadmin'].includes(req.user.role);

  if (!requesterIsSelf && !requesterIsPriv) {
    res.status(403); throw new Error('Not authorized');
  }

  target.did = walletAddress ? walletAddress : null;
  await target.save();

  res.status(200).json({
    message: target.did ? 'Wallet linked successfully' : 'Wallet disconnected successfully',
    user: target,
  });
});

// controllers/common/userController.js (add this near other handlers)
const logoutWebUser = asyncHandler(async (_req, res) => {
  // stateless JWT → nothing to revoke; this lets requestLogger write an audit row
  res.status(204).end();
});

module.exports = {
  registerMobileUser,
  loginMobileUser,
  registerWebUser,
  loginWebUser,
  getUsers,
  getMe,
  updateUserDID,
  logoutWebUser 
};
