const express = require('express');
const path = require('path');

const dashboardRoutes = require('./routes/dashboard');
const officialsRoutes = require('./routes/officials');
const gamesRoutes = require('./routes/games');
const assignedGamesRoutes = require('./routes/assignedGames');
const competitionsRoutes = require('./routes/competitions');
const statisticsRoutes = require('./routes/statistics');
const gameReportsRoutes = require('./routes/gameReports');
const officialActivityRoutes = require('./routes/officialActivity');
const financeRoutes = require('./routes/finance');
const usersRoutes = require('./routes/users');
const availabilityRoutes = require('./routes/availability');
const authRoutes = require('./routes/auth');

const { uploadDir } = require('./middleware/upload');
const { requireAuth } = require('./middleware/auth');
const {
    requireRoles,
    adminOnly,
    adminFinance,
    allUsers,
    officialOrTO,
    viewAll,
    requireAssignedGame,
    requireAssignedPaymentOfficial
} = require('./middleware/permissions');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Public authentication.
app.use('/', authRoutes);

// Every route below this line requires a valid session.
app.use(requireAuth);

// ======================================================
// PAGE RESTRICTION FOR NON-ADMIN USERS
// ------------------------------------------------------
// Admin keeps full access to the application.
// Non-admin users may access only: Dashboard, Games,
// Assigned Games, and the existing Official Activity section.
// Official Activity is intentionally left unchanged, including
// its existing sub-pages.
// ======================================================
function restrictedPageAccess(req, res, next) {
    const actualRole = String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();

    // Admin has full access to every application route.
    if (actualRole === 'admin') {
        return next();
    }

    const pathName = String(req.path || '/');

    // Dashboard
    if (pathName === '/' || pathName === '/dashboard') {
        return next();
    }

    // Games — exact page only for non-admin users.
    if (pathName === '/games') {
        return next();
    }

    // Assigned Games — exact page only for non-admin users.
    if (pathName === '/assigned-games') {
        return next();
    }

    // My Availability is available to linked Official/T.O accounts.
    if (pathName === '/my-availability') {
        return next();
    }

    // Official Activity is deliberately unchanged.
    if (pathName === '/official-activity' ||
        pathName.startsWith('/official-activity/')) {
        return next();
    }
   // Game Reports
if (
    pathName === '/game/reports' ||
    pathName.startsWith('/game/reports/') ||
    pathName.startsWith('/games/report/') ||
    pathName.startsWith('/game-reports/')
) {
    return next();
}

    return res.status(403).send('Access denied. You do not have permission to access this page.');
}

app.use(restrictedPageAccess);

// Uploaded files are protected by login.
app.use('/uploads', express.static(uploadDir));

// ======================================================
// MY AVAILABILITY
// ======================================================
app.use('/', availabilityRoutes);

// ======================================================
// DASHBOARD — all authenticated roles
// ======================================================
app.use('/', viewAll, dashboardRoutes);

// ======================================================
// OFFICIALS
// Matrix: Admin full; Official/TO view; Finance view.
// ======================================================
function officialsAccess(req, res, next) {
    if (req.method === 'GET') return allUsers(req, res, next);
    return adminOnly(req, res, next);
}
app.use('/', officialsAccess, officialsRoutes);

// ======================================================
// GAME REPORTS
// Admin/Finance: view all.
// Referee/Official/TO: only reports for games where they are crew.
// ======================================================
async function gameReportAccess(req, res, next) {
    if (req.user.role === 'admin' || req.user.role === 'finance') return next();

    if (['referee', 'official', 'to'].includes(
        String(req.user.actualRole || req.user.role || '').trim().toLowerCase()
    )) {
        // Router params are not populated yet because this middleware is
        // mounted before the router. Use the URL path instead.
        if (req.path.startsWith('/games/report/')) {
            return requireAssignedGame(req, res, next);
        }
        return next();
    }

    return res.status(403).send('Access denied.');
}
app.use('/', gameReportAccess, gameReportsRoutes);

// ======================================================
// GAMES
// Admin: full access.
// Official/TO: only assigned-game functions/documents/reports.
// Finance: read-only game/report access.
// ======================================================
async function gamesAccess(req, res, next) {
    const role = req.user.role;

    // Admin has complete game management access.
    if (role === 'admin') return next();

    // Finance has read-only access to game information.
    if (role === 'finance') {
        if (req.method !== 'GET') {
            return res.status(403).send('Access denied. Finance access to Games is read-only.');
        }
        // Only document/report viewing is useful from this route for Finance.
        if (req.path.startsWith('/games/report/') || req.path.includes('/documents')) return next();
        return res.status(403).send('Access denied.');
    }

    // Official/TO: send the main Games menu to their own assigned games.
    // The /games page is the admin unassigned-game queue, so officials
    // should not be blocked there with an access-denied message.
    if (role === 'official' || role === 'to') {
        if (req.path === '/games' || req.path === '/games/') {
            return res.redirect('/assigned-games');
        }

        // Assigned reports/documents must belong to the logged-in official.
        if (req.path.startsWith('/games/report/')) {
            return requireAssignedGame(req, res, next);
        }

        if (req.path.includes('/documents')) {
            return requireAssignedGame(req, res, next);
        }

        // Game creation/assignment remains Admin-only.
        if (req.path.startsWith('/games/new') ||
            req.path.startsWith('/games/assign')) {
            return res.status(403).send('Access denied. Game management is restricted to administrators.');
        }

        return res.status(403).send('Access denied.');
    }

    return res.status(403).send('Access denied.');
}
app.use('/', gamesAccess, gamesRoutes);

// ======================================================
// ASSIGNED GAMES
// Admin full; Official/TO assigned; Finance view.
// ======================================================
app.use('/', viewAll, assignedGamesRoutes);

// ======================================================
// COMPETITIONS
// Admin/TO full; Finance view; Official no access.
// ======================================================
function competitionsAccess(req, res, next) {
    if (req.user.role === 'admin') return next();
    if (req.user.role === 'to' && req.method === 'GET') return next();
    return res.status(403).send('Access denied. You do not have permission to access Competitions.');
}
app.use('/', competitionsAccess, competitionsRoutes);

// ======================================================
// STATISTICS
// Admin full; Official/TO own; Finance view.
// ======================================================
app.use('/', viewAll, statisticsRoutes);

// ======================================================
// OFFICIAL ACTIVITY
// Admin full; Official/TO own; Finance view.
// ======================================================
app.use('/', viewAll, officialActivityRoutes);

// ======================================================
// FINANCE
// Admin/Finance full; Official/TO own status/history only.
// ======================================================
function financeAccess(req, res, next) {
    const role = req.user.role;

    if (role === 'admin' || role === 'finance') return next();

    if (role === 'official' || role === 'to') {
        // Official/TO are strictly read-only in Finance.
        if (req.method !== 'GET') {
            return res.status(403).send('Access denied. Your Finance access is read-only.');
        }

        // Payment history and payment transaction pages are allowed,
        // but ownership is checked for a specific payment below.
        if (req.path.startsWith('/finance/payment-success/')) {
            return requireAssignedPaymentOfficial(req, res, next);
        }
        return next();
    }

    return res.status(403).send('Access denied.');
}
app.use('/', financeAccess, financeRoutes);

// ======================================================
// USER MANAGEMENT — Admin only.
// ======================================================
app.use('/', adminOnly, usersRoutes);

app.use((req, res) => {
    res.status(404).send('Page not found.');
});

app.use((err, req, res, next) => {
    console.error('Application error:', err);
    if (res.headersSent) return next(err);
    res.status(500).send('Internal Server Error: ' + err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
