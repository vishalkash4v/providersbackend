const express = require('express');

const router =
  express.Router();

const uploadController =
  require('../controllers/extras');


const ensureDB =
    require('../middleware/db');


// ============================================================
// DATABASE MIDDLEWARE
// ============================================================

router.use(ensureDB);

router.post(
  '/upload',  
  uploadController.upload
);

module.exports = router;