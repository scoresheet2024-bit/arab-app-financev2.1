const express = require('express');
const pool = require('../db');

const router = express.Router();

// ======================================================
// LIST ALL COMPETITIONS
// ======================================================

router.get('/competitions', async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                competitionid,
                competitionname,
                season
            FROM public.competitions
            ORDER BY competitionid DESC
        `);

router.get('/competitions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT competitionid,
                   competitionname,
                   season
            FROM public.competitions
            ORDER BY competitionid DESC
        `);

        res.render('competitions/list', {
            competitions: result.rows
        });

    } catch (error) {
        console.error(error);
        res.status(500).send(
            'Error loading competitions: ' + error.message
        );
    }
});

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error loading competitions: ' + error.message
        );

    }

});


// ======================================================
// ADD NEW COMPETITION - FORM
// ======================================================

router.get('/competitions/new', (req, res) => {

    res.send(`

        <!DOCTYPE html>

        <html>

        <head>

            <title>Add New Competition</title>

            <style>

                body {
                    font-family: Arial, sans-serif;
                    margin: 40px;
                    background: #f8f9fa;
                }

                form {
                    width: 600px;
                    background: white;
                    padding: 30px;
                    border-radius: 8px;
                }

                label {
                    display: block;
                    margin-top: 15px;
                    margin-bottom: 7px;
                    font-weight: bold;
                }

                input {
                    width: 100%;
                    padding: 12px;
                    box-sizing: border-box;
                    font-size: 16px;
                    border: 1px solid #ccc;
                    border-radius: 5px;
                }

                button {
                    margin-top: 25px;
                    padding: 12px 20px;
                    background-color: #198754;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: bold;
                }

                button:hover {
                    background-color: #146c43;
                }

                .cancel {
                    margin-left: 15px;
                }

            </style>

        </head>


        <body>

            <h1>Add New Competition</h1>


            <form
                action="/competitions"
                method="POST"
            >

                <label>
                    Competition Name
                </label>

                <input
                    type="text"
                    name="competitionname"
                    placeholder="Enter competition name"
                    required
                >


                <label>
                    Season
                </label>

                <input
                    type="text"
                    name="season"
                    placeholder="Example: 2026 or 2026/2027"
                    required
                >


                <button type="submit">
                    Save Competition
                </button>


                <a
                    class="cancel"
                    href="/competitions"
                >
                    Cancel
                </a>

            </form>

        </body>

        </html>

    `);

});

// ======================================================
// SAVE NEW COMPETITION
// ======================================================

router.post('/competitions', async (req, res) => {

    try {

        const {
            competitionname,
            season
        } = req.body;


        await pool.query(

            `INSERT INTO public.competitions
             (
                competitionname,
                season
             )
             VALUES
             ($1, $2)`,

            [
                competitionname,
                season
            ]

        );


        // After saving, go back to Competition List
        res.redirect('/competitions');


    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error adding competition: ' +
            error.message
        );

    }

});

// ======================================================
// ASSIGN GAME - FORM WITH REVIEW BEFORE SAVING
// ======================================================

module.exports = router;
