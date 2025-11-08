// routes/web/anchorRoutes.js
const express = require('express');
const router = express.Router();

const anchor = require('../../controllers/web/anchorController');
const { protect, admin } = require('../../middleware/authMiddleware');

let rateLimitRedis;
try { ({ rateLimitRedis } = require('../../middleware/rateLimitRedis')); } catch {}
const RL = rateLimitRedis
  ? rateLimitRedis({ prefix: 'rl:anchor', windowMs: 60_000, max: 120 })
  : (_req,_res,next)=>next();

// Queue only (do NOT mint right away)
router.post('/anchor/now/:credId', protect, admin, RL, anchor.requestNow);

// List queue (mode: all|now|batch; approved: all|true|false)
router.get('/anchor/queue', protect, admin, RL, anchor.listQueue);

// Approve queued (approved_mode: 'single' | 'batch')
router.post('/anchor/approve', protect, admin, RL, anchor.approveQueued);

// Run a single anchored leaf (requires approved_mode === 'single')
router.post('/anchor/run-single/:credId', protect, admin, RL, anchor.runSingle);

// Mint batch — supports ?mode=now|batch|all (controller must read req.query.mode)
router.post('/anchor/mint-batch', protect, admin, RL, anchor.mintBatch);

// ✅ NEW: Non-"now" items by age window (e.g., ?minDays=0&maxDays=15 or 15&30)
router.get('/anchor/non-now', protect, admin, RL, anchor.listNonNowAged);

module.exports = router;
