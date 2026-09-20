const express = require('express');
const fs = require('fs');
const path = require('path');

const pool = require('../db');
const { upload, uploadDir } = require('../middleware/upload');
const { requireRole } = require('../middleware/auth');
const { requireAssignedGame } = require('../middleware/permissions');

const router = express.Router();
router.use(requireRole('admin', 'official', 'to', 'finance'));

function isOwnRole(req) {
    return req.user && (req.user.role === 'official' || req.user.role === 'to');
}

async function ensureGameAccess(req, gameid) {
    if (!isOwnRole(req)) return true;
    const officialId = Number(req.user.officialid);
    if (!Number.isInteger(officialId) || officialId <= 0) return false;

    const result = await pool.query(`
        SELECT 1
        FROM public.games g
        WHERE g.gameid = $1
          AND (
                EXISTS (
                    SELECT 1 FROM public.assignments a
                    WHERE a.gameid = g.gameid AND a.officialid = $2
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
        LIMIT 1
    `, [gameid, officialId]);
    return result.rows.length > 0;
}

async function denyIfNotOwnGame(req, res, gameid) {
    if (!isOwnRole(req)) return false;
    const allowed = await ensureGameAccess(req, gameid);
    if (!allowed) {
        res.status(403).send('Access denied. This game is not assigned to you.');
        return true;
    }
    return false;
}


// ======================================================
// GAME REPORTS LIST
// ======================================================
router.get('/game-reports', async (req, res) => {
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
                COALESCE(g.report_submitted, FALSE) AS report_submitted,
                g.report_submitted_by
            FROM public.games g
            LEFT JOIN public.competitions c ON g.competitionid = c.competitionid
            WHERE g.assigned = TRUE
              AND COALESCE(g.report_submitted, FALSE) = TRUE
              AND (
                    $1::text IN ('admin', 'finance')
                    OR (
                        $1::text IN ('official', 'to')
                        AND $2::integer IS NOT NULL
                        AND (
                            EXISTS (SELECT 1 FROM public.assignments a WHERE a.gameid = g.gameid AND a.officialid = $2)
                            OR g.official1_id = $2 OR g.official2_id = $2 OR g.official3_id = $2
                            OR g.scorer_id = $2 OR g.timer_id = $2 OR g.shot_clock_operator_id = $2
                            OR g.assistant_scorer_id = $2 OR g.commissioner_id = $2
                        )
                    )
                  )
            ORDER BY g.gamedate DESC, g.gametime DESC, g.gameid DESC
        `, [req.user.role, req.user.officialid]);
        res.render('game-reports', { games: result.rows });
    } catch (error) {
        console.error('Error loading game reports:', error);
        res.status(500).send('Error loading game reports: ' + error.message);
    }
});

// ======================================================
// REPORT / EDIT OFFICIALS
// ======================================================
router.get('/games/report/:id', async (req, res) => {
    try {
        const gameid = req.params.id;

        if (await denyIfNotOwnGame(req, res, gameid)) return;

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
                g.report_submitted_by,
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

        res.render('game-report', {
            game,
            officials: officialsResult.rows,
            documents: documentsResult.rows,
	    readOnly: game.report_submitted
        });
    } catch (error) {
        console.error('Error loading game report:', error);
        res.status(500).send('Error loading game report: ' + error.message);
    }
});

// ======================================================
// EDIT ASSIGNED OFFICIALS
// Saves the edited official assignments and returns to the
// same Game Report page. This does NOT submit the report.
// ======================================================
router.post('/games/report/:id/officials', async (req, res) => {
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

        const ids = [
            referee_id, umpire1_id, umpire2_id, scorer_id,
            timer_id, shot_clock_operator_id, assistant_scorer_id,
            commissioner_id
        ].map(value => value ? Number(value) : null);

        if (ids.some(value => value !== null && Number.isNaN(value))) {
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
            return res.status(404).send('Game not found.');
        }

        if (!gameResult.rows[0].assigned) {
            await client.query('ROLLBACK');
            return res.status(400).send('The game must be assigned before officials can be edited.');
        }

        if (gameResult.rows[0].report_submitted) {
            await client.query('ROLLBACK');
            return res.status(400).send('This report has already been submitted and cannot be edited.');
        }

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

        await client.query(`
            UPDATE public.games
            SET official1_id = $1,
                official2_id = $2,
                official3_id = $3,
                scorer_id = $4,
                timer_id = $5,
                shot_clock_operator_id = $6,
                assistant_scorer_id = $7,
                commissioner_id = $8
            WHERE gameid = $9
        `, [...ids, gameid]);

        await client.query('COMMIT');

        // Stay on the report page after saving officials.
        return res.redirect(`/games/report/${gameid}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error editing game officials:', error);
        return res.status(500).send('Error editing game officials: ' + error.message);
    } finally {
        client.release();
    }
});

// ======================================================
// SUBMIT FINAL GAME REPORT
// Saves final officials + optional uploaded document
// and then returns the user to Assigned Games.
// ======================================================
router.post('/games/report/:id/submit', requireRole('admin', 'official', 'to'), upload.single('document'), async (req, res) => {
    const client = await pool.connect();

    try {
        const gameid = req.params.id;

        if (await denyIfNotOwnGame(req, res, gameid)) {
            if (req.file) safeDeleteUploadedFile(req.file.filename);
            return;
        }

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

        // Only Admin may change official assignments. Official/TO submit the report
        // for their assigned game without changing the existing assignment.
        let ids = null;
        if (req.user.role === 'admin') {
            ids = [
                referee_id, umpire1_id, umpire2_id, scorer_id,
                timer_id, shot_clock_operator_id, assistant_scorer_id,
                commissioner_id
            ].map(value => value ? Number(value) : null);

            if (ids.some(value => value !== null && Number.isNaN(value))) {
                if (req.file) safeDeleteUploadedFile(req.file.filename);
                return res.status(400).send('One or more official IDs are invalid.');
            }
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

        if (req.user.role === 'admin') {
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

        if (req.user.role === 'admin') {
            await client.query(`
                UPDATE public.games
                SET official1_id = $1, official2_id = $2, official3_id = $3,
                    scorer_id = $4, timer_id = $5, shot_clock_operator_id = $6,
                    assistant_scorer_id = $7, commissioner_id = $8,
                    assigned = TRUE, report_submitted = TRUE,
                    report_submitted_by = $9
                WHERE gameid = $10
            `, [...ids, req.user.fullname || req.user.username || 'Unknown User', gameid]);
        } else {
            await client.query(`
                UPDATE public.games
                SET report_submitted = TRUE, report_submitted_by = $2
                WHERE gameid = $1
            `, [gameid, req.user.fullname || req.user.username || 'Unknown User']);
        }

        await client.query('COMMIT');
        res.redirect('/assigned-games');
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
router.get('/games/:id/documents/upload', async (req, res) => {
    try {
        const gameid = req.params.id;
        if (await denyIfNotOwnGame(req, res, gameid)) return;
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

        if (await denyIfNotOwnGame(req, res, gameid)) {
            if (req.file) safeDeleteUploadedFile(req.file.filename);
            return;
        }

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
router.get('/games/:id/documents', async (req, res) => {
    try {
        const gameid = req.params.id;
        if (await denyIfNotOwnGame(req, res, gameid)) return;
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
