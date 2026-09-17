const express = require('express');
const pool = require('../db');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function isOwnRecordsUser(req) {
    return ['official', 'to'].includes(req.user?.role);
}

function requireLinkedOfficial(req, res) {
    if (isOwnRecordsUser(req) && !Number.isInteger(Number(req.user?.officialid))) {
        res.status(403).send('Your user account is not linked to an official record. Please contact an administrator.');
        return false;
    }
    return true;
}

// ======================================================
// FINANCE PAYMENT CATEGORIES
// Referee category: Referee, Umpire 1, Umpire 2, Standby Referee
// T.O category: Scorer, Timer, Shot Clock Operator, Assistant Scorer
// Commissioner category: Commissioner
// ======================================================
const PAYMENT_CATEGORY_SQL = `
    CASE
        WHEN LOWER(TRIM(a.role)) IN (
            'referee', 'umpire 1', 'umpire1', 'umpire 2', 'umpire2',
            'standby referee', 'standby_referee', 'standbyreferee'
        ) THEN 'Referee'
        WHEN LOWER(TRIM(a.role)) IN (
            'scorer', 'timer', 'shot clock operator', 'shot clock',
            'assistant scorer', 'assistant_scorer', 'ass. scorer'
        ) THEN 'T.O'
        WHEN LOWER(TRIM(a.role)) IN ('commissioner', 'commissioners') THEN 'Commissioners'
        ELSE 'Other'
    END
`;

function cleanGameIds(value) {
    let ids = value || [];
    if (!Array.isArray(ids)) ids = [ids];
    return [...new Set(ids.map(Number).filter(id => Number.isInteger(id) && id > 0))];
}

function normaliseRate(raw, label) {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`Invalid payment rate for ${label}.`);
    }
    return amount;
}

function getCategoryRateMap(body) {
    return {
        Referee: normaliseRate(body.referee_rate, 'Referee'),
        'T.O': normaliseRate(body.to_rate, 'T.O'),
        Commissioners: normaliseRate(body.commissioner_rate, 'Commissioners')
    };
}

async function getMasterRates() {
    const result = await pool.query(`
        SELECT category, amount
        FROM public.finance_payment_rates
        WHERE category IN ('Referee', 'T.O', 'Commissioners')
          AND active = TRUE
        ORDER BY CASE category
            WHEN 'Referee' THEN 1
            WHEN 'T.O' THEN 2
            WHEN 'Commissioners' THEN 3
            ELSE 4
        END
    `);

    const rates = {
        Referee: 10500,
        'T.O': 8500,
        Commissioners: 10500
    };

    result.rows.forEach(row => {
        rates[row.category] = Number(row.amount) || 0;
    });

    return rates;
}

async function loadPaymentData(gameIds) {
    const gamesResult = await pool.query(`
        SELECT
            g.gameid,
            g.teama,
            g.teamb,
            g.gamedate,
            g.gametime,
            g.court,
            c.competitionname AS competition,
            c.season,
            COALESCE(g.payment_status, 'UNPAID') AS payment_status
        FROM public.games g
        LEFT JOIN public.competitions c
            ON g.competitionid = c.competitionid
        WHERE g.gameid = ANY($1::integer[])
          AND g.assigned = TRUE
          AND COALESCE(g.report_submitted, FALSE) = TRUE
          AND COALESCE(g.payment_status, 'UNPAID') <> 'PAID'
        ORDER BY g.gamedate DESC, g.gameid DESC
    `, [gameIds]);

    if (gamesResult.rows.length === 0) {
        return { games: [], assignments: [] };
    }

    const assignmentsResult = await pool.query(`
        SELECT
            a.gameid,
            a.role,
            a.officialid,
            o.fullname,
            ${PAYMENT_CATEGORY_SQL} AS category
        FROM public.assignments a
        INNER JOIN public.officials o
            ON o.officialid = a.officialid
        WHERE a.gameid = ANY($1::integer[])
        ORDER BY a.gameid, a.role, o.fullname
    `, [gameIds]);

    return {
        games: gamesResult.rows,
        assignments: assignmentsResult.rows
    };
}

function buildPaymentViewData(games, assignments, rates) {
    const officialsByGame = {};
    const summaryMap = new Map();

    for (const assignment of assignments) {
        if (!officialsByGame[assignment.gameid]) {
            officialsByGame[assignment.gameid] = [];
        }

        const category = assignment.category || 'Other';
        const amount = Object.prototype.hasOwnProperty.call(rates, category)
            ? Number(rates[category]) || 0
            : 0;

        const item = {
            gameid: assignment.gameid,
            officialid: assignment.officialid,
            fullname: assignment.fullname,
            role: assignment.role,
            category,
            amount
        };

        officialsByGame[assignment.gameid].push(item);

        const key = String(assignment.officialid);
        if (!summaryMap.has(key)) {
            summaryMap.set(key, {
                officialid: assignment.officialid,
                fullname: assignment.fullname,
                category,
                games: 0,
                total: 0,
                rate: amount
            });
        }

        const summary = summaryMap.get(key);
        summary.games += 1;
        summary.total += amount;
        // Keep the current category/rate visible. An official should normally have one category.
        summary.category = category;
        summary.rate = amount;
    }

    // Organise each game's officials by role so the table can resemble the supplied spreadsheet.
    const roleOrder = [
        'Referee',
        'Umpire 1',
        'Umpire1',
        'Umpire 2',
        'Umpire2',
        'Standby Referee',
        'Standby referee',
        'Scorer',
        'Timer',
        'Shot Clock Operator',
        'Assistant Scorer',
        'Commissioner'
    ];

    function roleRank(role) {
        const idx = roleOrder.findIndex(r => String(r).toLowerCase() === String(role).toLowerCase());
        return idx === -1 ? 999 : idx;
    }

    Object.values(officialsByGame).forEach(items => {
        items.sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.fullname.localeCompare(b.fullname));
    });

    const summary = Array.from(summaryMap.values()).sort((a, b) => a.fullname.localeCompare(b.fullname));
    const grandTotal = summary.reduce((sum, item) => sum + item.total, 0);

    return { officialsByGame, summary, grandTotal };
}

