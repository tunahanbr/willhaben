const { check, validationResult } = require('express-validator');
const logger = require('../utils/logger');

const validateUrl = check('url')
    .isURL()
    .withMessage('Invalid URL format')
    .trim();

const validateWebhook = check('webhook')
    .optional()
    .isURL()
    .withMessage('Invalid webhook URL format')
    .trim();

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation error', { errors: errors.array() });
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

module.exports = {
    validateUrl,
    validateWebhook,
    validate
};