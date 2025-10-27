// middleware/paramPollutionGuard.js
module.exports = function paramPollutionGuard(whitelist = []) {
  return function (req, _res, next) {
    const q = req.query || {};
    for (const k of Object.keys(q)) {
      const v = q[k];
      // if it came as repeated ?k=a&k=b, Express gives you an array
      if (Array.isArray(v) && !whitelist.includes(k)) {
        q[k] = v[v.length - 1]; // keep last
      }
    }
    next();
  };
};
