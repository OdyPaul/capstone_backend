const express = require('express');
const router = express.Router();
const googleCtrl =require('../../controllers/mobile/googleVerify') 
const rateLimit = require('../../middleware/rateLimit'); 



router.post("/verify-gmail", rateLimit(),googleCtrl.verifyGoogleAccount )