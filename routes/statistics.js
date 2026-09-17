const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/statistics', async (req, res) => {
    try {
        // Completed/assigned games are the population used by the statistics page.
        // payment_status is included so the competition drill-down can show Paid/Unpaid.
        const gamesResult = await pool.query(`
            SELECT
                g.gameid,
                g.competitionid,
                COALESCE(c.competitionname, 'No Competition') AS competition,
                COALESCE(c.season, '-') AS season,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                g.court,
                g.assigned,
                g.report_submitted,
                COALESCE(NULLIF(LOWER(TRIM(g.payment_status::text)), ''), 'unpaid') AS payment_status,
                o1.fullname AS referee1,
                o2.fullname AS umpire1,
                o3.fullname AS umpire2,
                os.fullname AS scorer,
                ot.fullname AS timer,
                osc.fullname AS shot_clock_operator,
                oas.fullname AS assistant_scorer,
                oc.fullname AS commissioner
            FROM public.games g
            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid
            LEFT JOIN public.officials o1 ON g.official1_id = o1.officialid
            LEFT JOIN public.officials o2 ON g.official2_id = o2.officialid
            LEFT JOIN public.officials o3 ON g.official3_id = o3.officialid
            LEFT JOIN public.officials os ON g.scorer_id = os.officialid
            LEFT JOIN public.officials ot ON g.timer_id = ot.officialid
            LEFT JOIN public.officials osc ON g.shot_clock_operator_id = osc.officialid
            LEFT JOIN public.officials oas ON g.assistant_scorer_id = oas.officialid
            LEFT JOIN public.officials oc ON g.commissioner_id = oc.officialid
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = TRUE
            ORDER BY g.gamedate DESC, g.gametime DESC, g.gameid DESC
        `);

        const roleResult = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE g.official1_id IS NOT NULL OR g.official2_id IS NOT NULL OR g.official3_id IS NOT NULL) AS referee_games,
                COUNT(*) FILTER (WHERE g.scorer_id IS NOT NULL OR g.timer_id IS NOT NULL OR g.shot_clock_operator_id IS NOT NULL OR g.assistant_scorer_id IS NOT NULL) AS to_games,
                COUNT(*) FILTER (WHERE g.commissioner_id IS NOT NULL) AS commissioner_games
            FROM public.games g
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = TRUE
        `);

        const competitionResult = await pool.query(`
            SELECT
                c.competitionid,
                COALESCE(c.competitionname, 'No Competition') AS competition,
                COALESCE(c.season, '-') AS season,
                COUNT(g.gameid) AS total_games
            FROM public.games g
            LEFT JOIN public.competitions c ON g.competitionid = c.competitionid
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = TRUE
            GROUP BY c.competitionid, c.competitionname, c.season
            ORDER BY total_games DESC, competition
        `);

        const games = gamesResult.rows;
        const roleStats = roleResult.rows[0] || {};

        res.render('statistics', {
            title: 'Statistics & Reports',
            games,
            competitions: competitionResult.rows,
            refereeTotal: Number(roleStats.referee_games || 0),
            toTotal: Number(roleStats.to_games || 0),
            commissionerTotal: Number(roleStats.commissioner_games || 0),
            totalGames: games.length,
            assignedGames: games.filter(g => g.assigned).length,
            pendingGames: games.filter(g => !g.assigned).length
        });
    } catch (error) {
        console.error('Error loading statistics:', error);
        res.status(500).send('Error loading statistics: ' + error.message);
    }
});

module.exports = router;
