// controllers/rulesController.js
const asyncHandler = require('express-async-handler');
const RulesConfig = require('../../models/web/rulesConfig');

const getRules = asyncHandler(async (req, res) => {
  let rules = await RulesConfig.findOne({ name: 'default' });
  if (!rules) return res.json({});
  res.json(rules);
});

const upsertRules = asyncHandler(async (req, res) => {
  const body = req.body;
  const updates = {
    issuer: body.issuer,
    idTokens: body.idTokens,
    expirationDuration: body.expirationDuration,
    redirect_uri: body.redirect_uri,
    client_id: body.client_id
  };

  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  const rules = await RulesConfig.findOneAndUpdate({ name: 'default' }, updates, opts);
  res.json(rules);
});

module.exports = { getRules, upsertRules };