// ======================================================
// FINANCE - PAYMENT HISTORY / FILTER HELPERS
// ======================================================

function cleanQueryText(value) {
    return String(value || '').trim();
}

function buildFinanceFilters(query, req = null) {
    const season = cleanQueryText(query.season);
    const competition = cleanQueryText(query.competition);
    const official = cleanQueryText(query.official);
    const fromDate = cleanQueryText(query.fromDate || query.from_date);
    const toDate = cleanQueryText(query.toDate || query.to_date);
    const reference = cleanQueryText(query.reference || query.payment_reference);
    const status = cleanQueryText(query.status).toUpperCase();

    const where = [];
    const params = [];

    if (season) {
        params.push(season);
        where.push(`c.season = $${params.length}`);
    }

    if (competition) {
        params.push(competition);
        where.push(`c.competitionname = $${params.length}`);
    }

    if (official) {
        params.push(`%${official}%`);
        where.push(`o.fullname ILIKE $${params.length}`);
    }

    if (fromDate) {
        params.push(fromDate);
        where.push(`g.gamedate >= $${params.length}::date`);
    }

    if (toDate) {
        params.push(toDate);
        where.push(`g.gamedate <= $${params.length}::date`);
    }

    if (reference) {
        params.push(`%${reference}%`);
        where.push(`fp.payment_reference ILIKE $${params.length}`);
    }

    if (status && ['PAID', 'UNPAID', 'PARTIAL', 'PARTIALLY PAID', 'PENDING'].includes(status)) {
        if (status === 'PARTIALLY PAID') {
            where.push(`UPPER(COALESCE(fp.payment_status, '')) IN ('PARTIAL', 'PARTIALLY PAID')`);
        } else if (status === 'PENDING') {
            where.push(`UPPER(COALESCE(fp.payment_status, '')) IN ('PENDING', 'UNPAID')`);
        } else {
            params.push(status);
            where.push(`UPPER(COALESCE(fp.payment_status, 'UNPAID')) = $${params.length}`);
        }
    }

    return { where, params, values: { season, competition, official, fromDate, toDate, reference, status }, ownOfficialId: req && isOwnRecordsUser(req) ? Number(req.user.officialid) : null };
}

async function getFinanceFilterOptions(req = null) {
    const [seasonsResult, competitionsResult, officialsResult] = await Promise.all([
        pool.query(`
            SELECT DISTINCT c.season
            FROM public.competitions c
            WHERE c.season IS NOT NULL AND TRIM(c.season) <> ''
            ORDER BY c.season DESC
        `),
        pool.query(`
            SELECT DISTINCT c.competitionname AS competition
            FROM public.competitions c
            WHERE c.competitionname IS NOT NULL AND TRIM(c.competitionname) <> ''
            ORDER BY c.competitionname
        `),
        pool.query(`
            SELECT officialid, fullname
            FROM public.officials
            WHERE fullname IS NOT NULL AND TRIM(fullname) <> ''
              AND ($1::integer IS NULL OR officialid = $1)
            ORDER BY fullname
        `, [req && isOwnRecordsUser(req) ? Number(req.user.officialid) : null])
    ]);

    return {
        seasons: seasonsResult.rows,
        competitions: competitionsResult.rows,
        officials: officialsResult.rows
    };
}

async function loadPaymentHistory(filters) {
    const conditionsList = [...filters.where];
    const params = [...filters.params];
    if (filters.ownOfficialId) {
        params.push(filters.ownOfficialId);
        conditionsList.push(`fpi.officialid = $${params.length}`);
    }
    const conditions = conditionsList.length
        ? `WHERE ${conditionsList.join(' AND ')}`
        : '';

    const result = await pool.query(`
        SELECT
            fp.paymentid,
            fp.payment_reference,
            fp.payment_status,
            fp.total_amount,
            fp.payment_method,
            fp.paid_at,
            COUNT(DISTINCT fpi.gameid)::integer AS game_count,
            COUNT(DISTINCT fpi.officialid)::integer AS official_count,
            MIN(g.gamedate) AS first_game_date,
            MAX(g.gamedate) AS last_game_date,
            STRING_AGG(DISTINCT o.fullname, ', ' ORDER BY o.fullname) AS officials,
            STRING_AGG(DISTINCT c.competitionname, ', ' ORDER BY c.competitionname) AS competitions,
            STRING_AGG(DISTINCT c.season, ', ' ORDER BY c.season) AS seasons
        FROM public.finance_payments fp
        INNER JOIN public.finance_payment_items fpi
            ON fpi.paymentid = fp.paymentid
        INNER JOIN public.games g
            ON g.gameid = fpi.gameid
        LEFT JOIN public.competitions c
            ON c.competitionid = g.competitionid
        LEFT JOIN public.officials o
            ON o.officialid = fpi.officialid
        ${conditions}
        GROUP BY
            fp.paymentid,
            fp.payment_reference,
            fp.payment_status,
            fp.total_amount,
            fp.payment_method,
            fp.paid_at
        ORDER BY fp.paid_at DESC NULLS LAST, fp.paymentid DESC
    `, params);

    return result.rows.map(row => ({
        ...row,
        total_amount: Number(row.total_amount) || 0,
        game_count: Number(row.game_count) || 0,
        official_count: Number(row.official_count) || 0
    }));
}

