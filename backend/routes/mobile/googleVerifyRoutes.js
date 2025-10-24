const express = require('express');
const router = express.Router();
const googleCtrl =require('../../controllers/mobile/googleVerify') 




router.post("/verify-gmail",googleCtrl.verifyGoogleAccount )