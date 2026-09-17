const express = require('express');
const fs = require('fs');
const path = require('path');

const pool = require('../db');
const { upload, uploadDir } = require('../middleware/upload');
const { requireRole } = require('../middleware/auth');
const { requireAssignedGame, canSubmitGameReport } = require('../middleware/permissions');

const router = express.Router();
// Access is enforced by app.js for all authenticated users.


// ======================================================
// GAME REPORTS LIST
// ======================================================
router.get('/game-reports', requireRole('admin', 'official', 'to'), async (req, res) => {
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
                COALESCE(g.report_submitted, FALSE) AS report_submitted
            FROM public.games g
            LEFT JOIN public.competitions c ON g.competitionid = c.competitionid
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = TRUE
            ORDER BY g.gamedate DESC, g.gametime DESC, g.gameid DESC
        `);
        res.render('game-reports', { games: result.rows });
    } catch (error) {
        console.error('Error loading game reports:', error);
        res.status(500).send('Error loading game reports: ' + error.message);
    }
});

// ======================================================
// REPORT / EDIT OFFICIALS
// ======================================================
router.get('/games/report/:id', requireRole('admin', 'referee', 'official', 'to', 'finance'), async (req, res) => {
    try {
        const gameid = req.params.id;

        const gameResult = await pool.query(`
            SELECT
                g.gameid,
                g.teama,
                g.teamb,
                g.gamedate,
                g.gametime,
                g.court,
                g.assigned,
                COALESCE(g.report_submitted, FALSE) AS report_submitted,
                c.competitionname AS competition,
                c.season,
                g.official1_id AS referee1_id,
                g.official2_id AS umpire1_id,
                g.official3_id AS umpire2_id,
                g.scorer_id,
                g.timer_id,
                g.shot_clock_operator_id,
                g.assistant_scorer_id,
                g.commissioner_id,
                o1.fullname AS referee1,
                o2.fullname AS umpire1,
                o3.fullname AS umpire2,
                os.fullname AS scorer,
                ot.fullname AS timer,
                osc.fullname AS shot_clock_operator,
                oas.fullname AS assistant_scorer,
                oc.fullname AS commissioner
            FROM public.games g
            LEFT JOIN public.competitions c ON g.competitionid = c.competitionid
            LEFT JOIN public.officials o1 ON g.official1_id = o1.officialid
            LEFT JOIN public.officials o2 ON g.official2_id = o2.officialid
            LEFT JOIN public.officials o3 ON g.official3_id = o3.officialid
            LEFT JOIN public.officials os ON g.scorer_id = os.officialid
            LEFT JOIN public.officials ot ON g.timer_id = ot.officialid
            LEFT JOIN public.officials osc ON g.shot_clock_operator_id = osc.officialid
            LEFT JOIN public.officials oas ON g.assistant_scorer_id = oas.officialid
            LEFT JOIN public.officials oc ON g.commissioner_id = oc.officialid
            WHERE g.gameid = $1
        `, [gameid]);

        if (gameResult.rows.length === 0) {
            return res.status(404).send('Game not found');
        }

        const game = gameResult.rows[0];

        if (!game.assigned) {
            return res.status(400).send('This game has not been assigned yet.');
        }

        const officialsResult = await pool.query(`
            SELECT officialid, fullname
            FROM public.officials
            ORDER BY fullname ASC
        `);

        const documentsResult = await pool.query(`
            SELECT documentid, filename, filepath, documenttype, uploaded_at
            FROM public.game_documents
            WHERE gameid = $1
            ORDER BY uploaded_at DESC
        `, [gameid]);

        const canSubmit = await canSubmitGameReport(req, Number(gameid));

        res.render('game-report', {
            game,
            officials: officialsResult.rows,
            documents: documentsResult.rows,
            readOnly: game.report_submitted,
            canSubmit
        });
    } catch (error) {
        console.error('Error loading game report:', error);
        res.status(500).send('Error loading game report: ' + error.message);
    }
});

// ======================================================
// SUBMIT FINAL GAME REPORT
// Saves final officials + optional uploaded document
// and only then moves the game to Statistics.
// ======================================================
router.post('/games/report/:id/submit', requireRole('admin', 'referee', 'official', 'to'), requireAssignedGame, upload.single('document'), async (req, res) => {
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
            commissioner_id,
            documenttype
        } = req.body;

        // NORMAL MODE: every authenticated user has the same report rights as Admin.
        const ids = [
            referee_id, umpire1_id, umpire2_id, scorer_id,
            timer_id, shot_clock_operator_id, assistant_scorer_id,
            commissioner_id
        ].map(value => value ? Number(value) : null);

        if (ids.some(value => value !== null && Number.isNaN(value))) {
            if (req.file) safeDeleteUploadedFile(req.file.filename);
            return res.status(400).send('One or more official IDs are invalid.');
        }

        await client.query('BEGIN');

        const gameResult = await client.query(`
            SELECT gameid, assigned, COALESCE(report_submitted, FALSE) AS report_submitted
            FROM public.games
            WHERE gameid = $1
            FOR UPDATE
        `, [gameid]);

        if (gameResult.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file) safeDeleteUploadedFile(req.file.filename);
            return res.status(404).send('Game not found.');
        }

        const game = gameResult.rows[0];

        if (!game.assigned) {
            await client.query('ROLLBACK');
            if (req.file) safeDeleteUploadedFile(req.file.filename);
            return res.status(400).send('The game must be assigned before submitting a report.');
        }

        if (game.report_submitted) {
            await client.query('ROLLBACK');
            if (req.file) safeDeleteUploadedFile(req.file.filename);
            return res.status(400).send('This report has already been submitted.');
        }

        {
            const roles = [
                ['Referee', ids[0]],
                ['Umpire 1', ids[1]],
                ['Umpire 2', ids[2]],
                ['Scorer', ids[3]],
                ['Timer', ids[4]],
                ['Shot Clock Operator', ids[5]],
                ['Assistant Scorer', ids[6]],
                ['Commissioner', ids[7]]
            ];

            await client.query('DELETE FROM public.assignments WHERE gameid = $1', [gameid]);

            for (const [role, officialid] of roles) {
                if (officialid !== null) {
                    await client.query(`
                        INSERT INTO public.assignments (gameid, officialid, role)
                        VALUES ($1, $2, $3)
                    `, [gameid, officialid, role]);
                }
            }
        }

        if (req.file) {
            await client.query(`
                INSERT INTO public.game_documents
                    (gameid, filename, filepath, documenttype)
                VALUES ($1, $2, $3, $4)
            `, [gameid, req.file.originalname, req.file.filename, documenttype || 'Scoresheet']);
        }

        {
            await client.query(`
                UPDATE public.games
                SET official1_id = $1, official2_id = $2, official3_id = $3,
                    scorer_id = $4, timer_id = $5, shot_clock_operator_id = $6,
                    assistant_scorer_id = $7, commissioner_id = $8,
                    assigned = TRUE, report_submitted = TRUE
                WHERE gameid = $9
            `, [...ids, gameid]);
        }

        await client.query('COMMIT');
        res.redirect('/game-reports');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error submitting game report:', error);
        if (req.file) safeDeleteUploadedFile(req.file.filename);
        res.status(500).send('Error submitting game report: ' + error.message);
    } finally {
        client.release();
    }
});

// ======================================================
// EXISTING DOCUMENT UPLOAD PAGE
// ======================================================
router.get('/games/:id/documents/upload', requireRole('admin', 'official', 'to'), async (req, res) => {
    try {
        const gameid = req.params.id;
        const gameResult = await pool.query(`
            SELECT g.gameid, g.teama, g.teamb, g.gamedate, g.gametime,
                   c.competitionname AS competition, c.season
            FROM public.games g
            LEFT JOIN public.competitions c ON g.competitionid = c.competitionid
            WHERE g.gameid = $1
        `, [gameid]);

        if (gameResult.rows.length === 0) return res.status(404).send('Game not found');
        res.render('upload-document', { game: gameResult.rows[0] });
    } catch (error) {
        console.error('Error loading upload page:', error);
        res.status(500).send('Error loading upload page: ' + error.message);
    }
});

// ======================================================
// EXISTING STANDALONE DOCUMENT UPLOAD
// ======================================================
router.post('/games/:id/documents', requireRole('admin', 'official', 'to'), upload.single('document'), async (req, res) => {
    try {
        const gameid = req.params.id;
        const documenttype = req.body.documenttype;

        if (!req.file) return res.status(400).send('Please select a file to upload.');

        await pool.query(`
            INSERT INTO public.game_documents (gameid, filename, filepath, documenttype)
            VALUES ($1, $2, $3, $4)
        `, [gameid, req.file.originalname, req.file.filename, documenttype]);

        res.redirect(`/games/${gameid}/documents`);
    } catch (error) {
        console.error('Error uploading document:', error);
        if (req.file) safeDeleteUploadedFile(req.file.filename);
        res.status(500).send('Error uploading document: ' + error.message);
    }
});

// ======================================================
// SHOW GAME DOCUMENTS
// ======================================================
router.get('/games/:id/documents', requireRole('admin', 'official', 'to'), async (req, res) => {
    try {
        const gameid = req.params.id;
        const gameResult = await pool.query(`
            SELECT g.gameid, g.teama, g.teamb, g.gamedate, g.gametime,
                   c.competitionname AS competition, c.season
            FROM public.games g
            LEFT JOIN public.competitions c ON g.competitionid = c.competitionid
            WHERE g.gameid = $1
        `, [gameid]);

        if (gameResult.rows.length === 0) return res.status(404).send('Game not found');

        const documentsResult = await pool.query(`
            SELECT documentid, filename, filepath, documenttype, uploaded_at
            FROM public.game_documents
            WHERE gameid = $1
            ORDER BY uploaded_at DESC
        `, [gameid]);

        res.render('game-documents', { game: gameResult.rows[0], documents: documentsResult.rows });
    } catch (error) {
        console.error('Error loading game documents:', error);
        res.status(500).send('Error loading game documents: ' + error.message);
    }
});

function safeDeleteUploadedFile(filename) {
    try {
        const filePath = path.join(uploadDir, filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (deleteError) {
        console.error('Could not remove uploaded file:', deleteError);
    }
}

module.exports = router;
