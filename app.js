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

    // FINANCE — Finance users may access every page under /finance.
    // This is deliberately limited to the Finance route so no other
    // user's permissions are changed. The finance router still applies
    // its own role checks to every Finance endpoint.
    if (actualRole === 'finance' && (
        pathName === '/finance' ||
        pathName.startsWith('/finance/')
    )) {
        return next();
    }

    // Dashboard
    if (pathName === '/' || pathName === '/dashboard') {
        return next();
    }

    // GAMES — all authenticated users may open Games pages.
    // Detailed permissions for creating, assigning, editing, deleting,
    // documents and reports are enforced later by gamesAccess().
    if (
        pathName === '/games' ||
        pathName === '/games/' ||
        pathName.startsWith('/games/')
    ) {
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
    if (
        pathName === '/official-activity' ||
        pathName.startsWith('/official-activity/')
    ) {
        return next();
    }
// ======================================================
// OFFICIALS
// ------------------------------------------------------
// Admin and TO can access the Officials section.
// Actual add/edit/delete permissions are enforced
// inside routes/officials.js.
// ======================================================
if (
    pathName === '/officials' ||
    pathName === '/officials/' ||
    pathName.startsWith('/officials/')
) {
    if (actualRole === 'to') {
        return next();
    }

    // Other non-admin roles are handled by the Officials
    // route middleware.
    return next();
}

// ======================================================
// COMPETITIONS
// ------------------------------------------------------
// Admin and TO can access Competition pages.
// Detailed permissions are enforced by competitionsAccess().
// ======================================================
if (
    pathName === '/competitions' ||
    pathName === '/competitions/' ||
    pathName.startsWith('/competitions/')
) {
    if (actualRole === 'to') {
        return next();
    }

// If not allowed
    return res.status(403).send(
        'Access denied. You do not have permission to access this page.'
    );
}

// ======================================================
// UPDATE PASSWORD
// ------------------------------------------------------
// Available to every authenticated user.
// This check must be outside the Competition permission block.
// ======================================================
// Update Password is available to every authenticated user.
if (
    pathName === '/account/password' ||
    pathName === '/account/password/'
) {
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

// ======================================================
// OFFICIALS AUTOCOMPLETE API
// ------------------------------------------------------
// Required by Games > Assign.
// All authenticated users can search officials.
// This does NOT give users permission to add/edit/delete
// officials.
// ======================================================
if (pathName === '/api/officials/search') {
    return next();
}

return res.status(403).send(
    'Access denied. You do not have permission to access this page.'
);
}
app.use(restrictedPageAccess);

// Uploaded files are protected by login.
app.use('/uploads', express.static(uploadDir));

// ======================================================
// MY AVAILABILITY
// ======================================================
app.use('/', availabilityRoutes);

// ======================================================
// FINANCE
// ------------------------------------------------------
// IMPORTANT:
// financeAccess is mounted at '/' so it must ONLY
// process /finance/... requests.
// It must NEVER interfere with Games, Officials,
// Dashboard, Assigned Games, etc.
// ======================================================
function financeAccess(req, res, next) {

    const pathName = String(req.path || '');

    // If this is NOT a Finance URL, completely ignore
    // this middleware and allow the request to continue.
    if (
        pathName !== '/finance' &&
        !pathName.startsWith('/finance/')
    ) {
        return next();
    }

    const actualRole = String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();

    // Admin + Finance:
    // Full Finance access, including payment processing.
    if (
        actualRole === 'admin' ||
        actualRole === 'finance'
    ) {
        return next();
    }

    // Official + TO:
    // Finance is read-only.
    if (
        actualRole === 'official' ||
        actualRole === 'to'
    ) {

        // Payment-success for an assigned official
        // remains subject to its own permission check.
        if (
            pathName.startsWith('/finance/payment-success/')
        ) {
            return requireAssignedPaymentOfficial(
                req,
                res,
                next
            );
        }

        // Other Finance POST/PUT/DELETE operations
        // are not allowed.
        if (req.method !== 'GET') {
            return res.status(403).send(
                'Access denied. Your Finance access is read-only.'
            );
        }

        return next();
    }

    return res.status(403).send('Access denied.');
}

app.use('/', financeAccess, financeRoutes);

// Mount Finance BEFORE generic app.use('/', ...) permission middleware.
app.use('/', financeAccess, financeRoutes);

// ======================================================
// DASHBOARD — all authenticated roles
// ======================================================
app.use('/', viewAll, dashboardRoutes);

// ======================================================
// OFFICIALS
// Matrix: Admin full; Official/TO view; Finance view.
// ======================================================
function officialsAccess(req, res, next) {

    const pathName = String(req.path || '');

    // Only process Officials URLs
    if (
        !pathName.startsWith('/officials') &&
        !pathName.startsWith('/api/officials')
    ) {
        return next();
    }

    // Officials autocomplete/search
    // All authenticated users can use this.
    if (pathName === '/api/officials/search') {
        return next();
    }

    const actualRole = String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();

    // Admin and TO can manage Officials.
    if (
        actualRole === 'admin' ||
        actualRole === 'to'
    ) {
        return next();
    }

    return res.status(403).send('Access denied.');
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
    const pathName = String(req.path || '');

    // Only apply Games permissions to Games URLs.
    if (
        pathName !== '/games' &&
        !pathName.startsWith('/games/')
    ) {
        return next();
    }

    const actualRole = String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();

    const isAdmin = actualRole === 'admin';
    const isTO = [
        'to',
        'technical official',
        'technical_official',
        'technical-official'
    ].includes(actualRole);

    // IMPORTANT:
    // Every authenticated role can OPEN / VIEW Games pages with GET.
    // This fixes "Access denied" on Games, Games/New and Games/Assign.
    //
    // Write/management operations remain protected below so granting page
    // access does NOT give every role permission to create or assign games.
    if (req.method === 'GET') {
        // Reports/documents that belong to an assigned game still require
        // ownership/assignment checks.
        if (
            req.path.startsWith('/games/report/') ||
            req.path.includes('/documents')
        ) {
            if (['official', 'referee', 'to'].includes(actualRole)) {
                return requireAssignedGame(req, res, next);
            }
            return next();
        }

        return next();
    }

    // Admin and Technical Official retain full Games management access.
    if (isAdmin || isTO) {
        return next();
    }

    // Finance remains read-only: GET requests were allowed above.
    if (actualRole === 'finance') {
        return res.status(403).send(
            'Access denied. Finance access to Games is read-only.'
        );
    }

    // Officials and referees can only perform assigned-game actions.
    if (actualRole === 'official' || actualRole === 'referee') {
        if (
            req.path.startsWith('/games/report/') ||
            req.path.includes('/documents')
        ) {
            return requireAssignedGame(req, res, next);
        }

        return res.status(403).send(
            'Access denied. You can view Games, but you cannot modify game management.'
        );
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
// Admin full; Finance view; Official/TO no access.
// ======================================================
function competitionsAccess(req, res, next) {
    const pathName = String(req.path || '');

    // Only apply Competition permissions to Competition URLs.
    if (
        pathName !== '/competitions' &&
        !pathName.startsWith('/competitions/')
    ) {
        return next();
    }

    const actualRole = String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();

    // Admin: full Competition access
    if (actualRole === 'admin') {
        return next();
    }

    // Finance: GET/read-only Competition access
    if (actualRole === 'finance' && req.method === 'GET') {
        return next();
    }

    return res.status(403).send(
        'Access denied. You do not have permission to access Competitions.'
    );
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
// USER MANAGEMENT — Admin only.
// ======================================================
app.use('/', usersRoutes);

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
