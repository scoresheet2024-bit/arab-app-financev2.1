const express = require('express');
const pool = require('../db');
const renderNavigation = require('../navigation/menu');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/*
===========================================================
OFFICIAL ACTIVITY
===========================================================

Role classification:

Referee:
    Referee
    Umpire 1
    Umpire 2

T.O:
    Scorer
    Timer
    Shot Clock Operator
    Assistant Scorer

Commissioner:
    Commissioner
===========================================================
*/


/*
===========================================================
HELPER FUNCTIONS
===========================================================
*/

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


function formatDate(value) {
    if (!value) {
        return '-';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}


function getRoleCategory(role) {

    const normalizedRole = String(role || '').trim();

    if (
        [
            'Referee',
            'Umpire 1',
            'Umpire 2'
        ].includes(normalizedRole)
    ) {
        return 'Referee';
    }

    if (
        [
            'Scorer',
            'Timer',
            'Shot Clock Operator',
            'Assistant Scorer'
        ].includes(normalizedRole)
    ) {
        return 'T.O';
    }

    if (normalizedRole === 'Commissioner') {
        return 'Commissioner';
    }

    return normalizedRole || '-';
}


function paymentStatusInfo(status) {

    const normalized = String(status || 'UNPAID')
        .trim()
        .toUpperCase();

    switch (normalized) {

        case 'PAID':
            return {
                label: 'Paid',
                className: 'paid'
            };

        case 'PARTIAL':
        case 'PARTIALLY PAID':
            return {
                label: 'Partially Paid',
                className: 'partial'
            };

        case 'PENDING':
            return {
                label: 'Pending',
                className: 'pending'
            };

        case 'UNPAID':
        default:
            return {
                label: 'Unpaid',
                className: 'unpaid'
            };
    }
}


/*
===========================================================
1. OFFICIAL ACTIVITY SUMMARY
===========================================================
*/

router.get(
    '/official-activity',
    requireAuth,
    async (req, res) => {

        try {
            // Admin and Finance can see the full list of officials.
            // Other authenticated users who are linked to an official
            // are taken directly to their own activity page.
            const actualRole = String(req.user?.actualRole || '')
                .trim()
                .toLowerCase();

            if (!['admin', 'finance'].includes(actualRole)) {
                if (!req.user?.officialid) {
                    return res.status(403).send(
                        'Your user account is not linked to an official profile.'
                    );
                }

                return res.redirect(
                    `/official-activity/${encodeURIComponent(req.user.officialid)}`
                );
            }

            const result = await pool.query(`

                SELECT

                    o.officialid,

                    o.fullname,

                    COUNT(
                        CASE
                            WHEN a.role IN (
                                'Referee',
                                'Umpire 1',
                                'Umpire 2'
                            )
                            THEN 1
                        END
                    ) AS referee_games,

                    COUNT(
                        CASE
                            WHEN a.role IN (
                                'Scorer',
                                'Timer',
                                'Shot Clock Operator',
                                'Assistant Scorer'
                            )
                            THEN 1
                        END
                    ) AS to_games,

                    COUNT(
                        CASE
                            WHEN a.role = 'Commissioner'
                            THEN 1
                        END
                    ) AS commissioner_games,

                    COUNT(a.assignmentid) AS total_games

                FROM public.officials o

                LEFT JOIN public.assignments a
                    ON a.officialid = o.officialid

                GROUP BY
                    o.officialid,
                    o.fullname

                ORDER BY
                    COUNT(a.assignmentid) DESC,
                    o.fullname ASC

            `);


            res.send(`

<!DOCTYPE html>

<html>

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Official Activity | ARAB</title>

    <style>

        * {
            box-sizing: border-box;
        }

        body {

            margin: 0;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

            background: #f5f7fb;

            color: #172033;

        }


        .official-page {

            padding: 35px;

            max-width: 1600px;

            margin: 0 auto;

        }


        .page-header {

            margin-bottom: 30px;

        }


        .page-title {

            font-size: 36px;

            font-weight: 700;

            margin: 0 0 8px 0;

            color: #172033;

        }


        .page-subtitle {

            font-size: 19px;

            color: #667085;

            margin: 0;

        }


        .summary-card {

            background: white;

            border: 1px solid #e1e5ec;

            border-radius: 16px;

            padding: 24px;

            margin-bottom: 25px;

            box-shadow:
                0 2px 6px rgba(0,0,0,0.04);

        }


        .summary-title {

            font-size: 18px;

            font-weight: bold;

            color: #667085;

            margin-bottom: 8px;

        }


        .summary-number {

            font-size: 34px;

            font-weight: bold;

            color: #172033;

        }


        .table-container {

            background: white;

            border: 1px solid #e1e5ec;

            border-radius: 16px;

            overflow-x: auto;

            box-shadow:
                0 2px 6px rgba(0,0,0,0.04);

        }


        table {

            width: 100%;

            border-collapse: collapse;

            min-width: 750px;

        }


        th {

            background: #f2f4f7;

            color: #344054;

            font-size: 16px;

            font-weight: bold;

            text-align: left;

            padding: 18px 20px;

            border-bottom:
                1px solid #dfe3e8;

        }


        td {

            padding: 18px 20px;

            border-bottom:
                1px solid #e2e6ee;

            font-size: 16px;

            color: #172033;

        }


        tbody tr:hover {

            background: #f8fafc;

        }


        tbody tr:last-child td {

            border-bottom: none;

        }


        .official-link {

            color: #1769e0;

            text-decoration: none;

            font-weight: 700;

            font-size: 17px;

        }


        .official-link:hover {

            text-decoration: underline;

        }


        .number {

            font-weight: 600;

            text-align: center;

        }


        .total-number {

            font-size: 18px;

            font-weight: bold;

            color: #1769e0;

            text-align: center;

        }


        .role-count {

            display: inline-block;

            min-width: 35px;

            padding: 6px 10px;

            text-align: center;

            border-radius: 8px;

            background: #f5f7fb;

            font-weight: bold;

        }


        .empty {

            padding: 45px;

            text-align: center;

            color: #667085;

            font-size: 17px;

        }


        .back-container {

            margin-top: 25px;

        }


        .back-button {

            display: inline-block;

            padding: 11px 18px;

            background: #198754;

            color: white;

            text-decoration: none;

            border-radius: 7px;

            font-weight: bold;

        }


        .back-button:hover {

            background: #146c43;

        }


        @media (max-width: 700px) {

            .official-page {

                padding: 18px;

            }

            .page-title {

                font-size: 28px;

            }

            .page-subtitle {

                font-size: 16px;

            }

            th,
            td {

                padding: 13px;

            }

        }

    </style>

</head>


<body>

    ${renderNavigation(req.user)}


    <main class="official-page">


        <div class="page-header">

            <h1 class="page-title">
                Official Activity
            </h1>

            <p class="page-subtitle">
                Summary of games assigned to each official
            </p>

        </div>


        <div class="summary-card">

            <div class="summary-title">
                Total Officials
            </div>

            <div class="summary-number">
                ${result.rows.length}
            </div>

        </div>


        <div class="table-container">

            ${
                result.rows.length === 0

                ?

                `

                <div class="empty">
                    No officials found.
                </div>

                `

                :

                `

                <table>

                    <thead>

                        <tr>

                            <th>
                                Official
                            </th>

                            <th>
                                Referee
                            </th>

                            <th>
                                T.O
                            </th>

                            <th>
                                Commissioner
                            </th>

                            <th>
                                Total Games
                            </th>

                        </tr>

                    </thead>


                    <tbody>

                        ${

                            result.rows.map(official => {

                                const referee =
                                    Number(
                                        official.referee_games
                                    );

                                const to =
                                    Number(
                                        official.to_games
                                    );

                                const commissioner =
                                    Number(
                                        official.commissioner_games
                                    );

                                const total =
                                    Number(
                                        official.total_games
                                    );


                                return `

                                <tr>

                                    <td>

                                        <a
                                            href="/official-activity/${official.officialid}"
                                            class="official-link"
                                        >
                                            ${escapeHtml(
                                                official.fullname || '-'
                                            )}
                                        </a>

                                    </td>


                                    <td>

                                        <div class="number">

                                            <span class="role-count">
                                                ${referee}
                                            </span>

                                        </div>

                                    </td>


                                    <td>

                                        <div class="number">

                                            <span class="role-count">
                                                ${to}
                                            </span>

                                        </div>

                                    </td>


                                    <td>

                                        <div class="number">

                                            <span class="role-count">
                                                ${commissioner}
                                            </span>

                                        </div>

                                    </td>


                                    <td>

                                        <div class="total-number">
                                            ${total}
                                        </div>

                                    </td>

                                </tr>

                                `;

                            }).join('')

                        }

                    </tbody>

                </table>

                `
            }

        </div>


        <div
            class="summary-card"
            style="margin-top:25px;"
        >

            <div class="summary-title">
                Role Classification
            </div>

            <p
                style="
                    margin:8px 0 0 0;
                    color:#667085;
                    line-height:1.7;
                "
            >

                <strong>Referee:</strong>
                Referee + Umpire 1 + Umpire 2

                <br>

                <strong>T.O:</strong>
                Scorer + Timer + Shot Clock Operator +
                Assistant Scorer

                <br>

                <strong>Commissioner:</strong>
                Commissioner

            </p>

        </div>


        <div class="back-container">

            <a
                href="/statistics"
                class="back-button"
            >
                ← Back to Statistics
            </a>

        </div>


    </main>

</body>

</html>

            `);


        } catch (error) {

            console.error(
                'Error loading Official Activity:',
                error
            );

            res.status(500).send(
                'Error loading Official Activity: ' +
                error.message
            );

        }

    }
);


/*
===========================================================
2. INDIVIDUAL OFFICIAL ACTIVITY
===========================================================
*/

router.get(
    '/official-activity/:id',
    requireAuth,
    async (req, res) => {

        try {

            const currentRole = String(
                req.user?.actualRole || ''
            ).trim().toLowerCase();

            const requestedOfficialId = String(req.params.id);
            const ownOfficialId = req.user?.officialid != null
                ? String(req.user.officialid)
                : null;

            // Admin and Finance may open any official's activity.
            // Other users may ONLY open their own activity.
            if (!['admin', 'finance'].includes(currentRole)) {
                if (!ownOfficialId) {
                    return res.status(403).send(
                        'Your user account is not linked to an official profile.'
                    );
                }

                if (requestedOfficialId !== ownOfficialId) {
                    return res.status(403).send(
                        'Access denied. You can only view your own Official Activity.'
                    );
                }
            }

            // Admin and Finance can open the report from this page.
            const canViewReport = ['admin', 'finance'].includes(currentRole);

            const officialId = Number(req.params.id);


            if (!Number.isInteger(officialId) || officialId <= 0) {

                return res.status(400).send(
                    'Invalid official ID.'
                );

            }


            /*
            ---------------------------------------------------
            GET OFFICIAL
            ---------------------------------------------------
            */

            const officialResult = await pool.query(`

                SELECT

                    officialid,
                    fullname

                FROM public.officials

                WHERE officialid = $1

                LIMIT 1

            `, [officialId]);


            if (officialResult.rows.length === 0) {

                return res.status(404).send(
                    'Official not found.'
                );

            }


            const official =
                officialResult.rows[0];


            /*
            ---------------------------------------------------
            GET ALL GAMES FOR THIS OFFICIAL
            ---------------------------------------------------
            */

            /*
            ---------------------------------------------------
            FILTERS
            ---------------------------------------------------
            Filters are read from the URL query string:
              ?competition=Peace%20Cup&season=2026&payment=unpaid
            ---------------------------------------------------
            */

            const competitionFilter = String(
                req.query.competition || ''
            ).trim();

            const seasonFilter = String(
                req.query.season || ''
            ).trim();

            const paymentFilter = String(
                req.query.payment || 'all'
            ).trim().toLowerCase();

            const queryParams = [officialId];

            const filterConditions = [
                'a.officialid = $1'
            ];

            if (competitionFilter) {
                queryParams.push(`%${competitionFilter}%`);
                filterConditions.push(
                    `LOWER(COALESCE(c.competitionname, '')) LIKE LOWER($${queryParams.length})`
                );
            }

            if (seasonFilter) {
                queryParams.push(`%${seasonFilter}%`);
                filterConditions.push(
                    `CAST(c.season AS TEXT) ILIKE $${queryParams.length}`
                );
            }

            if (paymentFilter === 'paid') {
                filterConditions.push(
                    `UPPER(COALESCE(g.payment_status, 'UNPAID')) = 'PAID'`
                );
            } else if (paymentFilter === 'unpaid') {
                filterConditions.push(
                    `UPPER(COALESCE(g.payment_status, 'UNPAID')) = 'UNPAID'`
                );
            } else if (paymentFilter === 'partial') {
                filterConditions.push(
                    `UPPER(COALESCE(g.payment_status, 'UNPAID')) IN ('PARTIAL', 'PARTIALLY PAID')`
                );
            } else if (paymentFilter === 'pending') {
                filterConditions.push(
                    `UPPER(COALESCE(g.payment_status, 'UNPAID')) = 'PENDING'`
                );
            }

            const gamesResult = await pool.query(`

                SELECT

                    a.assignmentid,

                    a.gameid,

                    a.role,

                    g.gamedate,

                    g.gametime,

                    g.teama,

                    g.teamb,

                    g.court,

                    COALESCE(
                        g.payment_status,
                        'UNPAID'
                    ) AS payment_status,

                    COALESCE(
                        g.report_submitted,
                        FALSE
                    ) AS report_submitted,

                    c.competitionname AS competition,

                    c.season

                FROM public.assignments a

                INNER JOIN public.games g
                    ON g.gameid = a.gameid

                LEFT JOIN public.competitions c
                    ON c.competitionid = g.competitionid

                WHERE ${filterConditions.join('\n                    AND ')}

                ORDER BY
                    g.gamedate DESC NULLS LAST,
                    g.gametime DESC NULLS LAST,
                    g.gameid DESC

            `, queryParams);


            /*
            ---------------------------------------------------
            CALCULATE SUMMARY
            ---------------------------------------------------
            */

            let refereeGames = 0;
            let toGames = 0;
            let commissionerGames = 0;


            for (const game of gamesResult.rows) {

                const category =
                    getRoleCategory(game.role);


                if (category === 'Referee') {
                    refereeGames++;
                }

                else if (category === 'T.O') {
                    toGames++;
                }

                else if (category === 'Commissioner') {
                    commissionerGames++;
                }

            }


            const totalGames =
                gamesResult.rows.length;


            /*
            ---------------------------------------------------
            PAGE
            ---------------------------------------------------
            */

            res.send(`

<!DOCTYPE html>

<html>

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>
        ${escapeHtml(official.fullname)} |
        Official Activity
    </title>


    <style>

        * {
            box-sizing: border-box;
        }


        body {

            margin: 0;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

            background: #f5f7fb;

            color: #172033;

        }


        .official-page {

            padding: 35px;

            max-width: 1600px;

            margin: 0 auto;

        }


        .page-header {

            margin-bottom: 25px;

        }


        .back-link {

            display: inline-block;

            margin-bottom: 18px;

            color: #1769e0;

            text-decoration: none;

            font-weight: 600;

        }


        .back-link:hover {

            text-decoration: underline;

        }


        .page-title {

            font-size: 34px;

            font-weight: 700;

            margin: 0 0 8px 0;

            color: #172033;

        }


        .page-subtitle {

            font-size: 18px;

            color: #667085;

            margin: 0;

        }


        /*
        ============================================
        SUMMARY
        ============================================
        */


        .summary-grid {

            display: grid;

            grid-template-columns:
                repeat(4, minmax(150px, 1fr));

            gap: 18px;

            margin-bottom: 28px;

        }


        .summary-card {

            background: white;

            border: 1px solid #e1e5ec;

            border-radius: 14px;

            padding: 22px;

            box-shadow:
                0 2px 6px rgba(0,0,0,0.04);

        }


        .summary-label {

            color: #667085;

            font-size: 15px;

            font-weight: 600;

            margin-bottom: 8px;

        }


        .summary-value {

            font-size: 30px;

            font-weight: 700;

            color: #172033;

        }


        .total-card .summary-value {

            color: #1769e0;

        }


        /*
        ============================================
        GAMES SECTION
        ============================================
        */


        .section-header {

            margin-bottom: 15px;

        }


        .section-title {

            font-size: 24px;

            font-weight: 700;

            margin: 0;

        }


        .section-subtitle {

            color: #667085;

            margin-top: 5px;

        }


        /*
        ============================================
        ACTIVITY FILTERS
        ============================================
        */

        .filter-card {

            background: white;

            border: 1px solid #e1e5ec;

            border-radius: 14px;

            padding: 18px;

            margin-bottom: 20px;

            box-shadow:
                0 2px 6px rgba(0,0,0,0.04);

        }


        .filter-grid {

            display: grid;

            grid-template-columns:
                minmax(220px, 2fr)
                minmax(140px, 1fr)
                minmax(160px, 1fr)
                auto auto;

            gap: 12px;

            align-items: end;

        }


        .filter-field {

            display: flex;

            flex-direction: column;

            gap: 6px;

        }


        .filter-field label {

            color: #344054;

            font-size: 13px;

            font-weight: 700;

        }


        .filter-field input,

        .filter-field select {

            width: 100%;

            min-height: 42px;

            padding: 9px 12px;

            border: 1px solid #d0d5dd;

            border-radius: 8px;

            background: white;

            color: #172033;

            font-size: 14px;

            outline: none;

        }


        .filter-field input:focus,

        .filter-field select:focus {

            border-color: #1769e0;

            box-shadow: 0 0 0 3px rgba(23,105,224,0.10);

        }


        .filter-button,

        .clear-filter-button {

            display: inline-flex;

            align-items: center;

            justify-content: center;

            min-height: 42px;

            padding: 9px 16px;

            border-radius: 8px;

            font-size: 14px;

            font-weight: 700;

            text-decoration: none;

            cursor: pointer;

            white-space: nowrap;

        }


        .filter-button {

            border: 1px solid #1769e0;

            background: #1769e0;

            color: white;

        }


        .filter-button:hover {

            background: #1256b8;

            border-color: #1256b8;

        }


        .clear-filter-button {

            border: 1px solid #d0d5dd;

            background: #f2f4f7;

            color: #344054;

        }


        .clear-filter-button:hover {

            background: #e4e7ec;

        }


        .filter-summary {

            margin-top: 10px;

            color: #667085;

            font-size: 13px;

        }


        .table-container {

            background: white;

            border: 1px solid #e1e5ec;

            border-radius: 16px;

            overflow-x: auto;

            box-shadow:
                0 2px 6px rgba(0,0,0,0.04);

        }


        table {

            width: 100%;

            border-collapse: collapse;

            min-width: 1100px;

        }


        th {

            background: #f2f4f7;

            color: #344054;

            font-size: 15px;

            font-weight: 700;

            text-align: left;

            padding: 16px 18px;

            border-bottom:
                1px solid #dfe3e8;

            white-space: nowrap;

        }


        td {

            padding: 16px 18px;

            border-bottom:
                1px solid #e2e6ee;

            font-size: 15px;

            color: #172033;

            vertical-align: middle;

        }


        tbody tr:hover {

            background: #f8fafc;

        }


        tbody tr:last-child td {

            border-bottom: none;

        }


        .game-name {

            font-weight: 700;

            white-space: nowrap;

        }


        .game-id {

            color: #667085;

            font-size: 13px;

            margin-top: 3px;

        }


        /*
        ============================================
        ROLE BADGE
        ============================================
        */


        .role-badge {

            display: inline-block;

            padding: 6px 10px;

            border-radius: 7px;

            background: #f2f4f7;

            color: #344054;

            font-weight: 700;

            white-space: nowrap;

        }


        /*
        ============================================
        PAYMENT STATUS
        ============================================
        */


        .payment-status {

            display: inline-block;

            padding: 7px 12px;

            border-radius: 999px;

            font-size: 13px;

            font-weight: 700;

            white-space: nowrap;

        }


        .payment-status.paid {

            background: #dcfce7;

            color: #166534;

        }


        .payment-status.unpaid {

            background: #fee2e2;

            color: #991b1b;

        }


        .payment-status.pending {

            background: #fef3c7;

            color: #92400e;

        }


        .payment-status.partial {

            background: #fef3c7;

            color: #92400e;

        }


        /*
        ============================================
        REPORT BUTTON
        ============================================
        */


        .report-button {

            display: inline-block;

            padding: 8px 13px;

            background: #1769e0;

            color: white;

            text-decoration: none;

            border-radius: 7px;

            font-size: 13px;

            font-weight: 700;

            white-space: nowrap;

        }


        .report-button:hover {

            background: #1256b8;

        }


        .report-button-disabled {

            display: inline-block;

            padding: 8px 13px;

            background: #e5e7eb;

            color: #667085;

            border-radius: 7px;

            font-size: 13px;

            font-weight: 700;

            white-space: nowrap;

            cursor: not-allowed;

        }


        .no-report {

            color: #98a2b3;

            font-size: 13px;

        }


        /*
        ============================================
        EMPTY
        ============================================
        */


        .empty {

            padding: 55px;

            text-align: center;

            color: #667085;

            font-size: 17px;

        }


        /*
        ============================================
        FOOTER / BACK
        ============================================
        */


        .back-container {

            margin-top: 25px;

        }


        .back-button {

            display: inline-block;

            padding: 11px 18px;

            background: #198754;

            color: white;

            text-decoration: none;

            border-radius: 7px;

            font-weight: bold;

        }


        .back-button:hover {

            background: #146c43;

        }


        /*
        ============================================
        RESPONSIVE
        ============================================
        */


        @media (max-width: 1100px) {

            .filter-grid {

                grid-template-columns:
                    repeat(2, minmax(180px, 1fr));

            }

        }


        @media (max-width: 900px) {

            .summary-grid {

                grid-template-columns:
                    repeat(2, minmax(140px, 1fr));

            }

        }


        @media (max-width: 600px) {

            .official-page {

                padding: 18px;

            }


            .page-title {

                font-size: 27px;

            }


            .summary-grid {

                grid-template-columns: 1fr;

            }

        }

    </style>

</head>


<body>

    ${renderNavigation(req.user)}


    <main class="official-page">


        <!-- =========================================
             HEADER
        ========================================== -->


        <div class="page-header">

            <a
                href="/official-activity"
                class="back-link"
            >
                ← Back to Official Activity
            </a>


            <h1 class="page-title">

                ${escapeHtml(
                    official.fullname || '-'
                )}

            </h1>


            <p class="page-subtitle">

                This is the complete history of games you have done

            </p>

        </div>


        <!-- =========================================
             SUMMARY
        ========================================== -->


        <div class="summary-grid">


            <div class="summary-card">

                <div class="summary-label">
                    Referee
                </div>

                <div class="summary-value">
                    ${refereeGames}
                </div>

            </div>


            <div class="summary-card">

                <div class="summary-label">
                    T.O
                </div>

                <div class="summary-value">
                    ${toGames}
                </div>

            </div>


            <div class="summary-card">

                <div class="summary-label">
                    Commissioner
                </div>

                <div class="summary-value">
                    ${commissionerGames}
                </div>

            </div>


            <div class="summary-card total-card">

                <div class="summary-label">
                    Total Games
                </div>

                <div class="summary-value">
                    ${totalGames}
                </div>

            </div>


        </div>


        <!-- =========================================
             ACTUAL GAMES
        ========================================== -->


        <div class="section-header">

            <h2 class="section-title">
                Actual Games
            </h2>

            <div class="section-subtitle">

                Games assigned to
                ${escapeHtml(official.fullname || '-')}

            </div>

        </div>


        <!-- =========================================
             SEARCH / FILTERS
        ========================================== -->

        <form
            method="GET"
            action="/official-activity/${official.officialid}"
            class="filter-card"
        >

            <div class="filter-grid">

                <div class="filter-field">

                    <label for="competition">
                        Competition
                    </label>

                    <input
                        type="text"
                        id="competition"
                        name="competition"
                        value="${escapeHtml(competitionFilter)}"
                        placeholder="Search competition..."
                    >

                </div>


                <div class="filter-field">

                    <label for="season">
                        Season
                    </label>

                    <input
                        type="text"
                        id="season"
                        name="season"
                        value="${escapeHtml(seasonFilter)}"
                        placeholder="e.g. 2026"
                    >

                </div>


                <div class="filter-field">

                    <label for="payment">
                        Payment Status
                    </label>

                    <select
                        id="payment"
                        name="payment"
                    >

                        <option
                            value="all"
                            ${paymentFilter === 'all' ? 'selected' : ''}
                        >
                            All
                        </option>

                        <option
                            value="paid"
                            ${paymentFilter === 'paid' ? 'selected' : ''}
                        >
                            Paid
                        </option>

                        <option
                            value="unpaid"
                            ${paymentFilter === 'unpaid' ? 'selected' : ''}
                        >
                            Unpaid
                        </option>

                        <option
                            value="partial"
                            ${paymentFilter === 'partial' ? 'selected' : ''}
                        >
                            Partially Paid
                        </option>

                        <option
                            value="pending"
                            ${paymentFilter === 'pending' ? 'selected' : ''}
                        >
                            Pending
                        </option>

                    </select>

                </div>


                <button
                    type="submit"
                    class="filter-button"
                >
                    Search
                </button>


                <a
                    href="/official-activity/${official.officialid}"
                    class="clear-filter-button"
                >
                    Clear
                </a>

            </div>


            ${
                competitionFilter ||
                seasonFilter ||
                paymentFilter !== 'all'
                    ?
                    `
                    <div class="filter-summary">
                        Showing
                        <strong>${gamesResult.rows.length}</strong>
                        matching game${gamesResult.rows.length === 1 ? '' : 's'}.
                    </div>
                    `
                    :
                    ''
            }

        </form>


        <div class="table-container">


            ${
                gamesResult.rows.length === 0

                ?

                `

                <div class="empty">

                    No games have been assigned
                    to this official.

                </div>

                `

                :

                `

                <table>

                    <thead>

                        <tr>

                            <th>
                                Date
                            </th>

                            <th>
                                Competition
                            </th>

                            <th>
                                Season
                            </th>

                            <th>
                                Game
                            </th>

                            <th>
                                Role
                            </th>

                            <th>
                                Venue
                            </th>

                            <th>
                                Payment Status
                            </th>

                            <th>
                                Report
                            </th>

                        </tr>

                    </thead>


                    <tbody>


                        ${

                            gamesResult.rows.map(game => {

                                const roleCategory =
                                    getRoleCategory(
                                        game.role
                                    );


                                const payment =
                                    paymentStatusInfo(
                                        game.payment_status
                                    );


                                const reportAvailable =
                                    Boolean(
                                        game.report_submitted
                                    );


                                return `

                                <tr>


                                    <!-- DATE -->

                                    <td>

                                        ${formatDate(
                                            game.gamedate
                                        )}

                                        ${
                                            game.gametime
                                            ?
                                            `<div
                                                style="
                                                    color:#667085;
                                                    font-size:13px;
                                                    margin-top:3px;
                                                "
                                            >
                                                ${escapeHtml(
                                                    String(
                                                        game.gametime
                                                    ).substring(0, 5)
                                                )}
                                            </div>`
                                            :
                                            ''
                                        }

                                    </td>


                                    <!-- COMPETITION -->

                                    <td>

                                        ${
                                            escapeHtml(
                                                game.competition
                                                || '-'
                                            )
                                        }

                                    </td>


                                    <!-- SEASON -->

                                    <td>

                                        ${
                                            escapeHtml(
                                                game.season
                                                || '-'
                                            )
                                        }

                                    </td>


                                    <!-- GAME -->

                                    <td>

                                        <div class="game-name">

                                            ${
                                                escapeHtml(
                                                    game.teama
                                                    || '-'
                                                )
                                            }

                                            &nbsp; vs &nbsp;

                                            ${
                                                escapeHtml(
                                                    game.teamb
                                                    || '-'
                                                )
                                            }

                                        </div>


                                        <div class="game-id">

                                            Game #${escapeHtml(
                                                game.gameid
                                            )}

                                        </div>

                                    </td>


                                    <!-- ROLE -->

                                    <td>

                                        <span class="role-badge">

                                            ${
                                                escapeHtml(
                                                    roleCategory
                                                )
                                            }

                                            ${
                                                game.role &&
                                                game.role !== roleCategory
                                                ?
                                                `
                                                <div
                                                    style="
                                                        font-size:11px;
                                                        margin-top:3px;
                                                        font-weight:500;
                                                        opacity:.75;
                                                    "
                                                >
                                                    ${escapeHtml(
                                                        game.role
                                                    )}
                                                </div>
                                                `
                                                :
                                                ''
                                            }

                                        </span>

                                    </td>


                                    <!-- VENUE -->

                                    <td>

                                        ${
                                            escapeHtml(
                                                game.court
                                                || '-'
                                            )
                                        }

                                    </td>


                                    <!-- PAYMENT STATUS -->

                                    <td>

                                        <span
                                            class="
                                                payment-status
                                                ${payment.className}
                                            "
                                        >

                                            ${payment.label}

                                        </span>

                                    </td>


                                    <!-- REPORT -->

                                    <td>

                                        ${
                                            reportAvailable

                                            ?

                                            `

                                            ${
                                                canViewReport
                                                ?
                                                `
                                                <a
                                                    href="/games/report/${game.gameid}"
                                                    class="report-button"
                                                >
                                                    View
                                                </a>
                                                `
                                                :
                                                `
                                                <span
                                                    class="report-button-disabled"
                                                    aria-disabled="true"
                                                    title="Game Report viewing is restricted"
                                                >
                                                    View
                                                </span>
                                                `
                                            }

                                            `

                                            :

                                            `

                                            <span class="no-report">
                                                No report
                                            </span>

                                            `

                                        }

                                    </td>


                                </tr>

                                `;

                            }).join('')

                        }


                    </tbody>

                </table>

                `

            }


        </div>


        <!-- =========================================
             BACK BUTTON
        ========================================== -->


        <div class="back-container">

            <a
                href="/official-activity"
                class="back-button"
            >
                ← Back to Official Activity
            </a>

        </div>


    </main>

</body>

</html>

            `);


        } catch (error) {

            console.error(
                'Error loading individual Official Activity:',
                error
            );

            res.status(500).send(
                'Error loading Official Activity details: ' +
                error.message
            );

        }

    }
);


module.exports = router;