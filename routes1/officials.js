const express = require('express');
const pool = require('../db');

const router = express.Router();


// ======================================================
// OFFICIALS LIST
// ======================================================

router.get('/officials', async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                officialid,
                fullname,
                role,
                phone,
                email
            FROM public.officials
            ORDER BY officialid
        `);

        res.render('officials/index', {
            title: 'Officials',
            officials: result.rows
        });
	console.log(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error loading officials: ' +
            error.message
        );

    }

});


// ======================================================
// ADD NEW OFFICIAL - FORM
// ======================================================

router.get('/officials/new', (req, res) => {

    res.render('officials/new', {
        title: 'Add New Official'
    });

});


// ======================================================
// SAVE NEW OFFICIAL
// ======================================================

router.post('/officials', async (req, res) => {

    try {

        const {
            fullname,
            role,
            phone,
            email
        } = req.body;


        await pool.query(

            `INSERT INTO public.officials
            (
                fullname,
                role,
                phone,
                email
            )
            VALUES
            ($1, $2, $3, $4)`,

            [
                fullname,
                role,
                phone || null,
                email || null
            ]

        );


        res.redirect('/officials');

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error adding official: ' +
            error.message
        );

    }

});


// ======================================================
// EDIT OFFICIAL - FORM
// ======================================================

router.get('/officials/edit/:id', async (req, res) => {

    try {

        const id = req.params.id;


        const result = await pool.query(

            `SELECT
                officialid,
                fullname,
                role,
                phone,
                email

             FROM public.officials

             WHERE officialid = $1`,

            [id]

        );


        if (result.rows.length === 0) {

            return res.status(404).send(
                'Official not found'
            );

        }


        res.render('officials/edit', {
            title: 'Edit Official',
            official: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error loading official: ' +
            error.message
        );

    }

});


// ======================================================
// UPDATE OFFICIAL
// ======================================================

router.post('/officials/edit/:id', async (req, res) => {

    try {

        const id = req.params.id;

        const {
            fullname,
            role,
            phone,
            email
        } = req.body;


        await pool.query(

            `UPDATE public.officials

             SET
                fullname = $1,
                role = $2,
                phone = $3,
                email = $4

             WHERE officialid = $5`,

            [
                fullname,
                role,
                phone || null,
                email || null,
                id
            ]

        );


        res.redirect('/officials');

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error updating official: ' +
            error.message
        );

    }

});


// ======================================================
// DELETE OFFICIAL
// ======================================================

router.post('/officials/delete/:id', async (req, res) => {

    try {

        const id = req.params.id;


        await pool.query(

            `DELETE FROM public.officials
             WHERE officialid = $1`,

            [id]

        );


        res.redirect('/officials');

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error deleting official: ' +
            error.message
        );

    }

});


// ======================================================
// OFFICIAL SEARCH API
// ======================================================

router.get('/api/officials/search', async (req, res) => {

    try {

        const search =
            req.query.q || '';

        const gamedate = String(req.query.gamedate || '').trim();

        const result = await pool.query(

            `SELECT
                o.officialid,
                o.fullname,
                o.role,
                o.phone,
                o.email,
                CASE
                    WHEN NULLIF($2, '')::date IS NOT NULL
                     AND EXISTS (
                        SELECT 1
                        FROM public.official_availability oa
                        WHERE oa.officialid = o.officialid
                          AND NULLIF($2, '')::date BETWEEN oa.start_date AND oa.end_date
                     )
                    THEN TRUE
                    ELSE FALSE
                END AS availability_conflict,
                (
                    SELECT oa.reason
                    FROM public.official_availability oa
                    WHERE oa.officialid = o.officialid
                      AND NULLIF($2, '')::date BETWEEN oa.start_date AND oa.end_date
                    ORDER BY oa.start_date ASC, oa.availabilityid ASC
                    LIMIT 1
                ) AS availability_reason

             FROM public.officials o

             WHERE o.fullname ILIKE $1

             ORDER BY o.fullname

             LIMIT 10`,

            [
                `%${search}%`,
                gamedate
            ]

        );


        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: 'Error searching officials'
        });

    }

});


module.exports = router;