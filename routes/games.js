const express = require('express');
const pool = require('../db');
const { upload, uploadDir } = require('../middleware/upload');
const { requireRole } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// ======================================================
// GAMES - SHOW PENDING / UNASSIGNED GAMES
// ======================================================

router.get('/games', async (req, res) => {

    try {

        const result = await pool.query(`

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

                g.report_submitted

            FROM public.games g

            LEFT JOIN public.competitions c

                ON g.competitionid =
                   c.competitionid

            WHERE
                g.assigned = FALSE

            ORDER BY
                g.gamedate ASC,
                g.gametime ASC

        `);


        res.render(
            'games/index',
            {
                games: result.rows
            }
        );


    } catch (error) {

        console.error(
            'Error loading games:',
            error
        );

        res.status(500).send(
            'Error loading games: ' +
            error.message
        );

    }

});

// ======================================================
// CREATE GAME - FORM
// ======================================================

router.get(
    '/games/new',
    requireRole('admin', 'to'),
    async (req, res) => {

    try {

        const result = await pool.query(`

            SELECT

                competitionid,

                competitionname,

                season

            FROM public.competitions

            ORDER BY

                competitionname ASC,

                season DESC

        `);

        res.render(

            'games/new',

            {

                competitions: result.rows

            }

        );

    } catch (error) {

        console.error(error);

        res.status(500).send(

            'Error loading create game form: ' +

            error.message

        );

    }

});

// ======================================================
// SAVE NEW GAME
// ======================================================

router.post(
    '/games',
    requireRole('admin', 'to'),
    async (req, res) => {

    try {

        console.log('CREATE GAME - FORM DATA:');
        console.log(req.body);


        const {
            competitionid,
            teama,
            teamb,
            gamedate,
            gametime,
            court
        } = req.body;


        // ==================================================
        // VALIDATE REQUIRED FIELDS
        // ==================================================

        if (!competitionid) {

            return res.status(400).send(
                'Error creating game: Competition is required.'
            );

        }


        if (!teama || !teama.trim()) {

            return res.status(400).send(
                'Error creating game: Team A is required.'
            );

        }


        if (!teamb || !teamb.trim()) {

            return res.status(400).send(
                'Error creating game: Team B is required.'
            );

        }


        if (!gamedate) {

            return res.status(400).send(
                'Error creating game: Game Date is required.'
            );

        }


        // ==================================================
        // INSERT GAME
        // ==================================================

        await pool.query(

            `INSERT INTO public.games
            (
                competitionid,
                teama,
                teamb,
                gamedate,
                gametime,
                court,
                assigned
            )

            VALUES
            ($1, $2, $3, $4, $5, $6, FALSE)`,

            [
                competitionid,
                teama.trim(),
                teamb.trim(),
                gamedate,
                gametime || null,
                court || null
            ]

        );


        // ==================================================
        // SUCCESS
        // ==================================================

        res.redirect('/games');


    } catch (error) {

        console.error(
            'Error creating game:',
            error
        );


        res.status(500).send(

            'Error creating game: ' +
            error.message

        );

    }

});

// ======================================================
// ASSIGN GAME - SHOW FORM
// ======================================================

router.get(
    '/games/assign/:id',
    requireRole('admin', 'to'),
    async (req, res) => {

    try {

        const id = req.params.id;
        const result = await pool.query(`

            SELECT

                g.*,

                c.competitionname AS competition,

                c.season,

                o1.fullname AS referee1,
                o2.fullname AS umpire1,
                o3.fullname AS umpire2,
                o4.fullname AS scorer,
                o5.fullname AS timer,
                o6.fullname AS shot_clock_operator,
                o7.fullname AS assistant_scorer,
                o8.fullname AS commissioner

            FROM public.games g

            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid

            LEFT JOIN public.officials o1 ON g.official1_id = o1.officialid
            LEFT JOIN public.officials o2 ON g.official2_id = o2.officialid
            LEFT JOIN public.officials o3 ON g.official3_id = o3.officialid
            LEFT JOIN public.officials o4 ON g.scorer_id = o4.officialid
            LEFT JOIN public.officials o5 ON g.timer_id = o5.officialid
            LEFT JOIN public.officials o6 ON g.shot_clock_operator_id = o6.officialid
            LEFT JOIN public.officials o7 ON g.assistant_scorer_id = o7.officialid
            LEFT JOIN public.officials o8 ON g.commissioner_id = o8.officialid

            WHERE
                g.gameid = $1

        `, [id]);

        // ==============================================
        // GAME NOT FOUND
        // ==============================================

        if (result.rows.length === 0) {

            return res.status(404).send(
                'Game not found'
            );

        }


        const game =
            result.rows[0];

	// ==================================================
        // GET ALL OFFICIALS
        // ==================================================

        const officialsResult = await pool.query(`

            SELECT

                officialid,

                fullname

            FROM public.officials

            ORDER BY fullname ASC

        `);


        // ==============================================
        // RENDER EJS PAGE
        // ==============================================

        res.render(
            'games/assign',
            {
                game: game
            }
        );


    } catch (error) {

        console.error(
            'Error loading assignment page:',
            error
        );


        res.status(500).send(
            'Error loading assignment page: ' +
            error.message
        );

    }

});

