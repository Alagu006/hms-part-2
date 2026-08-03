import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const p = new Pool({
  host    : process.env.DB_HOST,
  port    : parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user    : process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

try {
  const r = await p.query('SELECT current_database(), current_user, version()');
  console.log('✅ Connected!');
  console.log('  DB   :', r.rows[0].current_database);
  console.log('  User :', r.rows[0].current_user);
  console.log('  PG   :', r.rows[0].version.split(' ').slice(0,2).join(' '));
} catch (e) {
  console.error('❌ Connection failed:', e.message);
} finally {
  await p.end();
}
