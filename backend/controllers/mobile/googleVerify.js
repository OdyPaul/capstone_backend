//controllers/mobile/googleVerify.js
const {OAuth2Client} = require('google-auth-library');
const asyncHandler = require('express-async-handler');

const client = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);

exports.verifyGoogleAccount = asyncHandler(async (req, res) => {
  const {idToken} = req.body;
  if (!idToken) {
    res.status(400);
    throw new Error("Missing Google ID token");
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_WEB_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (!payload?.email || !payload?.email_verified) {
    res.status(400);
    throw new Error("Invalid or unverified Gmail");
  }

  res.json({
    success: true,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  });
});
