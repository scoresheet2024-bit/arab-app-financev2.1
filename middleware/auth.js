const crypto = require('crypto');
const pool = require('../db');

const SESSION_COOKIE = 'arab_session';
const SESSION_HOURS = 8;

/**
 * Parse the browser Cookie header.
 */
function parseCookies(req) {
    const header = req.headers.cookie || '';
    const cookies = {};

    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) continue;

        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();

        try {
            cookies[key] = decodeURIComponent(value);
        } catch (error) {
            cookies[key] = value;
        }
    }

    return cookies;
}

/**
 * Set the ARAB login session cookie.
 */
function setSessionCookie(res, sessionId) {
    const maxAge = SESSION_HOURS * 60 * 60;

    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax`
    );
}

/**
 * Clear the ARAB login session cookie.
 */
function clearSessionCookie(res) {
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
    );
}

/**
 * Create a database-backed login session.
 */
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

/**
 * Destroy one login session.
 */
async function destroySession(sessionId) {
    if (!sessionId) return;

    await pool.query(
        `DELETE FROM public.user_sessions
         WHERE sessionid = $1`,
        [sessionId]
    );
}

/**
 * Require a valid logged-in user.
 *
 * Loads the current user from PostgreSQL and makes it available as:
 *   req.user
 *   res.locals.currentUser
 */
async function requireAuth(req, res, next) {
    try {
        const cookies = parseCookies(req);
        const sessionId = cookies[SESSION_COOKIE];

        if (!sessionId) {
            return res.redirect('/login');
        }

        const result = await pool.query(
            `
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
            `,
            [sessionId]
        );

        if (result.rows.length === 0) {
            clearSessionCookie(res);
            return res.redirect('/login');
        }

        // Preserve the user's real database role.
        // Both role and actualRole now contain the user's actual role.
        // This prevents TO, Finance, Official, Referee, etc. from being
        // incorrectly treated as Admin by routes and views.
        const actualRole = String(result.rows[0].role || '')
            .trim()
            .toLowerCase();

        req.user = {
            ...result.rows[0],
            role: actualRole,
            actualRole: actualRole

        };
        res.locals.currentUser = req.user;

        return next();
    } catch (error) {
        console.error('Authentication error:', error);
        return res
            .status(500)
            .send('Authentication error: ' + error.message);
    }
}

/**
 * Require one of the supplied account roles.
 *
 * Examples:
 *   requireRole('admin')
 *   requireRole('admin', 'finance')
 *   requireRole('official')
 */
function requireRole(...roles) {
    return (req, res, next) => {

        const userRole = String(
            req.user?.actualRole || req.user?.role || ''
        ).trim().toLowerCase();

        const allowedRoles = roles.map(r =>
            String(r).trim().toLowerCase()
        );

        console.log('Allowed:', allowedRoles);
        console.log('User role:', userRole);
console.log('USER:', req.user);
console.log('ROLE:', req.user.role);
console.log('ACTUAL ROLE:', req.user.actualRole);
console.log('PATH:', req.path);

        if (!req.user || !allowedRoles.includes(userRole)) {
            return res.status(403).send('Access denied.');
        }

        next();
    };
}

/**
 * Convenience middleware for the ARAB permission matrix.
 */
const requireAdmin = requireRole('admin');
const requireFinance = requireRole('admin', 'finance');
const requireOfficial = requireRole('official');

/**
 * Check whether the logged-in user has one of the supplied roles.
 * Useful inside routes and EJS views when deciding what to display.
 */
function hasRole(req, ...roles) {
    return Boolean(
        req.user &&
        roles.includes(req.user.role)
    );
}

/**
 * Require the logged-in account to be linked to an official record.
 *
 * This is intentionally separate from requireOfficial so it can also
 * be used for routes where an administrator may be allowed through.
 */
function requireLinkedOfficial(req, res, next) {
    if (!req.user) {
        return res.redirect('/login');
    }

    return next();
}

/**
 * Check whether the logged-in user is linked to a specific official.
 */
function isOwnOfficial(req, officialId) {
    if (!req.user || !req.user.officialid) {
        return false;
    }

    return String(req.user.officialid) === String(officialId);
}

/**
 * Require access to the logged-in user's own official record.
 *
 * Use after requireAuth for routes containing:
 *   req.params.officialid
 *   req.params.id
 * or another official ID that is passed to the middleware.
 *
 * Example:
 *   router.get('/officials/:officialid/activity',
 *       requireOfficial,
 *       requireOwnOfficialParam('officialid'),
 *       handler
 *   );
 */
function requireOwnOfficialParam(paramName = 'officialid') {
    // NORMAL MODE: Admin can access all official records, so all
    // authenticated users receive the same access.
    return (req, res, next) => {
        if (!req.user) return res.redirect('/login');
        return next();
    };
}

module.exports = {
    SESSION_COOKIE,
    SESSION_HOURS,
    parseCookies,
    clearSessionCookie,
    createSession,
    destroySession,
    requireAuth,
    requireRole,
    requireAdmin,
    requireFinance,
    requireOfficial,
    requireLinkedOfficial,
    requireOwnOfficialParam,
    isOwnOfficial,
    hasRole,
    setSessionCookie
};
