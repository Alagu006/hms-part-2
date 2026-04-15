/**
 * Minimal migration runner — reads all SQL files from ./migrations
 * and executes them in filename order. Safe to re-run (uses IF NOT EXISTS).
 *
 * Usage:  node src/db/migrate.js
 */
import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../shared/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  console.log(`Running migration: ${file}`);
  try {
    await pool.query(sql);
    console.log(`  ✓ ${file}`);
  } catch (err) {
    console.error(`  ✗ ${file}: ${err.message}`);
    process.exit(1);
  }
}

await pool.end();
console.log('All migrations complete.');
