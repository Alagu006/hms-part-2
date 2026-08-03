#!/usr/bin/env node

/**
 * Fix malformed group encryption keys
 * This script deletes all existing group keys so they can be regenerated
 * with the correct DB_ENCRYPTION_KEY
 */

import pg from 'pg';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

async function fixGroupKeys() {
  console.log('\n🔧 Fixing malformed group encryption keys...\n');

  let client;
  let redis;

  try {
    // Connect to PostgreSQL
    client = new pg.Client({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5555', 10),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : false,
    });

    await client.connect();
    console.log('✅ Connected to PostgreSQL');

    // Delete all existing group keys from database
    const result = await client.query(
      'DELETE FROM message_group_keys RETURNING group_id'
    );

    console.log(`✅ Deleted ${result.rowCount} malformed group keys from database`);

    // Connect to Redis
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
    });

    // Clear Redis cache for group keys
    const keys = await redis.keys('groupkey:*');
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`✅ Cleared ${keys.length} cached group keys from Redis`);
    } else {
      console.log('ℹ️  No cached group keys found in Redis');
    }

    console.log('\n✨ Done! Group keys will be regenerated automatically when users access their groups.\n');
    console.log('⚠️  Note: Users will need to refresh their messaging page to get new keys.\n');

  } catch (error) {
    console.error('❌ Error fixing group keys:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    if (client) await client.end();
    if (redis) redis.disconnect();
  }
}

fixGroupKeys();
