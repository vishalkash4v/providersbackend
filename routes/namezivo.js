const express = require('express');

const router = express.Router();

const namezivoController =
    require('../controllers/namezivo');

const ensureDB =
    require('../middleware/db');


// ============================================================
// DATABASE MIDDLEWARE
// ============================================================

router.use(ensureDB);

router.post(
    '/domain/check',
    namezivoController.check
);
module.exports = router;