// ======================================================
// SAVE GAME ASSIGNMENT
// ======================================================

router.post(
    '/games/assign/:id',
    requireRole('admin', 'to'),
    async (req, res) => {

    const client = await pool.connect();

    try {

        const gameid = req.params.id;

        const {
            referee_id,
            umpire1_id,
            umpire2_id,
            scorer_id,
            timer_id,
            shot_clock_operator_id,
            assistant_scorer_id,
            commissioner_id
        } = req.body;


        // ==================================================
        // CONVERT EMPTY VALUES TO NULL
        // ==================================================

        const refereeId =
            referee_id
                ? Number(referee_id)
                : null;

        const umpire1Id =
            umpire1_id
                ? Number(umpire1_id)
                : null;

        const umpire2Id =
            umpire2_id
                ? Number(umpire2_id)
                : null;

        const scorerId =
            scorer_id
                ? Number(scorer_id)
                : null;

        const timerId =
            timer_id
                ? Number(timer_id)
                : null;

        const shotClockOperatorId =
            shot_clock_operator_id
                ? Number(shot_clock_operator_id)
                : null;

        const assistantScorerId =
            assistant_scorer_id
                ? Number(assistant_scorer_id)
                : null;

        const commissionerId =
            commissioner_id
                ? Number(commissioner_id)
                : null;


        // ==================================================
        // CHECK GAME ID
        // ==================================================

        if (!gameid || isNaN(Number(gameid))) {

            return res.status(400).send(
                'Invalid game ID.'
            );

        }


        // ==================================================
        // START TRANSACTION
        // ==================================================

        await client.query('BEGIN');


        // ==================================================
        // CHECK THAT GAME EXISTS
        // ==================================================

        const gameResult = await client.query(

            `SELECT gameid
             FROM public.games
             WHERE gameid = $1`,

            [gameid]

        );


        if (gameResult.rows.length === 0) {

            await client.query('ROLLBACK');

            return res.status(404).send(
                'Game not found.'
            );

        }


        // ==================================================
        // REMOVE OLD ASSIGNMENTS FOR THIS GAME
        // ==================================================
        //
        // This is important if an already assigned game
        // is being reassigned.
        //
        // It prevents duplicate records in assignments.
        //
        // ==================================================

        await client.query(

            `DELETE FROM public.assignments
             WHERE gameid = $1`,

            [gameid]

        );


        // ==================================================
        // SAVE REFEREE
        // ==================================================

        if (refereeId !== null) {

            await client.query(

                `INSERT INTO public.assignments
                (
                    gameid,
                    officialid,
                    role
                )
                VALUES
                ($1, $2, $3)`,

                [
                    gameid,
                    refereeId,
                    'Referee'
                ]

            );

        }


        // ==================================================
        // SAVE UMPIRE 1
        // ==================================================

        if (umpire1Id !== null) {

            await client.query(

                `INSERT INTO public.assignments
                (
                    gameid,
                    officialid,
                    role
                )
                VALUES
                ($1, $2, $3)`,

                [
                    gameid,
                    umpire1Id,
                    'Umpire 1'
                ]

            );

        }


        // ==================================================
        // SAVE UMPIRE 2
        // ==================================================

        if (umpire2Id !== null) {

            await client.query(

                `INSERT INTO public.assignments
                (
                    gameid,
                    officialid,
                    role
                )
                VALUES
                ($1, $2, $3)`,

                [
                    gameid,
                    umpire2Id,
                    'Umpire 2'
                ]

            );

        }


        // ==================================================
        // SAVE SCORER
        // ==================================================

        if (scorerId !== null) {

            await client.query(

                `INSERT INTO public.assignments
                (
                    gameid,
                    officialid,
                    role
                )
                VALUES
                ($1, $2, $3)`,

                [
                    gameid,
                    scorerId,
                    'Scorer'
                ]

            );

        }


        // ==================================================
        // SAVE TIMER
        // ==================================================

        if (timerId !== null) {

            await client.query(

                `INSERT INTO public.assignments
                (
                    gameid,
                    officialid,
                    role
                )
                VALUES
                ($1, $2, $3)`,

                [
                    gameid,
                    timerId,
                    'Timer'
                ]

            );

        }


        // ==================================================
        // SAVE SHOT CLOCK OPERATOR
        // ==================================================

        if (shotClockOperatorId !== null) {

            await client.query(

                `INSERT INTO public.assignments
                (
                    gameid,
                    officialid,
                    role
                )
                VALUES
                ($1, $2, $3)`,

                [
                    gameid,
                    shotClockOperatorId,
                    'Shot Clock Operator'
                ]

            );

        }


        // ==================================================
        // SAVE ASSISTANT SCORER
        // ==================================================

        if (assistantScorerId !== null) {

            await client.query(

                `INSERT INTO public.assignments
                (
                    gameid,
                    officialid,
                    role
                )
                VALUES
                ($1, $2, $3)`,

                [
                    gameid,
                    assistantScorerId,
                    'Assistant Scorer'
                ]

            );

        }


        // ==================================================
        // SAVE COMMISSIONER
        // ==================================================

        if (commissionerId !== null) {

            await client.query(

                `INSERT INTO public.assignments
                (
                    gameid,
                    officialid,
                    role
                )
                VALUES
                ($1, $2, $3)`,

                [
                    gameid,
                    commissionerId,
                    'Commissioner'
                ]

            );

        }


        // ==================================================
        // UPDATE GAMES TABLE
        // ==================================================
        //
        // THIS IS THE IMPORTANT PART.
        //
        // Statistics reads these columns.
        //
        // ==================================================

        await client.query(

            `UPDATE public.games

             SET

                official1_id = $1,

                official2_id = $2,

                official3_id = $3,

                scorer_id = $4,

                timer_id = $5,

                shot_clock_operator_id = $6,

                assistant_scorer_id = $7,

                commissioner_id = $8,

                assigned = TRUE,

                report_submitted = FALSE,

                approval_status = 'pending',

                last_modified_by = $9

             WHERE gameid = $10`,

            [

                refereeId,

                umpire1Id,

                umpire2Id,

                scorerId,

                timerId,

                shotClockOperatorId,

                assistantScorerId,

                commissionerId,

                req.user.userid,

                gameid

            ]

        );


        // ==================================================
        // COMMIT TRANSACTION
        // ==================================================

        await client.query('COMMIT');


        // ==================================================
        // ASSIGNMENT IS COMPLETE.
        // The game now moves to Assigned Games until the
        // final report is submitted.
        // ==================================================

        res.redirect('/games');


    } catch (error) {

        // ==================================================
        // ROLLBACK IF ANYTHING FAILS
        // ==================================================

        try {

            await client.query('ROLLBACK');

        } catch (rollbackError) {

            console.error(
                'Rollback error:',
                rollbackError
            );

        }


        console.error(
            'Error assigning game:',
            error
        );


        res.status(500).send(

            'Error assigning game: ' +
            error.message

        );


        } finally {

        // ==================================================
        // RELEASE CONNECTION
        // ==================================================

        client.release();

    }

});

