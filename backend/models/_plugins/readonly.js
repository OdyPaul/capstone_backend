// models/_plugins/readonly.js
module.exports = function readonlyPlugin(schema, opts = { modelName: 'This model' }) {
  const block = (next) => next(new Error(`${opts.modelName} is read-only on this connection`));

  // doc middlewares
  schema.pre('save', block);
  schema.pre('remove', block);
  schema.pre('deleteOne', { document: true, query: false }, block);

  // query middlewares
  schema.pre('updateOne', block);
  schema.pre('updateMany', block);
  schema.pre('findOneAndUpdate', block);
  schema.pre('insertMany', block);
  schema.pre('deleteOne', { document: false, query: true }, block);
  schema.pre('deleteMany', block);
};
