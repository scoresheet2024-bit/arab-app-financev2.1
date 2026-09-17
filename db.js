const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'arab_db',
  password: '4556',
  port: 5432,
});

module.exports = pool;