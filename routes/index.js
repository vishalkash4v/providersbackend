var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('welcome', {
    title: 'Provider Backend App',
    env: process.env.NODE_ENV || 'development'
  });
});

module.exports = router;