// ======================================================
// PENDING APPROVAL - LIST
// ======================================================

router.get(
    '/games/pending',
    requireRole('admin', 'to'),
    async (req, res) => {

    try {

        const result = await pool.query(`

            SELECT
                g.gameid, g.teama, g.teamb, g.gamedate, g.gametime, g.court,
                c.competitionname AS competition, c.season,
                g.last_modified_by,
                o1.fullname AS referee1,
                o2.fullname AS umpire1,
                o3.fullname AS umpire2,
                o4.fullname AS scorer,
                o5.fullname AS timer,
                o6.fullname AS shot_clock_operator,
                o7.fullname AS assistant_scorer,
                o8.fullname AS commissioner

            FROM public.games g
            LEFT JOIN public.competitions c ON g.competitionid = c.competitionid
            LEFT JOIN public.officials o1 ON g.official1_id = o1.officialid
            LEFT JOIN public.officials o2 ON g.official2_id = o2.officialid
            LEFT JOIN public.officials o3 ON g.official3_id = o3.officialid
            LEFT JOIN public.officials o4 ON g.scorer_id = o4.officialid
            LEFT JOIN public.officials o5 ON g.timer_id = o5.officialid
            LEFT JOIN public.officials o6 ON g.shot_clock_operator_id = o6.officialid
            LEFT JOIN public.officials o7 ON g.assistant_scorer_id = o7.officialid
            LEFT JOIN public.officials o8 ON g.commissioner_id = o8.officialid

            WHERE g.approval_status = 'pending'
  		AND g.assigned = TRUE
  		AND COALESCE(g.report_submitted, FALSE) = FALSE

            ORDER BY g.gamedate ASC, g.gametime ASC

        `);

        res.render('games/pending', { games: result.rows, currentUser: req.user });

    } catch (error) {

        console.error('Error loading pending approvals:', error);

        res.status(500).send('Error loading pending approvals: ' + error.message);

    }

});

