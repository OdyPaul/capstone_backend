const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const VcTemplate = require('../../models/web/vcTemplate');

const ensureUniqueKeys = (attributes = []) => {
  const keys = new Set();
  for (const a of attributes) {
    if (!a.key) throw new Error('Attribute missing "key"');
    if (keys.has(a.key)) throw new Error(`Duplicate attribute key: ${a.key}`);
    keys.add(a.key);
  }
};

exports.createTemplate = asyncHandler(async (req, res) => {
  const { name, slug, description, version, attributes, vc, createdBy } = req.body;
  ensureUniqueKeys(attributes || []);
  const doc = await VcTemplate.create({
    name, slug, description, version, attributes, vc, createdBy, status: 'draft'
  });
  res.status(201).json(doc);
});

exports.listTemplates = asyncHandler(async (req, res) => {
  const { q } = req.query;
  let docs = await VcTemplate.find({}).sort({ updatedAt: -1 });

  if (q) {
    const needle = q.toLowerCase();
    docs = docs.filter(d =>
      d.name.toLowerCase().includes(needle) ||
      d.slug.toLowerCase().includes(needle) ||
      (d.description || '').toLowerCase().includes(needle)
    );
  }
  res.json(docs);
});

exports.getTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid id'); }
  const doc = await VcTemplate.findById(id);
  if (!doc) { res.status(404); throw new Error('Template not found'); }
  res.json(doc);
});

exports.updateTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid id'); }
  const doc = await VcTemplate.findById(id);
  if (!doc) { res.status(404); throw new Error('Template not found'); }

  const allowed = ['name', 'slug', 'description', 'version', 'attributes', 'vc', 'createdBy'];
  const updates = {};
  for (const k of allowed) if (Object.prototype.hasOwnProperty.call(req.body, k)) updates[k] = req.body[k];
  if (updates.attributes) ensureUniqueKeys(updates.attributes);

  Object.assign(doc, updates);
  await doc.save();
  res.json(doc);
});

exports.deleteTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid id'); }
  const doc = await VcTemplate.findById(id);
  if (!doc) { res.status(404); throw new Error('Template not found'); }
  await doc.deleteOne();
  res.json(doc);
});

exports.previewTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await VcTemplate.findById(id);
  if (!doc) { res.status(404); throw new Error('Template not found'); }
  res.json({
    _id: doc._id,
    name: doc.name,
    slug: doc.slug,
    version: doc.version,
    lastUpdated: doc.updatedAt,
    attributes: doc.attributes, // [{key,title,type,required,path}]
  });
});
