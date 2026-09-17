const crypto = require('crypto');
const pool = require('../db');

const SESSION_COOKIE = 'arab_session';
const SESSION_HOURS = 8;

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const cookies = {};

    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) continue;

        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        cookies[key] = decodeURIComponent(value);
    }

    return cookies;
}

function setSessionCookie(res, sessionId) {
    const maxAge = SESSION_HOURS * 60 * 60;

    res.setHeader('Set-Cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax`
    );
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie',
        `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
    );
}

async function createSession(userId) {
    const sessionId = crypto.randomBytes(32).toString('hex');

    await pool.query(
        `INSERT INTO public.user_sessions
            (sessionid, userid, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '8 hours')`,
        [sessionId, userId]
    );

    return sessionId;
}

async function destroySession(sessionId) {
    if (!sessionId) return;

    await pool.query(
        `DELETE FROM public.user_sessions WHERE sessionid = $1`,
        [sessionId]
    );
}

async function requireAuth(req, res, next) {
    try {
        const cookies = parseCookies(req);
        const sessionId = cookies[SESSION_COOKIE];

        if (!sessionId) {
            return res.redirect('/login');
        }

        const result = await pool.query(`
            SELECT
                u.userid,
                u.username,
                u.fullname,
                u.role,
                u.officialid,
                u.is_active
            FROM public.user_sessions s
            JOIN public.users u
                ON u.userid = s.userid
            WHERE s.sessionid = $1
              AND s.expires_at > NOW()
              AND u.is_active = TRUE
        `, [sessionId]);

        if (result.rows.length === 0) {
            clearSessionCookie(res);
            return res.redirect('/login');
        }

        req.user = result.rows[0];
        res.locals.currentUser = req.user;

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).send('Authentication error: ' + error.message);
    }
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.redirect('/login');
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).send('Access denied. You do not have permission to access this page.');
        }

        next();
    };
}

module.exports = {
    SESSION_COOKIE,
    clearSessionCookie,
    createSession,
    destroySession,
    requireAuth,
    requireRole,
    setSessionCookie
};
