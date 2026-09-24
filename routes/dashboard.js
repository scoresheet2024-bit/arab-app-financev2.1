const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const actualRole = String(req.user?.actualRole || req.user?.role || '')
            .trim().toLowerCase();
        const canAssignGames = ['admin', 'to', 'technical official', 'technical_official', 'technical-official']
            .includes(actualRole);

        // Dashboard game list: latest/upcoming games, with a status derived
        // from the same fields already used by the reporting workflow.
        const dashboardGamesResult = await pool.query(`
            SELECT
                g.gameid,
                c.competitionname AS competition,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                g.court,
                COALESCE(g.assigned, FALSE) AS assigned,
                COALESCE(g.report_submitted, FALSE) AS report_submitted
            FROM public.games g
            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid
            ORDER BY
                CASE WHEN g.gamedate >= CURRENT_DATE THEN 0 ELSE 1 END,
                g.gamedate ASC,
                g.gametime ASC
            LIMIT 5
        `);

        const totalGamesResult = await pool.query(`SELECT COUNT(*) AS count FROM public.games`);
        const competitionsResult = await pool.query(`SELECT COUNT(*) AS count FROM public.competitions`);
        const officialsResult = await pool.query(`SELECT COUNT(*) AS count FROM public.officials`);
        const pendingGamesResult = await pool.query(`SELECT COUNT(*) AS count FROM public.games WHERE assigned = FALSE`);
        const assignedGamesResult = await pool.query(`
            SELECT COUNT(*) AS count
            FROM public.games g
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = FALSE
              AND (
                    $1 = 'admin'
                    OR (
                        $2 > 0
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
                    )
              )
        `, [actualRole, Number(req.user?.officialid) || 0]);
        const awaitingReportsResult = await pool.query(`
            SELECT COUNT(*) AS count
            FROM public.games
            WHERE assigned = TRUE AND COALESCE(report_submitted, FALSE) = FALSE
        `);
        const pendingApprovalResult = await pool.query(`
            SELECT COUNT(*) AS count
            FROM public.games
            WHERE approval_status = 'pending'
              AND assigned = TRUE
              AND COALESCE(report_submitted, FALSE) = FALSE
        `);
        const submittedReportsResult = await pool.query(`
            SELECT COUNT(*) AS count
            FROM public.games
            WHERE assigned = TRUE AND COALESCE(report_submitted, FALSE) = TRUE
        `);

        const competitionSummaryResult = await pool.query(`
            SELECT
                c.competitionid,
                c.competitionname,
                c.season,
                COUNT(g.gameid)::int AS gamecount
            FROM public.competitions c
            LEFT JOIN public.games g ON g.competitionid = c.competitionid
            GROUP BY c.competitionid, c.competitionname, c.season
            ORDER BY c.competitionid DESC
            LIMIT 5
        `);

        const totalGames = Number(totalGamesResult.rows[0]?.count || 0);
        const competitions = Number(competitionsResult.rows[0]?.count || 0);
        const officials = Number(officialsResult.rows[0]?.count || 0);
        const pendingGamesCount = Number(pendingGamesResult.rows[0]?.count || 0);
        const assignedGamesCount = Number(assignedGamesResult.rows[0]?.count || 0);
        const awaitingReportsCount = Number(awaitingReportsResult.rows[0]?.count || 0);
        const pendingApprovalCount = Number(pendingApprovalResult.rows[0]?.count || 0);
        const submittedReportsCount = Number(submittedReportsResult.rows[0]?.count || 0);

        const dashboardGames = dashboardGamesResult.rows.map(game => {
            let statusLabel = 'Scheduled';
            let statusClass = 'arab-status-info';
            if (!game.assigned) {
                statusLabel = 'Not Assigned';
                statusClass = 'arab-status-pending';
            } else if (game.report_submitted) {
                statusLabel = 'Submitted';
                statusClass = 'arab-status-success';
            } else {
                statusLabel = 'Awaiting Report';
                statusClass = 'arab-status-warning';
            }
            return { ...game, statusLabel, statusClass };
        });

        // Finance summary is deliberately isolated so a missing/old finance
        // table cannot prevent the Dashboard from loading.
        let paymentOverview = {
            totalPaid: 0,
            outstanding: 0,
            totalPayable: 0,
            paidOfficials: 0,
            unpaidOfficials: 0
        };

        if (actualRole === 'admin' || actualRole === 'finance') {
            try {
                const paidResult = await pool.query(`
                    SELECT COALESCE(SUM(fp.total_amount), 0) AS total_paid
                    FROM public.finance_payments fp
                    WHERE UPPER(COALESCE(fp.payment_status, 'PAID')) = 'PAID'
                `);

                const outstandingResult = await pool.query(`
                    SELECT COALESCE(SUM(
                        CASE
                            WHEN LOWER(TRIM(a.role)) IN (
                                'referee', 'umpire 1', 'umpire1', 'umpire 2', 'umpire2',
                                'standby referee', 'standby_referee', 'standbyreferee',
                                'commissioner', 'commissioners'
                            ) THEN 10500
                            WHEN LOWER(TRIM(a.role)) IN (
                                'scorer', 'timer', 'shot clock operator', 'shot clock',
                                'assistant scorer', 'assistant_scorer', 'ass. scorer'
                            ) THEN 8500
                            ELSE 0
                        END
                    ), 0) AS outstanding
                    FROM public.assignments a
                    INNER JOIN public.games g ON g.gameid = a.gameid
                    WHERE g.assigned = TRUE
                      AND COALESCE(g.report_submitted, FALSE) = TRUE
                      AND COALESCE(g.payment_status, 'UNPAID') <> 'PAID'
                `);

                const paidOfficialsResult = await pool.query(`
                    SELECT COUNT(DISTINCT fpi.officialid) AS count
                    FROM public.finance_payment_items fpi
                    INNER JOIN public.finance_payments fp ON fp.paymentid = fpi.paymentid
                    WHERE UPPER(COALESCE(fp.payment_status, 'PAID')) = 'PAID'
                `);

                const unpaidOfficialsResult = await pool.query(`
                    SELECT COUNT(DISTINCT a.officialid) AS count
                    FROM public.assignments a
                    INNER JOIN public.games g ON g.gameid = a.gameid
                    WHERE g.assigned = TRUE
                      AND COALESCE(g.report_submitted, FALSE) = TRUE
                      AND COALESCE(g.payment_status, 'UNPAID') <> 'PAID'
                `);

                paymentOverview.totalPaid = Number(paidResult.rows[0]?.total_paid || 0);
                paymentOverview.outstanding = Number(outstandingResult.rows[0]?.outstanding || 0);
                paymentOverview.totalPayable = paymentOverview.totalPaid + paymentOverview.outstanding;
                paymentOverview.paidOfficials = Number(paidOfficialsResult.rows[0]?.count || 0);
                paymentOverview.unpaidOfficials = Number(unpaidOfficialsResult.rows[0]?.count || 0);
            } catch (financeError) {
                console.warn('Dashboard finance summary unavailable:', financeError.message);
            }
        }

        const seasonResult = await pool.query(`
            SELECT season
            FROM public.competitions
            WHERE season IS NOT NULL AND TRIM(season::text) <> ''
            ORDER BY competitionid DESC
            LIMIT 1
        `);
        const systemSeason = seasonResult.rows[0]?.season || '-';
        const lastUpdated = new Date().toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        res.render('dashboard', {
            title: 'ARAB Dashboard',
            totalGames,
            competitions,
            officials,
            pendingGamesCount,
            assignedGamesCount,
            awaitingReportsCount,
            submittedReportsCount,
            pendingApprovalCount,
            dashboardGames,
            competitionSummary: competitionSummaryResult.rows,
            paymentOverview,
            systemSeason,
            lastUpdated,
            canAssignGames
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).send('Error loading dashboard: ' + error.message);
    }
});

module.exports = router;
