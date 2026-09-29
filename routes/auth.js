const express = require('express');
const router = express.Router();
const { signup, login } = require('../controllers/authController');
const { optionalProject } = require('../middleware/requireProject');
const { checkOrigin } = require('../middleware/checkOrigin');

function checkOriginIfProject(req, res, next) {
  if (!req.project) return next(); // legacy demo auth
  return checkOrigin(req, res, next);
}

router.post('/signup', optionalProject, checkOriginIfProject, signup);
router.post('/login', optionalProject, checkOriginIfProject, login);

module.exports = router;
