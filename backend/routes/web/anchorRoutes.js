const express = require("express");
const router = express.Router();

const anchor = require("../../controllers/web/anchorController");
const { protect, admin } = require("../../middleware/authMiddleware");

let rateLimitRedis;
try {
  ({ rateLimitRedis } = require("../../middleware/rateLimitRedis"));
} catch {}
const RL = rateLimitRedis
  ? rateLimitRedis({ prefix: "rl:anchor", windowMs: 60_000, max: 120 })
  : (_req, _res, next) => next();

/**
 * IMPORTANT:
 * server.js mounts this router with:
 *   app.use('/api/web', web)
 *   web.use(require('./routes/web/anchorRoutes'))
 *
 * Therefore every path here MUST begin with `/anchor/...`
 * so that the final URL is `/api/web/anchor/...`.
 */

// Health check (no auth) — to verify router is mounted correctly
router.get("/anchor/_alive", (_req, res) =>
  res.json({ ok: true, scope: "anchor", at: new Date().toISOString() })
);

// Queue only (do NOT mint right away)
router.post(
  "/anchor/now/:credId",
  protect,
  admin,
  RL,
  anchor.requestNow
);

// List queue (mode: all|now|batch; approved: all|true|false)
router.get(
  "/anchor/queue",
  protect,
  admin,
  RL,
  anchor.listQueue
);

// Approve queued (approved_mode: 'single' | 'batch')
router.post(
  "/anchor/approve",
  protect,
  admin,
  RL,
  anchor.approveQueued
);

// Run a single anchored leaf (requires approved_mode === 'single')
router.post(
  "/anchor/run-single/:credId",
  protect,
  admin,
  RL,
  anchor.runSingle
);

// Mint batch — controller reads req.query (e.g., ?mode=now|batch|all)
router.post(
  "/anchor/mint-batch",
  protect,
  admin,
  RL,
  anchor.mintBatch
);

// Non-"now" items by age window (?minDays=0&maxDays=15 etc.)
router.get(
  "/anchor/non-now",
  protect,
  admin,
  RL,
  anchor.listNonNowAged
);

// List anchored batches
router.get(
  "/anchor/batches",
  protect,
  admin,
  RL,
  anchor.listBatches
);

// ---------- NEW: candidates & mint-selected ----------

// Simple list of active, not-anchored issued credentials (for UI)
router.get(
  "/anchor/candidates",
  protect,
  admin,
  RL,
  anchor.listCandidates
);

// Mint a selected set of credential IDs as a single batch
router.post(
  "/anchor/mint-selected",
  protect,
  admin,
  RL,
  anchor.mintSelected
);

module.exports = router;
