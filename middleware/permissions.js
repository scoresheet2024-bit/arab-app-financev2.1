const pool = require('../db');

/**
 * Role-based access control.
 *
 * IMPORTANT:
 * auth.js preserves the real account role in req.user.role and
 * req.user.actualRole. This middleware therefore checks the real role.
 */
function getUserRole(req) {
    return String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();
}

function requireRoles(...roles) {
    const allowedRoles = roles.map(role =>
        String(role).trim().toLowerCase()
    );

    return (req, res, next) => {
        if (!req.user) {
            return res.redirect('/login');
        }

        const role = getUserRole(req);

        if (!allowedRoles.includes(role)) {
            return res.status(403).send(
                'Access denied. You do not have permission to access this page.'
            );
        }

        next();
    };
}

const adminOnly = requireRoles('admin');
const adminFinance = requireRoles('admin', 'finance');
const allUsers = requireRoles(
    'admin',
    'referee',
    'official',
    'to',
    'finance'
);
const officialOrTO = requireRoles(
    'admin',
    'referee',
    'official',
    'to'
);
const viewAll = requireRoles(
    'admin',
    'referee',
    'official',
    'to',
    'finance'
);

/**
 * Allow only selected HTTP methods for selected roles.
 */
function denyMethods(allowedMethods, roles) {
    const allowedRoles = roles.map(role =>
        String(role).trim().toLowerCase()
    );

    return (req, res, next) => {
        const role = getUserRole(req);

        if (!allowedRoles.includes(role)) {
            return res.status(403).send('Access denied.');
        }

        if (!allowedMethods.includes(req.method)) {
            return res.status(403).send(
                'Access denied. This action is read-only for your role.'
            );
        }

        next();
    };
}

/**
 * Extract a game ID from common game/report URL patterns.
 */
function getGameId(req) {
    const candidates = [
        req.params?.id,
        req.params?.gameId,
        req.params?.gameid,
        req.params?.gameID,
        req.params?.game_id,
        req.params?.idGame
    ];

    for (const value of candidates) {
        const id = Number(value);
        if (Number.isInteger(id) && id > 0) return id;
    }

    const path = String(req.path || req.originalUrl || '');

    const patterns = [
        /\/games\/report\/(\d+)/i,
        /\/games\/(\d+)(?:\/|$)/i,
        /\/game-reports?\/(\d+)(?:\/|$)/i,
        /\/assigned-games\/(\d+)(?:\/|$)/i,
        /\/assignedgames\/(\d+)(?:\/|$)/i
    ];

    for (const pattern of patterns) {
        const match = path.match(pattern);

        if (match) {
            const id = Number(match[1]);

            if (Number.isInteger(id) && id > 0) {
                return id;
            }
        }
    }

    return null;
}

/**
 * Check whether a referee/official/TO is assigned to a game.
 */
async function canSubmitGameReport(req, gameId) {
    if (!req.user) return false;

    const role = getUserRole(req);

    if (role === 'admin') return true;

    if (role === 'finance') return false;

    if (!['referee', 'official', 'to'].includes(role)) {
        return false;
    }

    const officialId = Number(req.user.officialid);

    if (!Number.isInteger(officialId) || officialId <= 0) {
        return false;
    }

    if (!Number.isInteger(Number(gameId)) || Number(gameId) <= 0) {
        return false;
    }

    const result = await pool.query(
        `
        SELECT 1
        FROM public.assignments
        WHERE gameid = $1
          AND officialid = $2
        LIMIT 1
        `,
        [Number(gameId), officialId]
    );

    if (result.rows.length > 0) return true;

    // Compatibility fallback for older games.
    const gameResult = await pool.query(
        `
        SELECT 1
        FROM public.games
        WHERE gameid = $1
          AND (
                official1_id = $2
             OR official2_id = $2
             OR official3_id = $2
             OR scorer_id = $2
             OR timer_id = $2
             OR shot_clock_operator_id = $2
             OR assistant_scorer_id = $2
             OR commissioner_id = $2
          )
        LIMIT 1
        `,
        [Number(gameId), officialId]
    );

    return gameResult.rows.length > 0;
}

/**
 * Allow a user to work with a specific game's report only when
 * they are actually assigned to that game. Admin remains unrestricted.
 */
async function requireAssignedGame(req, res, next) {
    if (!req.user) return res.redirect('/login');

    const gameId = getGameId(req);

    if (!Number.isInteger(gameId) || gameId <= 0) {
        return res.status(400).send('Invalid game ID.');
    }

    try {
        const allowed = await canSubmitGameReport(req, gameId);

        if (allowed) return next();

        const role = getUserRole(req);

        if (role === 'finance') {
            return next();
        }

        if (!['referee', 'official', 'to'].includes(role)) {
            return res.status(403).send('Access denied.');
        }

        return res.status(403).send(
            'Access denied. This game is not assigned to you.'
        );
    } catch (error) {
        console.error('Assignment permission error:', error);
        return res.status(500).send(
            'Unable to verify game assignment.'
        );
    }
}

/**
 * Check whether an official/TO owns a payment record.
 */
async function requireAssignedPaymentOfficial(req, res, next) {
    if (!req.user) return res.redirect('/login');

    const role = getUserRole(req);

    if (role !== 'official' && role !== 'to') {
        return next();
    }

    const officialId = Number(req.user.officialid);

    if (!Number.isInteger(officialId) || officialId <= 0) {
        return res.status(403).send(
            'Your user account is not linked to an official record.'
        );
    }

    const paymentId = Number(
        req.params?.paymentId ||
        req.params?.paymentid ||
        (
            String(req.path || req.originalUrl || '').match(
                /\/finance\/payment-success\/(\d+)/i
            ) || []
        )[1]
    );

    if (!Number.isInteger(paymentId) || paymentId <= 0) {
        return res.status(400).send('Invalid payment ID.');
    }

    try {
        const result = await pool.query(
            `
            SELECT 1
            FROM public.finance_payment_items
            WHERE paymentid = $1
              AND officialid = $2
            LIMIT 1
            `,
            [paymentId, officialId]
        );

        if (result.rows.length === 0) {
            return res.status(403).send(
                'Access denied. This payment does not belong to you.'
            );
        }

        next();
    } catch (error) {
        console.error('Payment permission error:', error);
        res.status(500).send(
            'Unable to verify payment ownership.'
        );
    }
}

module.exports = {
    requireRoles,
    adminOnly,
    adminFinance,
    allUsers,
    officialOrTO,
    viewAll,
    denyMethods,
    requireAssignedGame,
    canSubmitGameReport,
    requireAssignedPaymentOfficial,
    getGameId
};
