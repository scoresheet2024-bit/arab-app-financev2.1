const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const ROLES = ['admin', 'to', 'official', 'finance'];

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

function validRole(role) {
    return ROLES.includes(role);
}

// ======================================================
// USER LIST - ADMIN ONLY
// ======================================================

router.get('/users', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                u.userid,
                u.username,
                u.fullname,
                u.role,
                u.is_active,
                u.created_at,
                o.fullname AS official_name
            FROM public.users u
            LEFT JOIN public.officials o
                ON o.officialid = u.officialid
            ORDER BY u.userid DESC
        `);

        res.render('users/index', {
            title: 'User Management',
            users: result.rows
        });
    } catch (error) {
        console.error('Error loading users:', error);
        res.status(500).send('Error loading users: ' + error.message);
    }
});

// ======================================================
// NEW USER FORM
// ======================================================

router.get('/users/new', requireRole('admin'), async (req, res) => {
    try {
        const officials = await pool.query(`
            SELECT officialid, fullname
            FROM public.officials
            ORDER BY fullname ASC
        `);

        res.render('users/new', {
            title: 'Add User',
            officials: officials.rows,
            error: null,
            form: {
                username: '',
                fullname: '',
                role: 'official',
                officialid: ''
            }
        });
    } catch (error) {
        console.error('Error loading new user form:', error);
        res.status(500).send('Error loading user form: ' + error.message);
    }
});

// ======================================================
// CREATE USER
// ======================================================

router.post('/users', requireRole('admin'), async (req, res) => {
    const username = (req.body.username || '').trim();
    const fullname = (req.body.fullname || '').trim();
    const role = (req.body.role || '').trim();
    const password = req.body.password || '';
    const officialid = req.body.officialid ? Number(req.body.officialid) : null;

    try {
        const officials = await pool.query(`
            SELECT officialid, fullname
            FROM public.officials
            ORDER BY fullname ASC
        `);

        if (!username || !fullname || !password || !validRole(role)) {
            return res.status(400).render('users/new', {
                title: 'Add User',
                officials: officials.rows,
                error: 'Username, full name, role and password are required.',
                form: { username, fullname, role, officialid: req.body.officialid || '' }
            });
        }

        if (password.length < 8) {
            return res.status(400).render('users/new', {
                title: 'Add User',
                officials: officials.rows,
                error: 'Password must contain at least 8 characters.',
                form: { username, fullname, role, officialid: req.body.officialid || '' }
            });
        }

        await pool.query(`
            INSERT INTO public.users
                (username, fullname, role, officialid, password_hash)
            VALUES ($1, $2, $3, $4, $5)
        `, [username, fullname, role, officialid, hashPassword(password)]);

        res.redirect('/users');
    } catch (error) {
        console.error('Error creating user:', error);

        let message = 'Error creating user: ' + error.message;
        if (error.code === '23505') {
            message = 'That username already exists.';
        }

        try {
            const officials = await pool.query(`
                SELECT officialid, fullname
                FROM public.officials
                ORDER BY fullname ASC
            `);

            res.status(400).render('users/new', {
                title: 'Add User',
                officials: officials.rows,
                error: message,
                form: { username, fullname, role, officialid: req.body.officialid || '' }
            });
        } catch (renderError) {
            res.status(500).send(message);
        }
    }
});

// ======================================================
// EDIT USER FORM
// ======================================================

router.get('/users/edit/:id', requireRole('admin'), async (req, res) => {
    try {
        const userResult = await pool.query(`
            SELECT userid, username, fullname, role, officialid, is_active
            FROM public.users
            WHERE userid = $1
        `, [req.params.id]);

        if (userResult.rows.length === 0) {
            return res.status(404).send('User not found.');
        }

        const officials = await pool.query(`
            SELECT officialid, fullname
            FROM public.officials
            ORDER BY fullname ASC
        `);

        res.render('users/edit', {
            title: 'Edit User',
            user: userResult.rows[0],
            officials: officials.rows,
            error: null
        });
    } catch (error) {
        console.error('Error loading user:', error);
        res.status(500).send('Error loading user: ' + error.message);
    }
});

// ======================================================
// UPDATE USER
// ======================================================

router.post('/users/edit/:id', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    const username = (req.body.username || '').trim();
    const fullname = (req.body.fullname || '').trim();
    const role = (req.body.role || '').trim();
    const officialid = req.body.officialid ? Number(req.body.officialid) : null;

    if (!Number.isInteger(id) || !username || !fullname || !validRole(role)) {
        return res.status(400).send('Invalid user information.');
    }

    try {
        await pool.query(`
            UPDATE public.users
            SET username = $1,
                fullname = $2,
                role = $3,
                officialid = $4,
                updated_at = NOW()
            WHERE userid = $5
        `, [username, fullname, role, officialid, id]);

        res.redirect('/users');
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).send('Error updating user: ' + error.message);
    }
});

// ======================================================
// ACTIVATE / DEACTIVATE USER
// We deactivate instead of deleting users so history is kept.
// ======================================================

router.post('/users/:id/toggle', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
        return res.status(400).send('Invalid user ID.');
    }

    if (id === req.user.userid) {
        return res.status(400).send('You cannot deactivate your own account.');
    }

    try {
        await pool.query(`
            UPDATE public.users
            SET is_active = NOT is_active,
                updated_at = NOW()
            WHERE userid = $1
        `, [id]);

        res.redirect('/users');
    } catch (error) {
        console.error('Error changing user status:', error);
        res.status(500).send('Error changing user status: ' + error.message);
    }
});

// ======================================================
// RESET PASSWORD
// ======================================================

router.post('/users/:id/reset-password', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    const password = req.body.password || '';

    if (!Number.isInteger(id)) {
        return res.status(400).send('Invalid user ID.');
    }

    if (password.length < 8) {
        return res.status(400).send('Password must contain at least 8 characters.');
    }

    try {
        await pool.query(`
            UPDATE public.users
            SET password_hash = $1,
                updated_at = NOW()
            WHERE userid = $2
        `, [hashPassword(password), id]);

        await pool.query(`
            DELETE FROM public.user_sessions
            WHERE userid = $1
        `, [id]);

        res.redirect('/users');
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).send('Error resetting password: ' + error.message);
    }
});

module.exports = router;
