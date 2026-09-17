const readline = require('readline');
const crypto = require('crypto');
const pool = require('../db');

function ask(question, hidden = false) {
    return new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        if (!hidden) {
            rl.question(question, answer => {
                rl.close();
                resolve(answer.trim());
            });
            return;
        }

        process.stdout.write(question);
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        let password = '';

        const onData = char => {
            if (char === '\u0003') {
                stdin.setRawMode(wasRaw);
                stdin.removeListener('data', onData);
                rl.close();
                process.exit(1);
            }

            if (char === '\r' || char === '\n') {
                stdin.setRawMode(wasRaw);
                stdin.removeListener('data', onData);
                stdin.pause();
                process.stdout.write('\n');
                rl.close();
                resolve(password);
                return;
            }

            if (char === '\u007f') {
                password = password.slice(0, -1);
                return;
            }

            password += char;
        };

        stdin.on('data', onData);
    });
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt}$${key.toString('hex')}`;
}

async function main() {
    console.log('\nARAB Reporting System - Create Administrator\n');

    const username = await ask('Admin username: ');
    const fullname = await ask('Admin full name: ');
    const password = await ask('Admin password (minimum 8 characters): ', true);

    if (!username || !fullname || password.length < 8) {
        throw new Error('Username and full name are required; password must be at least 8 characters.');
    }

    const passwordHash = hashPassword(password);

    await pool.query(`
        INSERT INTO public.users
            (username, fullname, role, password_hash, is_active)
        VALUES ($1, $2, 'admin', $3, TRUE)
        ON CONFLICT (username)
        DO UPDATE SET
            fullname = EXCLUDED.fullname,
            role = 'admin',
            password_hash = EXCLUDED.password_hash,
            is_active = TRUE,
            updated_at = NOW()
    `, [username, fullname, passwordHash]);

    console.log(`\nAdministrator '${username}' is ready.`);
    console.log('You can now start the application and open http://localhost:3000/login\n');
}

main()
    .catch(error => {
        console.error('\nFailed to create administrator:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
