const express = require('express');
const pool = require('../db');

const router = express.Router();

// ======================================================
// COMPETITION ACCESS
// ------------------------------------------------------
// Admin + TO: full Competition access.
// Finance: GET/view-only access.
// Official + Referee: no Competition access.
// ======================================================
function competitionsAccess(req, res, next) {
    const actualRole = String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();

    const isTO = [
        'to',
        'technical official',
        'technical_official',
        'technical-official',
        'technicalofficial',
        't.o',
        't.o.'
    ].includes(actualRole);

    if (actualRole === 'admin' || isTO) {
        return next();
    }

    if (actualRole === 'finance' && req.method === 'GET') {
        return next();
    }

    return res.status(403).send(
        'Access denied. You do not have permission to access Competitions.'
    );
}

router.use('/competitions', competitionsAccess);

// ======================================================
// LIST ALL COMPETITIONS
// ======================================================
router.get('/competitions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                competitionid,
                competitionname,
                season
            FROM public.competitions
            ORDER BY competitionid DESC
        `);

        res.render('competitions/list', {
            title: 'Competitions',
            competitions: result.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading competitions: ' + error.message);
    }
});

// ======================================================
// ADD NEW COMPETITION - FORM
// ======================================================
router.get('/competitions/new', (req, res) => {
    res.render('competitions/new', {
        title: 'Add New Competition'
    });
});

// ======================================================
// SAVE NEW COMPETITION
// ======================================================
router.post('/competitions', async (req, res) => {
    try {
        const { competitionname, season } = req.body;

        await pool.query(
            `INSERT INTO public.competitions (competitionname, season)
             VALUES ($1, $2)`,
            [competitionname, season]
        );

        res.redirect('/competitions');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error adding competition: ' + error.message);
    }
});

module.exports = router;
