const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function getActualRole(req) {
    return String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();
}

function requireAvailabilityOwner(req, res, next) {
    const role = getActualRole(req);

    // Administrators do not need a personal availability record unless
    // their account is also linked to an official profile.
    if (!['official', 'to'].includes(role)) {
        return res.status(403).send(
            'Access denied. My Availability is available to official and T.O accounts.'
        );
    }

    if (!req.user?.officialid) {
        return res.status(403).send(
            'Your user account is not linked to an official profile.'
        );
    }

    return next();
}

function parseDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return text;
}

function dateToInput(value) {
    if (!value) return '';
    const text = String(value);
    const match = text.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
}

function buildCalendar(year, month, periods) {
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mondayIndex = (firstDay.getUTCDay() + 6) % 7;
    const cells = [];

    for (let i = 0; i < mondayIndex; i++) cells.push(null);

    for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const blocked = periods.find(period => {
            const start = dateToInput(period.start_date);
            const end = dateToInput(period.end_date);
            return iso >= start && iso <= end;
        });

        cells.push({
            number: day,
            unavailable: Boolean(blocked),
            reason: blocked?.reason || ''
        });
    }

    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
}

function monthNavigation(year, month) {
    const previous = new Date(Date.UTC(year, month - 2, 1));
    const next = new Date(Date.UTC(year, month, 1));
    return {
        previousMonth: `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`,
        nextMonth: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
    };
}

function renderPage(res, data) {
    return res.render('availability/index', data);
}

// ======================================================
// MY AVAILABILITY
// ======================================================
router.get(
    '/my-availability',
    requireAuth,
    requireAvailabilityOwner,
    async (req, res) => {
        try {
            const officialId = Number(req.user.officialid);

            const officialResult = await pool.query(`
                SELECT officialid, fullname
                FROM public.officials
                WHERE officialid = $1
                LIMIT 1
            `, [officialId]);

            if (officialResult.rows.length === 0) {
                return res.status(404).send('Official profile not found.');
            }

            const availabilityResult = await pool.query(`
                SELECT
                    availabilityid,
                    start_date,
                    end_date,
                    reason,
                    created_at,
                    updated_at
                FROM public.official_availability
                WHERE officialid = $1
                ORDER BY start_date ASC, end_date ASC, availabilityid ASC
            `, [officialId]);

            const today = new Date();
            const monthParam = String(req.query.month || '').trim();
            const monthMatch = /^(\d{4})-(\d{2})$/.exec(monthParam);
            const year = monthMatch ? Number(monthMatch[1]) : today.getUTCFullYear();
            const month = monthMatch ? Number(monthMatch[2]) : today.getUTCMonth() + 1;

            const safeYear = year >= 2000 && year <= 2100 ? year : today.getUTCFullYear();
            const safeMonth = month >= 1 && month <= 12 ? month : today.getUTCMonth() + 1;
            const monthValue = `${safeYear}-${String(safeMonth).padStart(2, '0')}`;

            const calendarDays = buildCalendar(safeYear, safeMonth, availabilityResult.rows);
            const navigation = monthNavigation(safeYear, safeMonth);
            const monthLabel = new Date(Date.UTC(safeYear, safeMonth - 1, 1))
                .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

            const editId = req.query.edit ? Number(req.query.edit) : null;
            let editAvailability = null;

            if (Number.isInteger(editId) && editId > 0) {
                const editResult = await pool.query(`
                    SELECT
                        availabilityid,
                        start_date,
                        end_date,
                        reason
                    FROM public.official_availability
                    WHERE availabilityid = $1
                      AND officialid = $2
                    LIMIT 1
                `, [editId, officialId]);

                editAvailability = editResult.rows[0] || null;
            }

            return renderPage(res, {
                title: 'My Availability | ARAB',
                official: officialResult.rows[0],
                availability: availabilityResult.rows,
                monthValue,
                monthLabel,
                calendarDays,
                ...navigation,
                editAvailability,
                error: null,
                success: null
            });
        } catch (error) {
            console.error('Error loading My Availability:', error);
            return res.status(500).send(
                'Error loading My Availability: ' + error.message
            );
        }
    }
);

// ======================================================
// CREATE AVAILABILITY PERIOD
// ======================================================
router.post(
    '/my-availability',
    requireAuth,
    requireAvailabilityOwner,
    async (req, res) => {
        const startDate = parseDate(req.body.start_date);
        const endDate = parseDate(req.body.end_date);
        const reason = String(req.body.reason || '').trim() || null;

        if (!startDate || !endDate || startDate > endDate) {
            return res.status(400).send(
                'Invalid unavailable date range. Please select a valid start and end date.'
            );
        }

        try {
            await pool.query(`
                INSERT INTO public.official_availability
                    (officialid, start_date, end_date, reason)
                VALUES ($1, $2, $3, $4)
            `, [Number(req.user.officialid), startDate, endDate, reason]);

            return res.redirect('/my-availability');
        } catch (error) {
            console.error('Error creating availability:', error);
            return res.status(500).send(
                'Error saving unavailability: ' + error.message
            );
        }
    }
);

// ======================================================
// UPDATE AVAILABILITY PERIOD
// ======================================================
router.post(
    '/my-availability/:id',
    requireAuth,
    requireAvailabilityOwner,
    async (req, res) => {
        const availabilityId = Number(req.params.id);
        const startDate = parseDate(req.body.start_date);
        const endDate = parseDate(req.body.end_date);
        const reason = String(req.body.reason || '').trim() || null;

        if (!Number.isInteger(availabilityId) || availabilityId <= 0) {
            return res.status(400).send('Invalid availability ID.');
        }

        if (!startDate || !endDate || startDate > endDate) {
            return res.status(400).send(
                'Invalid unavailable date range. Please select a valid start and end date.'
            );
        }

        try {
            const result = await pool.query(`
                UPDATE public.official_availability
                SET
                    start_date = $1,
                    end_date = $2,
                    reason = $3,
                    updated_at = NOW()
                WHERE availabilityid = $4
                  AND officialid = $5
                RETURNING availabilityid
            `, [
                startDate,
                endDate,
                reason,
                availabilityId,
                Number(req.user.officialid)
            ]);

            if (result.rows.length === 0) {
                return res.status(404).send('Unavailable period not found.');
            }

            return res.redirect('/my-availability');
        } catch (error) {
            console.error('Error updating availability:', error);
            return res.status(500).send(
                'Error updating unavailability: ' + error.message
            );
        }
    }
);

// ======================================================
// DELETE AVAILABILITY PERIOD
// ======================================================
router.post(
    '/my-availability/:id/delete',
    requireAuth,
    requireAvailabilityOwner,
    async (req, res) => {
        const availabilityId = Number(req.params.id);

        if (!Number.isInteger(availabilityId) || availabilityId <= 0) {
            return res.status(400).send('Invalid availability ID.');
        }

        try {
            const result = await pool.query(`
                DELETE FROM public.official_availability
                WHERE availabilityid = $1
                  AND officialid = $2
                RETURNING availabilityid
            `, [availabilityId, Number(req.user.officialid)]);

            if (result.rows.length === 0) {
                return res.status(404).send('Unavailable period not found.');
            }

            return res.redirect('/my-availability');
        } catch (error) {
            console.error('Error deleting availability:', error);
            return res.status(500).send(
                'Error deleting unavailability: ' + error.message
            );
        }
    }
);

module.exports = router;
