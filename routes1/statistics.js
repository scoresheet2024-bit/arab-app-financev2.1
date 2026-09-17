const express = require('express');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();


// ======================================================
// STATISTICS & REPORTS
// ======================================================

router.get('/statistics', requireRole('admin', 'official', 'to', 'finance'), async (req, res) => {

    try {

        // ==================================================
        // 1. GET ALL GAMES
        // ==================================================

        const gamesResult = await pool.query(`

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
                g.report_submitted,

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
              AND COALESCE(g.report_submitted, FALSE) = TRUE
              AND (
                    $1::text IN ('admin', 'finance')
                    OR ($1::text IN ('official', 'to') AND $2::integer IS NOT NULL
                        AND (g.official1_id = $2 OR g.official2_id = $2 OR g.official3_id = $2
                             OR g.scorer_id = $2 OR g.timer_id = $2
                             OR g.shot_clock_operator_id = $2 OR g.assistant_scorer_id = $2
                             OR g.commissioner_id = $2))
                  )

            ORDER BY
                g.gamedate DESC,
                g.gametime DESC,
                g.gameid DESC

        `, [req.user.role, req.user.officialid]);


        // ==================================================
        // 2. TOTAL GAMES PER OFFICIAL
        // ==================================================

        const officialsResult = await pool.query(`

            SELECT

                o.officialid,
                o.fullname,


                /* ==============================
                   REFEREE GAMES
                   Referee + Umpire 1 + Umpire 2
                ============================== */

                (

                    SELECT COUNT(*)

                    FROM public.games g

                    WHERE

                        g.assigned = TRUE
                        AND COALESCE(g.report_submitted, FALSE) = TRUE

                        AND (

                            g.official1_id = o.officialid

                            OR

                            g.official2_id = o.officialid

                            OR

                            g.official3_id = o.officialid

                        )

                ) AS referee_games,


                /* ==============================
                   TABLE OFFICIAL GAMES
                   Scorer + Timer +
                   Short Clock + Ass. Scorer
                ============================== */

                (

                    SELECT COUNT(*)

                    FROM public.games g

                    WHERE

                        g.assigned = TRUE
                        AND COALESCE(g.report_submitted, FALSE) = TRUE

                        AND (

                            g.scorer_id = o.officialid

                            OR

                            g.timer_id = o.officialid

                            OR

                            g.shot_clock_operator_id =
                                o.officialid

                            OR

                            g.assistant_scorer_id =
                                o.officialid

                        )

                ) AS table_official_games,


                /* ==============================
                   COMMISSIONER GAMES
                ============================== */

                (

                    SELECT COUNT(*)

                    FROM public.games g

                    WHERE

                        g.assigned = TRUE
                        AND COALESCE(g.report_submitted, FALSE) = TRUE

                        AND
                        g.commissioner_id =
                            o.officialid

                ) AS commissioner_games


            FROM public.officials o


            /* ==============================
               HIDE OFFICIALS WITH 0 GAMES
            ============================== */

            WHERE (($1::text IN ('official', 'to') AND o.officialid = $2) OR $1::text IN ('admin', 'finance'))
              AND EXISTS (

                SELECT 1

                FROM public.games g

                WHERE

                    g.assigned = TRUE
                        AND COALESCE(g.report_submitted, FALSE) = TRUE

                    AND (

                        g.official1_id = o.officialid

                        OR g.official2_id = o.officialid

                        OR g.official3_id = o.officialid

                        OR g.scorer_id = o.officialid

                        OR g.timer_id = o.officialid

                        OR g.shot_clock_operator_id =
                            o.officialid

                        OR g.assistant_scorer_id =
                            o.officialid

                        OR g.commissioner_id =
                            o.officialid

                    )

            )


            ORDER BY
                o.fullname

        `, [req.user.role, req.user.officialid]);


        // ==================================================
        // 3. TOTAL GAMES BY ROLE
        // ==================================================

        const roleResult = await pool.query(`

            SELECT


                /* ==============================
                   REFEREE
                ============================== */

                COUNT(*) FILTER (

                    WHERE

                        g.official1_id IS NOT NULL

                        OR

                        g.official2_id IS NOT NULL

                        OR

                        g.official3_id IS NOT NULL

                ) AS referee_games,


                /* ==============================
                   T.O
                ============================== */

                COUNT(*) FILTER (

                    WHERE

                        g.scorer_id IS NOT NULL

                        OR

                        g.timer_id IS NOT NULL

                        OR

                        g.shot_clock_operator_id
                            IS NOT NULL

                        OR

                        g.assistant_scorer_id
                            IS NOT NULL

                ) AS to_games,


                /* ==============================
                   COMMISSIONER
                ============================== */

                COUNT(*) FILTER (

                    WHERE

                        g.commissioner_id IS NOT NULL

                ) AS commissioner_games


            FROM public.games g

            WHERE
                g.assigned = TRUE
                        AND COALESCE(g.report_submitted, FALSE) = TRUE
              AND (
                    $1::text IN ('admin', 'finance')
                    OR ($1::text IN ('official', 'to') AND $2::integer IS NOT NULL
                        AND (g.official1_id = $2 OR g.official2_id = $2 OR g.official3_id = $2
                             OR g.scorer_id = $2 OR g.timer_id = $2
                             OR g.shot_clock_operator_id = $2 OR g.assistant_scorer_id = $2
                             OR g.commissioner_id = $2))
                  )

        `, [req.user.role, req.user.officialid]);


        // ==================================================
        // 4. GAMES BY COMPETITION
        // ==================================================

        const competitionResult = await pool.query(`

            SELECT

                COALESCE(
                    c.competitionname,
                    'No Competition'
                ) AS competition,


                COALESCE(
                    c.season,
                    '-'
                ) AS season,


                COUNT(g.gameid) AS total_games


            FROM public.games g

            LEFT JOIN public.competitions c
                ON g.competitionid =
                    c.competitionid


            WHERE
                g.assigned = TRUE
                        AND COALESCE(g.report_submitted, FALSE) = TRUE
              AND (
                    $1::text IN ('admin', 'finance')
                    OR ($1::text IN ('official', 'to') AND $2::integer IS NOT NULL
                        AND (g.official1_id = $2 OR g.official2_id = $2 OR g.official3_id = $2
                             OR g.scorer_id = $2 OR g.timer_id = $2
                             OR g.shot_clock_operator_id = $2 OR g.assistant_scorer_id = $2
                             OR g.commissioner_id = $2))
                  )


            GROUP BY

                c.competitionname,
                c.season


            ORDER BY

                total_games DESC,
                competition

        `, [req.user.role, req.user.officialid]);


        // ==================================================
        // 5. ROLE TOTALS
        // ==================================================

        const roleStats =
            roleResult.rows[0] || {};


        const refereeTotal =
            Number(
                roleStats.referee_games || 0
            );


        const toTotal =
            Number(
                roleStats.to_games || 0
            );


        const commissionerTotal =
            Number(
                roleStats.commissioner_games || 0
            );


        // ==================================================
        // 6. GENERAL TOTALS
        // ==================================================

        const totalGames =
            gamesResult.rows.length;


        const assignedGames =
            gamesResult.rows.filter(
                game => game.assigned
            ).length;


        const pendingGames =
            gamesResult.rows.filter(
                game => !game.assigned
            ).length;


        // ==================================================
        // 7. COMPETITION LIST FOR FILTER
        // ==================================================

        const competitionsList = [

            ...new Set(

                gamesResult.rows

                    .map(
                        game =>
                            game.competition
                    )

                    .filter(Boolean)

                    .map(
                        competition =>
                            String(
                                competition
                            ).trim()
                    )

            )

        ].sort(

            (a, b) =>

                a.localeCompare(
                    b,
                    undefined,
                    {
                        sensitivity:
                            'base'
                    }
                )

        );


        // ==================================================
        // 8. SEND DATA TO EJS
        // ==================================================

        res.render(
            'statistics',
            {

                games:
                    gamesResult.rows,

                officials:
                    officialsResult.rows,

                competitions:
                    competitionResult.rows,

                competitionsList,

                refereeTotal,

                toTotal,

                commissionerTotal,

                totalGames,

                assignedGames,

                pendingGames

            }
        );


    } catch (error) {

        console.error(
            'Error loading statistics:',
            error
        );


        res.status(500).send(

            'Error loading statistics: ' +
            error.message

        );

    }

});


module.exports = router;