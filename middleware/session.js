const session = require('express-session');
const crypto = require('crypto');

const sessionMiddleware = session({
    secret: crypto.randomBytes(32).toString('hex'),
    name: 'sessionId', // Instead of default 'connect.sid'
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true, // Prevents client-side access to the cookie
        secure: process.env.NODE_ENV === 'production', // Requires HTTPS in production
        sameSite: 'strict', // Protects against CSRF
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
});

module.exports = sessionMiddleware;