async function loadFinanceTotals(filters) {
    // Payment totals use the full set of filters, including payment reference/status.
    // EXISTS prevents a payment from being counted multiple times when it has
    // several payment items.
    const paymentConditionsList = [...filters.where];
    const paymentParams = [...filters.params];
    if (filters.ownOfficialId) {
        paymentParams.push(filters.ownOfficialId);
        paymentConditionsList.push(`fpi.officialid = $${paymentParams.length}`);
    }
    const paymentConditions = paymentConditionsList.length
        ? `AND ${paymentConditionsList.join(' AND ')}`
        : '';

    const paidResult = await pool.query(`
        SELECT COALESCE(SUM(fp.total_amount), 0) AS total_paid
        FROM public.finance_payments fp
        WHERE EXISTS (
            SELECT 1
            FROM public.finance_payment_items fpi
            INNER JOIN public.games g
                ON g.gameid = fpi.gameid
            LEFT JOIN public.competitions c
                ON c.competitionid = g.competitionid
            LEFT JOIN public.officials o
                ON o.officialid = fpi.officialid
            WHERE fpi.paymentid = fp.paymentid
            ${paymentConditions}
        )
    `, paymentParams);

    // Outstanding payable amount is based on unpaid completed games.
    // Payment reference/status do not apply to an outstanding game because
    // an unpaid game has no completed payment transaction to match.
    const outstandingValues = filters.values;
    const outstandingWhere = [];
    const outstandingParams = [];

    if (outstandingValues.season) {
        outstandingParams.push(outstandingValues.season);
        outstandingWhere.push(`c.season = $${outstandingParams.length}`);
    }

    if (outstandingValues.competition) {
        outstandingParams.push(outstandingValues.competition);
        outstandingWhere.push(`c.competitionname = $${outstandingParams.length}`);
    }

    if (outstandingValues.official) {
        outstandingParams.push(`%${outstandingValues.official}%`);
        outstandingWhere.push(`o.fullname ILIKE $${outstandingParams.length}`);
    }

    if (outstandingValues.fromDate) {
        outstandingParams.push(outstandingValues.fromDate);
        outstandingWhere.push(`g.gamedate >= $${outstandingParams.length}::date`);
    }

    if (outstandingValues.toDate) {
        outstandingParams.push(outstandingValues.toDate);
        outstandingWhere.push(`g.gamedate <= $${outstandingParams.length}::date`);
    }

    if (filters.ownOfficialId) {
        outstandingParams.push(filters.ownOfficialId);
        outstandingWhere.push(`a.officialid = $${outstandingParams.length}`);
    }

    const outstandingConditions = outstandingWhere.length
        ? `AND ${outstandingWhere.join(' AND ')}`
        : '';

    const payableResult = await pool.query(`
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
        INNER JOIN public.games g
            ON g.gameid = a.gameid
        LEFT JOIN public.competitions c
            ON c.competitionid = g.competitionid
        LEFT JOIN public.officials o
            ON o.officialid = a.officialid
        WHERE g.assigned = TRUE
          AND COALESCE(g.report_submitted, FALSE) = TRUE
          AND COALESCE(g.payment_status, 'UNPAID') <> 'PAID'
          ${outstandingConditions}
    `, outstandingParams);

    const totalPaid = Number(paidResult.rows[0]?.total_paid) || 0;
    const outstanding = Number(payableResult.rows[0]?.outstanding) || 0;

    return {
        totalPaid,
        outstanding,
        totalPayable: totalPaid + outstanding
    };
}

