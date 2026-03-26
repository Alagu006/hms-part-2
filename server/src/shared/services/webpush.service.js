import webpush from 'web-push';
import { query } from '../db/pool.js';

// ---------------------------------------------------------------------------
// VAPID config — keys must be generated once and stored in env:
//   npx web-push generate-vapid-keys
// ---------------------------------------------------------------------------
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.warn('[webpush] VAPID keys not set — push notifications disabled');
} else {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL ?? 'admin@hms.local'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

const pushEnabled = () =>
  !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

// ---------------------------------------------------------------------------
// Save push subscription for a user
// ---------------------------------------------------------------------------
export async function savePushSubscription(userId, subscription) {
  // subscription = { endpoint, keys: { p256dh, auth } }
  const endpoint = subscription.endpoint;

  await query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = $1, p256dh = $3, auth = $4, updated_at = NOW()`,
    [
      userId,
      endpoint,
      subscription.keys?.p256dh ?? '',
      subscription.keys?.auth   ?? '',
    ]
  );
}

// ---------------------------------------------------------------------------
// Remove push subscription (on logout / permission revoked)
// ---------------------------------------------------------------------------
export async function removePushSubscription(userId, endpoint) {
  await query(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint]
  );
}

// ---------------------------------------------------------------------------
// Send push notification to all subscriptions for a user
// ---------------------------------------------------------------------------
export async function sendPushNotification(userId, payload) {
  if (!pushEnabled()) return;

  const { rows } = await query(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  );

  if (!rows.length) return;

  const payloadStr = JSON.stringify(payload);

  await Promise.allSettled(
    rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
          { TTL: 86400 }
        );
      } catch (err) {
        // 410 Gone = subscription expired — clean up
        if (err.statusCode === 410) {
          await query(
            `DELETE FROM push_subscriptions WHERE endpoint = $1`,
            [sub.endpoint]
          ).catch(() => {});
        } else {
          console.warn('[webpush] Send failed:', err.message);
        }
      }
    })
  );
}

export { pushEnabled };