// ======================================================
// APPROVE / PUBLISH A PENDING ASSIGNMENT
// ======================================================

router.post(
    '/games/:id/approve',
    requireRole('admin', 'to'),
    async (req, res) => {

    try {

        const gameid = req.params.id;

        const check = await pool.query(
            `SELECT last_modified_by FROM public.games WHERE gameid = $1`,
            [gameid]
        );

        if (check.rows.length === 0) {
            return res.status(404).send('Game not found.');
        }

        if (check.rows[0].last_modified_by === req.user.userid) {
            return res.status(403).send('You cannot approve a change you made yourself.');
        }

        await pool.query(
            `UPDATE public.games SET approval_status = 'approved' WHERE gameid = $1`,
            [gameid]
        );

        res.redirect('/games/pending');

    } catch (error) {

        console.error('Error approving game:', error);

        res.status(500).send('Error approving game: ' + error.message);

    }

});

// ======================================================
// UPLOAD GAME DOCUMENT - FORM
// ======================================================

router.get('/games/:id/documents/new', async (req, res) => {

    try {

        const gameid = req.params.id;

        const result = await pool.query(`

            SELECT
                g.gameid,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                c.competitionname AS competition

            FROM public.games g

            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid

            WHERE g.gameid = $1

        `, [gameid]);


        if (result.rows.length === 0) {

            return res.status(404).send(
                'Game not found'
            );

        }


        const game = result.rows[0];


        res.send(`

            <!DOCTYPE html>

            <html>

            <head>

                <title>Upload Game Document</title>

                <style>

                    body {
                        font-family: Arial, sans-serif;
                        margin: 40px;
                    }

                    .game-info {
                        background: #f5f5f5;
                        padding: 20px;
                        max-width: 600px;
                        margin-bottom: 25px;
                        border-radius: 5px;
                    }

                    form {
                        width: 500px;
                    }

                    label {
                        display: block;
                        font-weight: bold;
                        margin-top: 15px;
                        margin-bottom: 6px;
                    }

                    input,
                    select {
                        width: 100%;
                        padding: 12px;
                        box-sizing: border-box;
                        font-size: 16px;
                    }

                    button {
                        margin-top: 20px;
                        padding: 12px 20px;
                        background-color: #198754;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 16px;
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

                <h1>Upload Game Document</h1>


                <div class="game-info">

                    <h2>
                        ${game.teama}
                        vs
                        ${game.teamb}
                    </h2>

                    <p>
                        <strong>Competition:</strong>
                        ${game.competition || '-'}
                    </p>

                    <p>
                        <strong>Date:</strong>
                        ${game.gamedate || '-'}
                    </p>

                    <p>
                        <strong>Time:</strong>
                        ${game.gametime || '-'}
                    </p>

                </div>


                <form
                    action="/games/${game.gameid}/documents"
                    method="POST"
                    enctype="multipart/form-data"
                >

                    <label>
                        Document Type
                    </label>

                    <select
                        name="documenttype"
                        required
                    >

                        <option value="">
                            Select document type
                        </option>

                        <option value="Scoresheet">
                            Scoresheet
                        </option>

                        <option value="Game Report">
                            Game Report
                        </option>

                        <option value="Official Report">
                            Official Report
                        </option>

                        <option value="Other">
                            Other
                        </option>

                    </select>


                    <label>
                        Select File
                    </label>

                    <input
                        type="file"
                        name="document"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                        required
                    >


                    <p>
                        Maximum file size: 10 MB
                    </p>


                    <button type="submit">
                        Upload Document
                    </button>


                    <a
                        class="cancel"
                        href="/statistics"
                    >
                        Cancel
                    </a>

                </form>

            </body>

            </html>

        `);

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error loading upload page: ' +
            error.message
        );

    }

});


// ======================================================
// SAVE GAME DOCUMENT
// ======================================================

