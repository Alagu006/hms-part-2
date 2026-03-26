import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Connection factory — shared config for all Redis clients
// ---------------------------------------------------------------------------
function createClient(overrides = {}) {
  const client = new Redis({
    host              : process.env.REDIS_HOST || '127.0.0.1',
    port              : parseInt(process.env.REDIS_PORT || '6379', 10),
    password          : process.env.REDIS_PASSWORD || undefined,
    db                : parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null,          // required by BullMQ
    enableReadyCheck  : true,
    lazyConnect       : false,
    // Reconnect strategy: exponential back-off capped at 30s
    retryStrategy(times) {
      if (times > 20) {
        console.error('[redis] Max reconnect attempts reached. Giving up.');
        return null; // stop retrying
      }
      const delay = Math.min(100 * 2 ** times, 30_000);
      console.warn(`[redis] Reconnecting in ${delay}ms (attempt ${times})...`);
      return delay;
    },
    ...overrides,
  });

  client.on('connect',           () => console.log('[redis] Connected'));
  client.on('ready',             () => console.log('[redis] Ready'));
  client.on('error',  (err)      => console.error('[redis] Error:', err.message));
  client.on('close',             () => console.warn('[redis] Connection closed'));
  client.on('reconnecting', (ms) => console.warn(`[redis] Reconnecting in ${ms}ms`));

  return client;
}

// ---------------------------------------------------------------------------
// Singleton clients
// Primary client for general use; subscriber is a dedicated connection
// (ioredis requires a separate client for pub/sub)
// ---------------------------------------------------------------------------
export const redis      = createClient();
export const subscriber = createClient();  // dedicated for subscribe()

// ---------------------------------------------------------------------------
// Helper wrappers
// ---------------------------------------------------------------------------

/**
 * SET key value EX seconds
 */
export async function setEx(key, ttlSeconds, value) {
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return redis.setex(key, ttlSeconds, serialized);
}

/**
 * GET key — auto-parses JSON if the value looks like JSON
 */
export async function get(key) {
  const value = await redis.get(key);
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * DEL one or more keys
 */
export async function del(...keys) {
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

/**
 * INCR key — atomic increment
 */
export async function incr(key) {
  return redis.incr(key);
}

/**
 * EXPIRE key seconds
 */
export async function expire(key, ttlSeconds) {
  return redis.expire(key, ttlSeconds);
}

/**
 * PUBLISH channel message
 */
export async function publish(channel, message) {
  const payload = typeof message === 'object' ? JSON.stringify(message) : String(message);
  return redis.publish(channel, payload);
}

/**
 * SUBSCRIBE to a channel.
 * Callback receives (channel, parsedMessage).
 *
 * @param {string|string[]} channels
 * @param {function}        callback  — (channel, message) => void
 */
export async function subscribe(channels, callback) {
  const list = Array.isArray(channels) ? channels : [channels];
  await subscriber.subscribe(...list);

  subscriber.on('message', (channel, raw) => {
    let message = raw;
    try { message = JSON.parse(raw); } catch { /* leave as string */ }
    callback(channel, message);
  });
}

/**
 * UNSUBSCRIBE from channels
 */
export async function unsubscribe(...channels) {
  return subscriber.unsubscribe(...channels);
}

/**
 * Graceful shutdown — close both connections
 */
export async function closeRedis() {
  await redis.quit();
  await subscriber.quit();
}
