const express = require('express');
const pool = require('../db');

const router = express.Router();

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
