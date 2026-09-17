const express = require('express');
const pool = require('../db');
const renderNavigation = require('../navigation/menu');

const router = express.Router();

router.get('/', async (req, res) => {

    try {

        // Get only PENDING / UNASSIGNED games
        const pendingGames = await pool.query(`
            SELECT
                g.gameid,
                c.competitionname AS competition,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                g.court
            FROM public.games g
            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid
            WHERE g.assigned = FALSE
            ORDER BY g.gamedate ASC, g.gametime ASC
            LIMIT 5
        `);


        // Dashboard totals
        const totalGamesResult = await pool.query(`
            SELECT COUNT(*) AS count
            FROM public.games
        `);

        const competitionsResult = await pool.query(`
            SELECT COUNT(*) AS count
            FROM public.competitions
        `);

        const officialsResult = await pool.query(`
            SELECT COUNT(*) AS count
            FROM public.officials
        `);

        const pendingGamesResult = await pool.query(`
            SELECT COUNT(*) AS count
            FROM public.games
            WHERE assigned = FALSE
        `);


        const totalGames =
            totalGamesResult.rows[0].count;

        const competitions =
            competitionsResult.rows[0].count;

        const officials =
            officialsResult.rows[0].count;

        const pendingGamesCount =
            pendingGamesResult.rows[0].count;

res.render('dashboard', {
    title: 'ARAB Reporting System',

    totalGames,

    competitions,

    officials,

    pendingGamesCount,

    pendingGames: pendingGames.rows
});

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error loading dashboard: ' +
            error.message
        );

    }

});

// ======================================================
// OFFICIALS PAGE
// ======================================================


module.exports = router;
