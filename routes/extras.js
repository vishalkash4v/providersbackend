const express = require('express');

const router =
  express.Router();

const uploadController =
  require('../controllers/extras');

const {
  authenticateToken,
} = require('../middleware/jwt');

router.post(
  '/upload',
  authenticateToken,
  uploadController.upload
);

module.exports = router;