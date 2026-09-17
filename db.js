const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Render Postgres requires SSL
    })
  : new Pool({
      user: 'postgres',
      host: 'localhost',
      database: 'arab_db',
      password: '4556',
      port: 5432,
    });

module.exports = pool;