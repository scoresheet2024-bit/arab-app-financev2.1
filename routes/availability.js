const express = require('express');
const pool = require('../db');

const router = express.Router();

const ALLOWED_ROLES = ['admin', 'referee', 'official', 'to', 'finance'];

function getRole(req) {
    return String(
        req.user?.actualRole || req.user?.role || ''
    ).trim().toLowerCase();
}

function isAdmin(req) {
    return getRole(req) === 'admin';
}

function getOwnOfficialId(req) {
    const officialId = req.user?.officialid;
    return officialId === null || officialId === undefined || officialId === ''
        ? null
        : officialId;
}

function validateDateRange(startDate, endDate) {
    if (!startDate || !endDate) {
        return 'Start date and end date are required.';
    }

    if (String(startDate) > String(endDate)) {
        return 'End date cannot be before start date.';
    }

    return null;
}

// ======================================================
// MY AVAILABILITY / ADMIN AVAILABILITY
// ======================================================
router.get('/my-availability', async (req, res) => {
    try {
        const role = getRole(req);

        if (!ALLOWED_ROLES.includes(role)) {
            return res.status(403).send('Access denied.');
        }

        if (role !== 'admin' && !getOwnOfficialId(req)) {
            return res.status(403).send(
                'Your account is not linked to an official record. Please contact an administrator.'
            );
        }

        let selectedOfficialId = null;
        let officials = [];
        let official = null;
        let availability = [];

        if (role === 'admin') {
            const officialsResult = await pool.query(`
                SELECT
                    o.officialid,
                    o.fullname,
                    o.role,
                    active.start_date AS active_start_date,
                    active.end_date AS active_end_date,
                    CASE
                        WHEN active.availabilityid IS NOT NULL
                        THEN 'Not Available'
                        ELSE 'Available'
                    END AS current_status
                FROM public.officials o
                LEFT JOIN LATERAL (
                    SELECT
                        a.availabilityid,
                        a.start_date,
                        a.end_date
                    FROM public.official_availability a
                    WHERE a.officialid = o.officialid
                      AND CURRENT_DATE BETWEEN a.start_date AND a.end_date
                    ORDER BY a.start_date ASC, a.availabilityid ASC
                    LIMIT 1
                ) active ON TRUE
                ORDER BY
                    CASE WHEN active.availabilityid IS NOT NULL THEN 0 ELSE 1 END,
                    o.fullname ASC
            `);

            officials = officialsResult.rows;

            selectedOfficialId = req.query.officialid
                ? String(req.query.officialid)
                : (officials[0]?.officialid ? String(officials[0].officialid) : null);

            if (selectedOfficialId) {
                const officialResult = await pool.query(`
                    SELECT officialid, fullname, role, phone, email
                    FROM public.officials
                    WHERE officialid = $1
                `, [selectedOfficialId]);

                official = officialResult.rows[0] || null;

                if (official) {
                    const availabilityResult = await pool.query(`
                        SELECT
                            availabilityid,
                            officialid,
                            start_date,
                            end_date,
                            reason,
                            created_at,
                            updated_at
                        FROM public.official_availability
                        WHERE officialid = $1
                        ORDER BY
                            CASE WHEN end_date >= CURRENT_DATE THEN 0 ELSE 1 END,
                            start_date ASC,
                            availabilityid ASC
                    `, [selectedOfficialId]);

                    availability = availabilityResult.rows;
                }
            }
        } else {
            selectedOfficialId = String(getOwnOfficialId(req));

            const officialResult = await pool.query(`
                SELECT officialid, fullname, role, phone, email
                FROM public.officials
                WHERE officialid = $1
            `, [selectedOfficialId]);

            official = officialResult.rows[0] || null;

            if (!official) {
                return res.status(404).send(
                    'Your linked official record was not found.'
                );
            }

            const availabilityResult = await pool.query(`
                SELECT
                    availabilityid,
                    officialid,
                    start_date,
                    end_date,
                    reason,
                    created_at,
                    updated_at
                FROM public.official_availability
                WHERE officialid = $1
                ORDER BY
                    CASE WHEN end_date >= CURRENT_DATE THEN 0 ELSE 1 END,
                    start_date ASC,
                    availabilityid ASC
            `, [selectedOfficialId]);

            availability = availabilityResult.rows;
        }

        const activeRecord = availability.find(record => {
            const start = String(record.start_date).slice(0, 10);
            const end = String(record.end_date).slice(0, 10);
            const today = new Date().toISOString().slice(0, 10);
            return start <= today && today <= end;
        });

        const todayResult = await pool.query(`SELECT CURRENT_DATE::text AS today`);
        const today = todayResult.rows[0].today;

        res.render('availability/index', {
            title: role === 'admin'
                ? 'Official Availability'
                : 'My Availability',
            currentUser: req.user,
            role,
            isAdmin: role === 'admin',
            officials,
            official,
            availability,
            selectedOfficialId,
            currentStatus: activeRecord ? 'Not Available' : 'Available',
            activeRecord,
            today,
            error: null,
            success: req.query.success || null
        });
    } catch (error) {
        console.error('Availability page error:', error);
        res.status(500).send(
            'Error loading Availability: ' + error.message
        );
    }
});