router.post(
    '/games/:id/documents',
    upload.single('document'),
    async (req, res) => {

        try {

            const gameid = req.params.id;

            const documenttype =
                req.body.documenttype;


            if (!req.file) {

                return res.status(400).send(
                    'Please select a file to upload.'
                );

            }


            await pool.query(

                `INSERT INTO game_documents
                (
                    gameid,
                    filename,
                    filepath,
                    documenttype
                )

                VALUES
                ($1, $2, $3, $4)`,

                [
                    gameid,
                    req.file.originalname,
                    req.file.filename,
                    documenttype
                ]

            );


            res.redirect(
                `/games/${gameid}/documents`
            );


        } catch (error) {

            console.error(error);


            // Delete uploaded file if database insertion fails
            if (req.file) {

                const uploadedFile =
                    path.join(
                        uploadDir,
                        req.file.filename
                    );

                if (fs.existsSync(uploadedFile)) {

                    fs.unlinkSync(uploadedFile);

                }

            }


            res.status(500).send(
                'Error uploading document: ' +
                error.message
            );

        }

    }
);

// ======================================================
// SHOW GAME DOCUMENTS
// ======================================================

router.get('/games/:id/documents', async (req, res) => {

    try {

        const gameid = req.params.id;


        const gameResult = await pool.query(`

            SELECT
                g.gameid,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                c.competitionname AS competition

            FROM public.games g

            LEFT JOIN public.competitions c
                ON g.competitionid = c.competitionid

            WHERE g.gameid = $1

        `, [gameid]);


        if (gameResult.rows.length === 0) {

            return res.status(404).send(
                'Game not found'
            );

        }


        const game = gameResult.rows[0];


        const documents = await pool.query(`

            SELECT
                documentid,
                filename,
                filepath,
                documenttype,
                uploaded_at

            FROM game_documents

            WHERE gameid = $1

            ORDER BY uploaded_at DESC

        `, [gameid]);


        res.send(`

            <!DOCTYPE html>

            <html>

            <head>

                <title>Game Documents</title>

                <style>

                    body {
                        font-family: Arial, sans-serif;
                        margin: 40px;
                    }

                    .game-info {
                        background: #f5f5f5;
                        padding: 20px;
                        max-width: 700px;
                        margin-bottom: 25px;
                    }

                    .upload-button {
                        display: inline-block;
                        background: #198754;
                        color: white;
                        padding: 12px 20px;
                        text-decoration: none;
                        border-radius: 5px;
                        margin-bottom: 20px;
                    }

                    table {
                        border-collapse: collapse;
                        width: 100%;
                    }

                    th,
                    td {
                        border: 1px solid #777;
                        padding: 10px;
                        text-align: left;
                    }

                    th {
                        background: #f2f2f2;
                    }

                    .view-button {
                        background: #0d6efd;
                        color: white;
                        padding: 7px 12px;
                        text-decoration: none;
                        border-radius: 4px;
                    }

                </style>

            </head>


            <body>

                <h1>Game Documents</h1>


                <div class="game-info">

                    <h2>
                        ${game.teama}
                        vs
                        ${game.teamb}
                    </h2>

                    <p>
                        <strong>Competition:</strong>
                        ${game.competition || '-'}
                    </p>

                    <p>
                        <strong>Date:</strong>
                        ${game.gamedate || '-'}
                    </p>

                    <p>
                        <strong>Time:</strong>
                        ${game.gametime || '-'}
                    </p>

                </div>


                <a
                    class="upload-button"
                    href="/games/${game.gameid}/documents/new"
                >
                    + Upload Document
                </a>


                <table>

                    <thead>

                        <tr>

                            <th>Document</th>
                            <th>Type</th>
                            <th>Uploaded</th>
                            <th>Action</th>

                        </tr>

                    </thead>


                    <tbody>

                        ${
                            documents.rows.length === 0

                            ?

                            `
                            <tr>

                                <td colspan="4">
                                    No documents uploaded yet.
                                </td>

                            </tr>
                            `

                            :

                            documents.rows.map(document => `

                                <tr>

                                    <td>
                                        ${document.filename}
                                    </td>

                                    <td>
                                        ${document.documenttype || '-'}
                                    </td>

                                    <td>
                                        ${new Date(
                                            document.uploaded_at
                                        ).toLocaleString()}
                                    </td>

                                    <td>

                                        <a
                                            class="view-button"
                                            href="/uploads/${document.filepath}"
                                            target="_blank"
                                        >
                                            View / Download
                                        </a>

                                    </td>

                                </tr>

                            `).join('')
                        }

                    </tbody>

                </table>


                <p>

                    <a href="/statistics">
                        Back to Statistics
                    </a>

                    |

                    <a href="/games">
                        Back to Games
                    </a>

                </p>

            </body>

            </html>

        `);

    } catch (error) {

        console.error(error);

        res.status(500).send(
            'Error loading documents: ' +
            error.message
        );

    }

});

// ======================================================
// STATISTICS / REPORTS
// ======================================================

module.exports = router;
