#!/usr/bin/env node

/**
 * Generate a secure 64-character hexadecimal encryption key
 * for use with DB_ENCRYPTION_KEY environment variable
 */

import crypto from 'crypto';

console.log('\n🔐 Generating secure encryption key...\n');

const key = crypto.randomBytes(32).toString('hex');

console.log('Your new DB_ENCRYPTION_KEY:');
console.log('─'.repeat(70));
console.log(key);
console.log('─'.repeat(70));

console.log('\n📋 Add this to your .env file:');
console.log(`DB_ENCRYPTION_KEY=${key}`);

console.log('\n⚠️  IMPORTANT SECURITY NOTES:');
console.log('  • Never commit this key to version control');
console.log('  • Use different keys for dev, staging, and production');
console.log('  • Store production keys in a secure secrets manager');
console.log('  • Changing this key will invalidate existing encrypted data');
console.log('  • Keep a secure backup of this key\n');
