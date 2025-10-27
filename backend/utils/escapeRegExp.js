// utils/escapeRegExp.js
module.exports = function escapeRegExp(s = '') {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};