// ======================================================
// FINANCE - GAMES READY FOR PAYMENT
// Only games already completed in Statistics are shown.
// ======================================================
router.get('/finance', requireRole('admin', 'official', 'to', 'finance'), async (req, res) => {
    try {
        if (!requireLinkedOfficial(req, res)) return;
        const result = await pool.query(`
            SELECT
                g.gameid,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                g.court,
                c.competitionname AS competition,
                c.season,
                COALESCE(g.report_submitted, FALSE) AS report_submitted,
                COALESCE(g.payment_status, 'UNPAID') AS payment_status,
                g.paymentid,
                (
                    SELECT COUNT(*)
                    FROM public.assignments a
                    WHERE a.gameid = g.gameid
                ) AS official_count
            FROM public.games g
            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = TRUE
              AND (
                    $1::text IN ('admin', 'finance')
                    OR ($1::text IN ('official', 'to') AND $2::integer IS NOT NULL
                        AND EXISTS (SELECT 1 FROM public.assignments own_a
                                    WHERE own_a.gameid = g.gameid
                                      AND own_a.officialid = $2))
                  )
            ORDER BY
                CASE
                    WHEN COALESCE(g.payment_status, 'UNPAID') = 'PAID' THEN 1
                    ELSE 0
                END,
                g.gamedate DESC,
                g.gametime DESC,
                g.gameid DESC
        `, [req.user.role, req.user.officialid]);

        const competitionsResult = await pool.query(`
            SELECT DISTINCT c.competitionname AS competition
            FROM public.games g
            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = TRUE
              AND c.competitionname IS NOT NULL
              AND (
                    $1::text IN ('admin', 'finance')
                    OR ($1::text IN ('official', 'to') AND EXISTS (
                        SELECT 1 FROM public.assignments own_a
                        WHERE own_a.gameid = g.gameid AND own_a.officialid = $2
                    ))
                  )
            ORDER BY c.competitionname
        `, [req.user.role, req.user.officialid]);

        const seasonsResult = await pool.query(`
            SELECT DISTINCT c.season
            FROM public.games g
            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = TRUE
              AND c.season IS NOT NULL
              AND c.season <> ''
              AND (
                    $1::text IN ('admin', 'finance')
                    OR ($1::text IN ('official', 'to') AND EXISTS (
                        SELECT 1 FROM public.assignments own_a
                        WHERE own_a.gameid = g.gameid AND own_a.officialid = $2
                    ))
                  )
            ORDER BY c.season DESC
        `, [req.user.role, req.user.officialid]);

        const [options, totals] = await Promise.all([
            getFinanceFilterOptions(req),
            loadFinanceTotals({ where: [], params: [], values: {}, ownOfficialId: isOwnRecordsUser(req) ? Number(req.user.officialid) : null })
        ]);

        let paymentHistory = [];
        try {
            paymentHistory = await loadPaymentHistory({
                where: [],
                params: [],
                values: {},
                ownOfficialId: isOwnRecordsUser(req) ? Number(req.user.officialid) : null
            });
        } catch (historyError) {
            console.warn('Payment history could not be loaded on /finance:', historyError.message);
        }

        res.render('finance/index', {
            games: result.rows,
            competitions: competitionsResult.rows,
            seasons: seasonsResult.rows
        });
    } catch (error) {
        console.error('Error loading Finance:', error);
        res.status(500).send('Error loading Finance: ' + error.message);
    }
});

// ======================================================
// FINANCE - EXPORT PAYMENT HISTORY TO EXCEL
// Uses exactly the same filters as the Payment History page.
// ======================================================
// ======================================================
// FINANCE - PAYMENT HISTORY
// Separate page for searching and reviewing completed payments.
// ======================================================
router.get('/finance/history', requireRole('admin', 'official', 'to', 'finance'), async (req, res) => {
    try {
        if (!requireLinkedOfficial(req, res)) return;
        const filters = buildFinanceFilters(req.query, req);

        const [history, options, totals] = await Promise.all([
            loadPaymentHistory(filters),
            getFinanceFilterOptions(req),
            loadFinanceTotals(filters)
        ]);

        res.render('finance/history', {
            competitions: options.competitions,
            seasons: options.seasons,
            officials: options.officials,
            paymentHistory: history,
            financeTotals: totals,
            financeFilters: filters.values
        });
    } catch (error) {
        console.error('Error loading Finance payment history:', error);
        res.status(500).send('Error loading Finance payment history: ' + error.message);
    }
});

