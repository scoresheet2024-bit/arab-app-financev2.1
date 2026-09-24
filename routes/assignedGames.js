const express = require('express');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ======================================================
// ASSIGNED GAMES
//
// All Admin / Referee / Official / TO users can SEE all
// assigned games.
//
// REPORT ACCESS:
// - Admin: can open the report for any assigned game.
// - Referee / Official / TO: can open the report only when
//   they are actually assigned to that game.
//
// The assignments table is the authoritative assignment
// source. The games official columns are also checked as a
// compatibility fallback for older games.
// ======================================================
router.get(
    '/assigned-games',
    requireRole('admin', 'referee', 'official', 'to', 'finance'),
    async (req, res) => {
        try {
            // auth.js exposes role='admin' for compatibility; use actualRole for authorization.
            const role = String(req.user?.actualRole || req.user?.role || '').trim().toLowerCase();
            const officialId = Number(req.user?.officialid);

            const result = await pool.query(
                `
                SELECT
                    g.gameid,
                    c.competitionname AS competition,
                    c.season,
                    g.teama,
                    g.teamb,
                    g.gamedate,
                    g.gametime,
                    g.court,
                    g.assigned,
                    COALESCE(g.report_submitted, FALSE) AS report_submitted,

                    o1.fullname AS referee1,
                    o2.fullname AS umpire1,
                    o3.fullname AS umpire2,
                    os.fullname AS scorer,
                    ot.fullname AS timer,
                    osc.fullname AS shot_clock_operator,
                    oas.fullname AS assistant_scorer,
                    oc.fullname AS commissioner,

                    CASE
    WHEN $1 = 'admin' THEN TRUE

    WHEN $2 > 0
         AND (
             EXISTS (
                 SELECT 1
                 FROM public.assignments a
                 WHERE a.gameid = g.gameid
                   AND a.officialid = $2
             )
             OR g.official1_id = $2
             OR g.official2_id = $2
             OR g.official3_id = $2
             OR g.scorer_id = $2
             OR g.timer_id = $2
             OR g.shot_clock_operator_id = $2
             OR g.assistant_scorer_id = $2
             OR g.commissioner_id = $2
         )
    THEN TRUE

    ELSE FALSE
END AS can_report

                FROM public.games g

                LEFT JOIN public.competitions c
                    ON g.competitionid = c.competitionid

                LEFT JOIN public.officials o1
                    ON g.official1_id = o1.officialid

                LEFT JOIN public.officials o2
                    ON g.official2_id = o2.officialid

                LEFT JOIN public.officials o3
                    ON g.official3_id = o3.officialid

                LEFT JOIN public.officials os
                    ON g.scorer_id = os.officialid

                LEFT JOIN public.officials ot
                    ON g.timer_id = ot.officialid

                LEFT JOIN public.officials osc
                    ON g.shot_clock_operator_id = osc.officialid

                LEFT JOIN public.officials oas
                    ON g.assistant_scorer_id = oas.officialid

                LEFT JOIN public.officials oc
                    ON g.commissioner_id = oc.officialid

                      WHERE g.assigned = TRUE
                   AND COALESCE(g.report_submitted, FALSE) = FALSE
                   AND (
                        g.approval_status = 'approved'
                        OR $1 IN ('admin', 'to')
                   )
                ORDER BY
                    g.gamedate ASC,
                    g.gametime ASC,
                    g.gameid ASC
                `,
                [role, Number.isInteger(officialId) ? officialId : 0]
            );

            res.render('games/assigned', {
                games: result.rows,
                currentUser: req.user
            });
        } catch (error) {
            console.error('Error loading assigned games:', error);
            res.status(500).send(
                'Error loading assigned games: ' + error.message
            );
        }
    }
);

module.exports = router;
