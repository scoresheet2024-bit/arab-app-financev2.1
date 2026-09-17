const express = require('express');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();


// ======================================================
// OFFICIALS LIST
// Admin + TO
// ======================================================

router.get(
    '/officials',
    requireRole('admin', 'to'),
    async (req, res) => {

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
    }
);


// ======================================================
// ADD NEW OFFICIAL - FORM
// Admin + TO
// ======================================================

router.get(
    '/officials/new',
    requireRole('admin', 'to'),
    (req, res) => {

        res.render('officials/new', {
            title: 'Add New Official'
        });

    }
);


// ======================================================
// SAVE NEW OFFICIAL
// Admin + TO
// ======================================================

router.post(
    '/officials',
    requireRole('admin', 'to'),
    async (req, res) => {

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
    }
);


// ======================================================
// EDIT OFFICIAL - FORM
// Admin + TO
// ======================================================

router.get(
    '/officials/edit/:id',
    requireRole('admin', 'to'),
    async (req, res) => {

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
    }
);


// ======================================================
// UPDATE OFFICIAL
// Admin + TO
// ======================================================

router.post(
    '/officials/edit/:id',
    requireRole('admin', 'to'),
    async (req, res) => {

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
    }
);


// ======================================================
// DELETE OFFICIAL
// Admin + TO
// ======================================================

router.post(
    '/officials/delete/:id',
    requireRole('admin', 'to'),
    async (req, res) => {

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
    }
);


// ======================================================
// OFFICIAL SEARCH API
// ------------------------------------------------------
// This remains available to authenticated users because
// Games > Assign uses it for official autocomplete.
// ======================================================

router.get(
    '/api/officials/search',
    async (req, res) => {

        try {

            const search =
                req.query.q || '';


            const result = await pool.query(
                `SELECT
                    officialid,
                    fullname,
                    role,
                    phone,
                    email

                 FROM public.officials

                 WHERE fullname ILIKE $1

                 ORDER BY fullname

                 LIMIT 10`,
                [
                    `%${search}%`
                ]
            );


            res.json(result.rows);

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: 'Error searching officials'
            });
        }
    }
);


module.exports = router;