// ======================================================
// ADD UNAVAILABILITY
// ======================================================
router.post('/my-availability', async (req, res) => {
    try {
        const role = getRole(req);

        if (!ALLOWED_ROLES.includes(role)) {
            return res.status(403).send('Access denied.');
        }

        let officialId;

        if (role === 'admin') {
            officialId = req.body.officialid;
        } else {
            officialId = getOwnOfficialId(req);
        }

        if (!officialId) {
            return res.status(403).send(
                'No official record is linked to this account.'
            );
        }

        const { start_date, end_date, reason } = req.body;

        const validationError = validateDateRange(start_date, end_date);
        if (validationError) {
            return res.status(400).send(validationError);
        }

        // Non-admin users cannot create an unavailability period that starts in the past.
        if (role !== 'admin') {
            const todayResult = await pool.query(`SELECT CURRENT_DATE::text AS today`);
            const today = todayResult.rows[0].today;

            if (String(start_date) < String(today)) {
                return res.status(400).send(
                    'You cannot set an unavailability period starting in the past. Please select today or a future date.'
                );
            }
        }

        // Prevent overlapping periods for the same official.
        const overlap = await pool.query(`
            SELECT availabilityid
            FROM public.official_availability
            WHERE officialid = $1
              AND start_date <= $3::date
              AND end_date >= $2::date
            LIMIT 1
        `, [officialId, start_date, end_date]);

        if (overlap.rows.length > 0) {
            const redirectId = role === 'admin'
                ? `?officialid=${encodeURIComponent(officialId)}&`
                : '?';

            return res.redirect(
                `/my-availability${redirectId}success=${encodeURIComponent(
                    'The selected period overlaps an existing unavailable period.'
                )}`
            );
        }

        await pool.query(`
            INSERT INTO public.official_availability
                (officialid, start_date, end_date, reason)
            VALUES ($1, $2::date, $3::date, $4)
        `, [
            officialId,
            start_date,
            end_date,
            reason ? String(reason).trim() : null
        ]);

        const redirectId = role === 'admin'
            ? `?officialid=${encodeURIComponent(officialId)}&`
            : '?';

        return res.redirect(
            `/my-availability${redirectId}success=${encodeURIComponent(
                'Unavailability period added successfully.'
            )}`
        );
    } catch (error) {
        console.error('Add availability error:', error);
        res.status(500).send(
            'Error saving Availability: ' + error.message
        );
    }
});

// ======================================================
// EDIT UNAVAILABILITY
// ======================================================
router.post('/my-availability/edit/:id', async (req, res) => {
    try {
        const role = getRole(req);

        if (!ALLOWED_ROLES.includes(role)) {
            return res.status(403).send('Access denied.');
        }

        const availabilityId = req.params.id;
        const { start_date, end_date, reason } = req.body;

        const validationError = validateDateRange(start_date, end_date);
        if (validationError) {
            return res.status(400).send(validationError);
        }

        // Non-admin users cannot edit an unavailability period so that it starts in the past.
        if (role !== 'admin') {
            const todayResult = await pool.query(`SELECT CURRENT_DATE::text AS today`);
            const today = todayResult.rows[0].today;

            if (String(start_date) < String(today)) {
                return res.status(400).send(
                    'You cannot set an unavailability period starting in the past. Please select today or a future date.'
                );
            }
        }

        let ownershipSql = '';
        const params = [
            start_date,
            end_date,
            reason ? String(reason).trim() : null,
            availabilityId
        ];

        if (role !== 'admin') {
            const ownOfficialId = getOwnOfficialId(req);

            if (!ownOfficialId) {
                return res.status(403).send(
                    'No official record is linked to this account.'
                );
            }

            ownershipSql = 'AND officialid = $5';
            params.push(ownOfficialId);
        }

        const updateResult = await pool.query(`
            UPDATE public.official_availability
            SET
                start_date = $1::date,
                end_date = $2::date,
                reason = $3,
                updated_at = NOW()
            WHERE availabilityid = $4
            ${ownershipSql}
            RETURNING officialid
        `, params);

        if (updateResult.rows.length === 0) {
            return res.status(404).send(
                'Availability record not found or you do not have permission to edit it.'
            );
        }

        const officialId = updateResult.rows[0].officialid;

        return res.redirect(
            `/my-availability?${role === 'admin'
                ? `officialid=${encodeURIComponent(officialId)}&`
                : ''}success=${encodeURIComponent(
                    'Unavailability period updated successfully.'
                )}`
        );
    } catch (error) {
        console.error('Edit availability error:', error);
        res.status(500).send(
            'Error updating Availability: ' + error.message
        );
    }
});

// ======================================================
// DELETE UNAVAILABILITY
// ======================================================
router.post('/my-availability/delete/:id', async (req, res) => {
    try {
        const role = getRole(req);

        if (!ALLOWED_ROLES.includes(role)) {
            return res.status(403).send('Access denied.');
        }

        const availabilityId = req.params.id;

        let ownershipSql = '';
        const params = [availabilityId];

        if (role !== 'admin') {
            const ownOfficialId = getOwnOfficialId(req);

            if (!ownOfficialId) {
                return res.status(403).send(
                    'No official record is linked to this account.'
                );
            }

            ownershipSql = 'AND officialid = $2';
            params.push(ownOfficialId);
        }

        const deleteResult = await pool.query(`
            DELETE FROM public.official_availability
            WHERE availabilityid = $1
            ${ownershipSql}
            RETURNING officialid
        `, params);

        if (deleteResult.rows.length === 0) {
            return res.status(404).send(
                'Availability record not found or you do not have permission to delete it.'
            );
        }

        const officialId = deleteResult.rows[0].officialid;

        return res.redirect(
            `/my-availability?${role === 'admin'
                ? `officialid=${encodeURIComponent(officialId)}&`
                : ''}success=${encodeURIComponent(
                    'Unavailability period deleted successfully.'
                )}`
        );
    } catch (error) {
        console.error('Delete availability error:', error);
        res.status(500).send(
            'Error deleting Availability: ' + error.message
        );
    }
});

module.exports = router;
