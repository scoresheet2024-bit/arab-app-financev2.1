const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const {
    clearSessionCookie,
    createSession,
    destroySession,
    setSessionCookie,
    SESSION_COOKIE
} = require('../middleware/auth');

const router = express.Router();

function verifyPassword(password, storedHash) {
    const [algorithm, salt, keyHex] = String(storedHash).split('$');

    if (algorithm !== 'scrypt' || !salt || !keyHex) {
        return false;
    }

    const derivedKey = crypto.scryptSync(password, salt, 64);
    const storedKey = Buffer.from(keyHex, 'hex');

    return storedKey.length === derivedKey.length &&
        crypto.timingSafeEqual(storedKey, derivedKey);
}

// ======================================================
// LOGIN PAGE
// ======================================================

router.get('/login', (req, res) => {
    res.render('auth/login', {
        title: 'Login',
        error: null,
        username: ''
    });
});

// ======================================================
// LOGIN
// ======================================================

router.post('/login', async (req, res) => {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!username || !password) {
        return res.status(400).render('auth/login', {
            title: 'Login',
            error: 'Username and password are required.',
            username
        });
    }

    try {
        const result = await pool.query(`
            SELECT
                userid,
                username,
                fullname,
                role,
                officialid,
                password_hash,
                is_active
            FROM public.users
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
        `, [username]);

        const user = result.rows[0];

        if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
            return res.status(401).render('auth/login', {
                title: 'Login',
                error: 'Invalid username or password.',
                username
            });
        }

        const sessionId = await createSession(user.userid);
        setSessionCookie(res, sessionId);

        res.redirect('/');
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).render('auth/login', {
            title: 'Login',
            error: 'Unable to log in. Please try again.',
            username
        });
    }
});

// ======================================================
// LOGOUT
// ======================================================

router.post('/logout', async (req, res) => {
    try {
        const header = req.headers.cookie || '';
        const cookie = header.split(';')
            .map(item => item.trim())
            .find(item => item.startsWith(`${SESSION_COOKIE}=`));

        const sessionId = cookie
            ? decodeURIComponent(cookie.substring(SESSION_COOKIE.length + 1))
            : null;

        await destroySession(sessionId);
        clearSessionCookie(res);
        res.redirect('/login');
    } catch (error) {
        console.error('Logout error:', error);
        clearSessionCookie(res);
        res.redirect('/login');
    }
});

module.exports = router;
