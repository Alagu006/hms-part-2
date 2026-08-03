import cron from 'node-cron';
import { flushAllRefreshTokens } from '../../modules/auth/auth.service.js';
import { auditLog } from '../middleware/audit.js';
import { logger } from '../logger.js';

/**
 * Runs at 00:00 UTC every day.
 * Flushes all active refresh tokens, forcing every user to re-authenticate.
 */
export function scheduleMidnightFlush() {
  cron.schedule('0 0 * * *', async () => {
    logger.info('[cron] Running midnight refresh token flush');
    await flushAllRefreshTokens();
    await auditLog({
      userId  : null,
      action  : 'SYSTEM_FLUSH',
      entity  : 'refresh_tokens',
      nextData: { reason: 'scheduled midnight flush' },
    });
  }, { timezone: 'UTC' });

  logger.info('[cron] Midnight flush job scheduled (00:00 UTC)');
}