router.get('/finance/export/excel', requireRole('admin', 'official', 'to', 'finance'), async (req, res) => {
    try {
        if (!requireLinkedOfficial(req, res)) return;
        const filters = buildFinanceFilters(req.query, req);
        const [rows, totals] = await Promise.all([
            loadPaymentHistory(filters),
            loadFinanceTotals(filters)
        ]);

        const exportRows = rows.map(row => ({
            'Payment Reference': row.payment_reference || '',
            'Payment Date': row.paid_at ? new Date(row.paid_at).toLocaleDateString() : '',
            'Official(s)': row.officials || '',
            'Competition(s)': row.competitions || '',
            'Season(s)': row.seasons || '',
            'Games': row.game_count || 0,
            'Officials': row.official_count || 0,
            'Amount Paid (RWF)': Number(row.total_amount) || 0,
            'Payment Method': row.payment_method || '',
            'Status': row.payment_status || 'PAID'
        }));

        // Add a summary section below the transaction table.
        exportRows.push({});
        exportRows.push({ 'Payment Reference': 'FINANCE SUMMARY' });
        exportRows.push({ 'Payment Reference': 'Total Payable', 'Amount Paid (RWF)': totals.totalPayable });
        exportRows.push({ 'Payment Reference': 'Total Paid', 'Amount Paid (RWF)': totals.totalPaid });
        exportRows.push({ 'Payment Reference': 'Outstanding Amount', 'Amount Paid (RWF)': totals.outstanding });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportRows);

        worksheet['!cols'] = [
            { wch: 24 }, { wch: 15 }, { wch: 35 }, { wch: 28 },
            { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 20 },
            { wch: 20 }, { wch: 16 }
        ];

        XLSX.utils.book_append_sheet(workbook, worksheet, 'Payment History');

        const buffer = XLSX.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx'
        });

        const dateStamp = new Date().toISOString().slice(0, 10);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="ARAB_Payment_History_${dateStamp}.xlsx"`
        );
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.send(buffer);
    } catch (error) {
        console.error('Error exporting Finance to Excel:', error);
        res.status(500).send('Error exporting Finance payment history to Excel: ' + error.message);
    }
});

// ======================================================
// FINANCE - EXPORT PAYMENT HISTORY TO PDF
// Uses exactly the same filters as the Payment History page.
// ======================================================
router.get('/finance/export/pdf', requireRole('admin', 'official', 'to', 'finance'), async (req, res) => {
    try {
        if (!requireLinkedOfficial(req, res)) return;
        const filters = buildFinanceFilters(req.query, req);
        const [rows, totals] = await Promise.all([
            loadPaymentHistory(filters),
            loadFinanceTotals(filters)
        ]);

        const dateStamp = new Date().toISOString().slice(0, 10);

        res.setHeader(
            'Content-Disposition',
            `attachment; filename="ARAB_Payment_History_${dateStamp}.pdf"`
        );
        res.setHeader('Content-Type', 'application/pdf');

        const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',
            margin: 35
        });

        doc.pipe(res);

        doc.fontSize(18).text('ARAB Reporting System', { align: 'center' });
        doc.moveDown(0.25);
        doc.fontSize(14).text('Payment History Report', { align: 'center' });
        doc.moveDown(0.8);

        const activeFilters = [];
        if (filters.values.season) activeFilters.push(`Season: ${filters.values.season}`);
        if (filters.values.competition) activeFilters.push(`Competition: ${filters.values.competition}`);
        if (filters.values.official) activeFilters.push(`Official: ${filters.values.official}`);
        if (filters.values.fromDate) activeFilters.push(`From: ${filters.values.fromDate}`);
        if (filters.values.toDate) activeFilters.push(`To: ${filters.values.toDate}`);
        if (filters.values.reference) activeFilters.push(`Reference: ${filters.values.reference}`);
        if (filters.values.status) activeFilters.push(`Status: ${filters.values.status}`);

        doc.fontSize(9).fillColor('#555555').text(
            activeFilters.length ? `Filters: ${activeFilters.join(' | ')}` : 'Filters: All payment records'
        );
        doc.fillColor('#000000');
        doc.moveDown(0.7);

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text(`Total Payable: ${Number(totals.totalPayable).toLocaleString()} RWF`);
        doc.text(`Total Paid: ${Number(totals.totalPaid).toLocaleString()} RWF`);
        doc.text(`Outstanding: ${Number(totals.outstanding).toLocaleString()} RWF`);
        doc.moveDown(0.8);

        const columns = [
            { label: 'Reference', width: 100 },
            { label: 'Date', width: 62 },
            { label: 'Official(s)', width: 150 },
            { label: 'Competition', width: 115 },
            { label: 'Season', width: 65 },
            { label: 'Games', width: 40 },
            { label: 'Amount RWF', width: 75 },
            { label: 'Method', width: 80 },
            { label: 'Status', width: 65 }
        ];

        const tableX = doc.x;
        let y = doc.y;

        const drawHeader = () => {
            doc.font('Helvetica-Bold').fontSize(7);
            let x = tableX;
            columns.forEach(col => {
                doc.rect(x, y, col.width, 22).stroke();
                doc.text(col.label, x + 3, y + 6, {
                    width: col.width - 6,
                    height: 16,
                    ellipsis: true
                });
                x += col.width;
            });
            y += 22;
            doc.font('Helvetica').fontSize(6.5);
        };

        const drawRow = (row) => {
            const values = [
                row.payment_reference || '-',
                row.paid_at ? new Date(row.paid_at).toLocaleDateString() : '-',
                row.officials || '-',
                row.competitions || '-',
                row.seasons || '-',
                String(row.game_count || 0),
                Number(row.total_amount || 0).toLocaleString(),
                row.payment_method || '-',
                row.payment_status || 'PAID'
            ];

            const rowHeight = 24;

            if (y + rowHeight > doc.page.height - 35) {
                doc.addPage();
                y = 35;
                drawHeader();
            }

            let x = tableX;
            values.forEach((value, index) => {
                const col = columns[index];
                doc.rect(x, y, col.width, rowHeight).stroke();
                doc.text(String(value), x + 3, y + 7, {
                    width: col.width - 6,
                    height: rowHeight - 8,
                    ellipsis: true
                });
                x += col.width;
            });

            y += rowHeight;
        };

        drawHeader();

        if (rows.length === 0) {
            doc.text('No payment records match the selected filters.', tableX + 5, y + 10);
            y += 30;
        } else {
            rows.forEach(drawRow);
        }

        doc.moveTo(tableX, y + 12);
        doc.font('Helvetica-Bold').fontSize(9);
        doc.text(`Total Paid: ${Number(totals.totalPaid).toLocaleString()} RWF`, tableX, y + 20);
        doc.text(`Outstanding: ${Number(totals.outstanding).toLocaleString()} RWF`, tableX + 180, y + 20);
        doc.text(`Total Payable: ${Number(totals.totalPayable).toLocaleString()} RWF`, tableX + 380, y + 20);

        doc.end();
    } catch (error) {
        console.error('Error exporting Finance to PDF:', error);
        if (!res.headersSent) {
            res.status(500).send('Error exporting Finance payment history to PDF: ' + error.message);
        } else {
            res.end();
        }
    }
});

// ======================================================
// FINANCE - FILTERED PAYMENT HISTORY DATA
// Returns the same filtered history as JSON so Excel/PDF
// export can use exactly the same filter criteria.
// ======================================================
router.get('/finance/history/data', requireRole('admin', 'official', 'to', 'finance'), async (req, res) => {
    try {
        if (!requireLinkedOfficial(req, res)) return;
        const filters = buildFinanceFilters(req.query, req);
        const [history, totals] = await Promise.all([
            loadPaymentHistory(filters),
            loadFinanceTotals(filters)
        ]);

        res.json({
            filters: filters.values,
            totals,
            rows: history
        });
    } catch (error) {
        console.error('Error loading Finance history data:', error);
        res.status(500).json({
            error: 'Error loading Finance history data.',
            message: error.message
        });
    }
});


// ======================================================
// FINANCE - PAYMENT SELECTION SHORTCUT
// GET /finance/payment safely returns to the Finance game
// selection screen. The actual payment review remains POST.
// ======================================================
router.get('/finance/payment', requireRole('admin', 'official', 'to', 'finance'), (req, res) => {
    res.redirect('/finance');
});

// ======================================================
// FINANCE - PAYMENT RATE REVIEW
// After selecting games, show rates first. These rates
// apply ONLY to the current payment batch.
// ======================================================
router.post('/finance/payment', requireRole('admin', 'finance'), async (req, res) => {
    try {
        const gameIds = cleanGameIds(req.body.gameIds);
        if (gameIds.length === 0) {
            return res.status(400).send('Please select at least one game.');
        }

        const data = await loadPaymentData(gameIds);
        if (data.games.length === 0) {
            return res.status(404).send('No unpaid completed games were found for payment.');
        }

        const rates = await getMasterRates();

        res.render('finance/payment', {
            step: 'rates',
            games: data.games,
            officialsByGame: {},
            summary: [],
            grandTotal: 0,
            rates,
            gameIds
        });
    } catch (error) {
        console.error('Error loading payment rates:', error);
        res.status(500).send('Error loading payment rates: ' + error.message);
    }
});

// ======================================================
// FINANCE - APPLY RATES AND OPEN PAYMENT PAGE
// The submitted rates are carried into the payment page.
// They do NOT change the master category rates.
// ======================================================
router.post('/finance/payment/apply', requireRole('admin', 'finance'), async (req, res) => {
    try {
        const gameIds = cleanGameIds(req.body.gameIds);
        if (gameIds.length === 0) {
            return res.status(400).send('Please select at least one game.');
        }

        let rates;
        try {
            rates = getCategoryRateMap(req.body);
        } catch (rateError) {
            return res.status(400).send(rateError.message);
        }

        const data = await loadPaymentData(gameIds);
        if (data.games.length === 0) {
            return res.status(404).send('No unpaid completed games were found for payment.');
        }

        const viewData = buildPaymentViewData(data.games, data.assignments, rates);

        res.render('finance/payment', {
            step: 'payment',
            games: data.games,
            officialsByGame: viewData.officialsByGame,
            summary: viewData.summary,
            grandTotal: viewData.grandTotal,
            rates,
            gameIds
        });
    } catch (error) {
        console.error('Error applying payment rates:', error);
        res.status(500).send('Error applying payment rates: ' + error.message);
    }
});

// ======================================================
// FINANCE - PAYMENT RATES MASTER PAGE
// Kept for future administration. This changes default
// rates, not a specific payment batch.
// ======================================================
router.get('/finance/rates', requireRole('admin', 'finance'), async (req, res) => {
    try {
        const rates = await getMasterRates();
        res.render('finance/rates', { rates, saved: req.query.saved === '1' });
    } catch (error) {
        console.error('Error loading payment rates:', error);
        res.status(500).send('Error loading payment rates: ' + error.message);
    }
});

router.post('/finance/rates', requireRole('admin', 'finance'), async (req, res) => {
    try {
        const rates = getCategoryRateMap(req.body);

        for (const [category, amount] of Object.entries(rates)) {
            await pool.query(`
                INSERT INTO public.finance_payment_rates (role, category, amount, active)
                VALUES ($1, $2, $3, TRUE)
                ON CONFLICT (role)
                DO UPDATE SET
                    category = EXCLUDED.category,
                    amount = EXCLUDED.amount,
                    active = TRUE,
                    updated_at = CURRENT_TIMESTAMP
            `, [category, category, amount]);
        }

        res.redirect('/finance/rates?saved=1');
    } catch (error) {
        console.error('Error saving payment rates:', error);
        res.status(400).send('Error saving payment rates: ' + error.message);
    }
});

// ======================================================
// FINANCE - VIEW AN EXISTING PAYMENT
// Clicking the Paid button on the Finance page opens the
// complete payment-success page for that payment transaction.
// All games belonging to the same payment are displayed.
// ======================================================
router.get('/finance/payment-success/:paymentId', requireRole('admin', 'official', 'to', 'finance'), async (req, res) => {
    try {
        if (!requireLinkedOfficial(req, res)) return;
        const paymentId = Number(req.params.paymentId);

        if (!Number.isInteger(paymentId) || paymentId <= 0) {
            return res.status(400).send('Invalid payment ID.');
        }

        const paymentResult = await pool.query(`
            SELECT
                paymentid,
                payment_reference,
                payment_status,
                total_amount,
                payment_method,
                paid_at
            FROM public.finance_payments
            WHERE paymentid = $1
              AND ($2::integer IS NULL OR EXISTS (
                    SELECT 1 FROM public.finance_payment_items own_fpi
                    WHERE own_fpi.paymentid = public.finance_payments.paymentid
                      AND own_fpi.officialid = $2
              ))
        `, [paymentId, isOwnRecordsUser(req) ? Number(req.user.officialid) : null]);

        if (paymentResult.rows.length === 0) {
            return res.status(404).send('Payment transaction not found.');
        }

        const payment = paymentResult.rows[0];

        const paidGamesResult = await pool.query(`
            SELECT
                g.gameid,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                g.court,
                c.competitionname AS competition,
                c.season,
                COALESCE(g.payment_status, 'PAID') AS payment_status,
                g.paid_at
            FROM public.games g
            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid
            WHERE g.paymentid = $1
              AND ($2::integer IS NULL OR EXISTS (
                    SELECT 1 FROM public.finance_payment_items own_fpi
                    WHERE own_fpi.paymentid = $1 AND own_fpi.gameid = g.gameid AND own_fpi.officialid = $2
              ))
            ORDER BY
                CASE
                    WHEN COALESCE(g.payment_status, 'UNPAID') = 'PAID' THEN 1
                    ELSE 0
                END,
                g.gamedate DESC,
                g.gametime DESC,
                g.gameid DESC
        `, [paymentId, isOwnRecordsUser(req) ? Number(req.user.officialid) : null]);

        // Build the summary from the payment items that were actually recorded.
        // This preserves the historical amount paid to each official even if
        // the master payment rates are changed later.
        const summaryResult = await pool.query(`
            SELECT
                fpi.officialid,
                COALESCE(o.fullname, 'Unknown Official') AS fullname,
                fpi.category,
                COUNT(DISTINCT fpi.gameid)::integer AS games,
                CASE
                    WHEN COUNT(DISTINCT fpi.gameid) > 0
                    THEN ROUND(SUM(fpi.amount) / COUNT(DISTINCT fpi.gameid), 2)
                    ELSE 0
                END AS rate,
                COALESCE(SUM(fpi.amount), 0) AS total
            FROM public.finance_payment_items fpi
            LEFT JOIN public.officials o
                ON o.officialid = fpi.officialid
            WHERE fpi.paymentid = $1
              AND ($2::integer IS NULL OR fpi.officialid = $2)
            GROUP BY fpi.officialid, o.fullname, fpi.category
            ORDER BY o.fullname
        `, [paymentId, isOwnRecordsUser(req) ? Number(req.user.officialid) : null]);

        const paymentSummary = summaryResult.rows.map(row => ({
            officialid: row.officialid,
            fullname: row.fullname,
            category: row.category,
            games: Number(row.games) || 0,
            rate: Number(row.rate) || 0,
            total: Number(row.total) || 0
        }));

        const summaryTotal = paymentSummary.reduce((sum, item) => sum + item.total, 0);

        res.render('finance/payment-success', {
            paymentReference: payment.payment_reference,
            paymentId: payment.paymentid,
            totalAmount: Number(payment.total_amount) || 0,
            gameCount: paidGamesResult.rows.length,
            paymentMethod: payment.payment_method || 'Manual',
            paidAt: payment.paid_at,
            paidGames: paidGamesResult.rows,
            paymentSummary,
            summaryTotal
        });
    } catch (error) {
        console.error('Error loading payment transaction:', error);
        res.status(500).send('Error loading payment transaction: ' + error.message);
    }
});

// ======================================================
// FINANCE - PROCESS PAYMENT
// Uses the rates displayed/applied on the Payment page.
// The server recalculates the amount from the submitted
// batch rates instead of trusting hidden amount fields.
// ======================================================
router.post('/finance/payment/process', requireRole('admin', 'finance'), async (req, res) => {
    const client = await pool.connect();

    try {
        const gameIds = cleanGameIds(req.body.gameIds);
        if (gameIds.length === 0) {
            return res.status(400).send('Please select at least one game.');
        }

        let officialIds = req.body.officialIds || [];
        let roles = req.body.roles || [];
        let itemGameIds = req.body.itemGameIds || [];

        if (!Array.isArray(officialIds)) officialIds = [officialIds];
        if (!Array.isArray(roles)) roles = [roles];
        if (!Array.isArray(itemGameIds)) itemGameIds = [itemGameIds];

        if (officialIds.length !== roles.length || officialIds.length !== itemGameIds.length) {
            return res.status(400).send('Invalid payment data. Please return to Finance and try again.');
        }

        let rates;
        try {
            rates = getCategoryRateMap(req.body);
        } catch (rateError) {
            return res.status(400).send(rateError.message);
        }

        const cleanItems = [];
        for (let i = 0; i < officialIds.length; i++) {
            const gameid = Number(itemGameIds[i]);
            const officialid = Number(officialIds[i]);
            const role = String(roles[i] || '').trim();

            if (!Number.isInteger(gameid) || !Number.isInteger(officialid) || !role) {
                return res.status(400).send('One or more payment items are invalid.');
            }

            cleanItems.push({ gameid, officialid, role });
        }

        await client.query('BEGIN');

        const gamesResult = await client.query(`
            SELECT gameid, COALESCE(payment_status, 'UNPAID') AS payment_status
            FROM public.games
            WHERE gameid = ANY($1::integer[])
              AND assigned = TRUE
              AND COALESCE(report_submitted, FALSE) = TRUE
            FOR UPDATE
        `, [gameIds]);

        if (gamesResult.rows.length !== gameIds.length) {
            await client.query('ROLLBACK');
            return res.status(400).send('One or more selected games are not eligible for payment.');
        }

        if (gamesResult.rows.some(g => String(g.payment_status).toUpperCase() === 'PAID')) {
            await client.query('ROLLBACK');
            return res.status(400).send('One or more selected games have already been paid.');
        }

        const validAssignmentsResult = await client.query(`
            SELECT
                a.gameid,
                a.officialid,
                a.role,
                ${PAYMENT_CATEGORY_SQL} AS category
            FROM public.assignments a
            WHERE a.gameid = ANY($1::integer[])
        `, [gameIds]);

        const validAssignments = new Map(
            validAssignmentsResult.rows.map(a => [
                `${a.gameid}|${a.officialid}|${String(a.role).toLowerCase()}`,
                a
            ])
        );

        for (const item of cleanItems) {
            const key = `${item.gameid}|${item.officialid}|${item.role.toLowerCase()}`;
            const assignment = validAssignments.get(key);
            if (!assignment) {
                await client.query('ROLLBACK');
                return res.status(400).send(`Invalid official assignment for game ${item.gameid}.`);
            }

            item.category = assignment.category;
            item.amount = Object.prototype.hasOwnProperty.call(rates, item.category)
                ? Number(rates[item.category]) || 0
                : 0;
        }

        if (cleanItems.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).send('No assigned officials were found for the selected games.');
        }

        const totalAmount = cleanItems.reduce((sum, item) => sum + item.amount, 0);
        const reference = `ARAB-PAY-${Date.now()}`;

        const paymentResult = await client.query(`
            INSERT INTO public.finance_payments
                (payment_reference, payment_status, total_amount, payment_method, paid_at)
            VALUES ($1, 'PAID', $2, $3, CURRENT_TIMESTAMP)
            RETURNING paymentid
        `, [reference, totalAmount, req.body.payment_method || 'Manual']);

        const paymentId = paymentResult.rows[0].paymentid;

        for (const item of cleanItems) {
            await client.query(`
                INSERT INTO public.finance_payment_items
                    (paymentid, gameid, officialid, role, category, amount)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [paymentId, item.gameid, item.officialid, item.role, item.category, item.amount]);
        }

        await client.query(`
            UPDATE public.games
            SET
                payment_status = 'PAID',
                paid_at = CURRENT_TIMESTAMP,
                paymentid = $1
            WHERE gameid = ANY($2::integer[])
        `, [paymentId, gameIds]);

        // Build the official summary from the payment items actually inserted.
        const paymentSummaryResult = await client.query(`
            SELECT
                fpi.officialid,
                COALESCE(o.fullname, 'Unknown Official') AS fullname,
                fpi.category,
                COUNT(DISTINCT fpi.gameid)::integer AS games,
                CASE
                    WHEN COUNT(DISTINCT fpi.gameid) > 0
                    THEN ROUND(SUM(fpi.amount) / COUNT(DISTINCT fpi.gameid), 2)
                    ELSE 0
                END AS rate,
                COALESCE(SUM(fpi.amount), 0) AS total
            FROM public.finance_payment_items fpi
            LEFT JOIN public.officials o
                ON o.officialid = fpi.officialid
            WHERE fpi.paymentid = $1
            GROUP BY fpi.officialid, o.fullname, fpi.category
            ORDER BY o.fullname
        `, [paymentId]);

        const paymentSummary = paymentSummaryResult.rows.map(row => ({
            officialid: row.officialid,
            fullname: row.fullname,
            category: row.category,
            games: Number(row.games) || 0,
            rate: Number(row.rate) || 0,
            total: Number(row.total) || 0
        }));

        const summaryTotal = paymentSummary.reduce((sum, item) => sum + item.total, 0);

        // Get the exact games included in this payment before committing.
        // This information is displayed on the Payment Successful page.
        const paidGamesResult = await client.query(`
            SELECT
                g.gameid,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                g.court,
                c.competitionname AS competition,
                c.season,
                COALESCE(g.payment_status, 'PAID') AS payment_status,
                g.paid_at
            FROM public.games g
            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid
            WHERE g.gameid = ANY($1::integer[])
            ORDER BY g.gamedate DESC, g.gametime DESC, g.gameid DESC
        `, [gameIds]);

        await client.query('COMMIT');

        res.render('finance/payment-success', {
            paymentReference: reference,
            paymentId,
            totalAmount,
            gameCount: gameIds.length,
            paymentMethod: req.body.payment_method || 'Manual',
            paidAt: paidGamesResult.rows.length ? paidGamesResult.rows[0].paid_at : new Date(),
            paidGames: paidGamesResult.rows,
            paymentSummary,
            summaryTotal
        });
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('Error processing payment:', error);
        res.status(500).send('Error processing payment: ' + error.message);
    } finally {
        client.release();
    }
});

module.exports = router;
