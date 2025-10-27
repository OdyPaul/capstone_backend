// routes/studentRoutes.js
const express = require("express");
const router = express.Router();
const { getStudentPassing, getStudentTor, searchStudent, findStudent } = require("../controllers/web/studentController");
const { protect } = require("../middleware/authMiddleware");
const { rateLimitRedis } = require("../middleware/rateLimitRedis");
const { z, validate } = require('../middleware/validate');

// shared query rules
const queryCommon = {
  q: z.string().trim().max(64).optional(),
  college: z.string().trim().max(64).optional(),
  programs: z.union([
    z.string().trim().max(64),
    z.array(z.string().trim().max(64)).max(20)
  ]).optional(),
};

// passing expects year, search doesn’t strictly need it
const passingSchema = { query: z.object({
  ...queryCommon,
  year: z.union([z.literal('All'), z.coerce.number().int().min(1900).max(2100)]).optional(),
}).strip() };

const searchSchema = { query: z.object({
  ...queryCommon,
}).strip() };

// /passing: validate → rate-limit → controller
router.get(
  "/passing",
  protect,
  validate(passingSchema),
  rateLimitRedis({
    prefix: 'rl:student:passing',
    windowMs: 60_000,
    max: 60,
    keyFn: (req) => req.user?._id?.toString() || req.ip
  }),
  getStudentPassing
);

// /search: validate → rate-limit → controller
router.get(
  "/search",
  protect,
  validate(searchSchema),
  rateLimitRedis({
    prefix:'rl:student:search',
    windowMs:60_000,
    max:30,
    keyFn:(req)=> req.user?._id?.toString() || req.ip
  }),
  searchStudent
);

router.get("/:id/tor", protect, getStudentTor);
router.get("/:id", protect, findStudent);

module.exports = router;
