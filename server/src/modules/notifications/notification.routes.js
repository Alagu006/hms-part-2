import { Router } from 'express';
import { z }             from 'zod';
import { authenticate }   from '../../shared/middleware/auth.js';
import { validate }       from '../../shared/middleware/validate.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
} from '../../shared/services/notification.service.js';
import {
  savePushSubscription,
  removePushSubscription,
  pushEnabled,
} from '../../shared/services/webpush.service.js';

const router = Router();
router.use(apiRateLimiter);
router.use(authenticate);

const uuid = z.string().uuid();

const paginationSchema = z.object({
  query: z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    type : z.string().optional(),
  }),
});

const subscribeSchema = z.object({
  body: z.object({
    subscription: z.object({
      endpoint: z.string().url(),
      keys    : z.object({
        p256dh: z.string().min(1),
        auth  : z.string().min(1),
      }),
    }),
  }),
});

// GET /notifications
router.get('/', validate(paginationSchema), async (req, res, next) => {
  try {
    const result = await getNotifications(req.user.id, req.query);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /notifications/unread-count
router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await getUnreadCount(req.user.id);
    res.json({ count });
  } catch (err) { next(err); }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(422).json({ error: 'Invalid notification ID' });
    }
    const result = await markAsRead(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /notifications/read-all
router.patch('/read-all', async (req, res, next) => {
  try {
    await markAllAsRead(req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /notifications/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(422).json({ error: 'Invalid notification ID' });
    }
    const result = await deleteNotification(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /notifications/subscribe  — save Web Push subscription
router.post('/subscribe', validate(subscribeSchema), async (req, res, next) => {
  try {
    await savePushSubscription(req.user.id, req.body.subscription);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /notifications/subscribe  — remove subscription on logout
router.delete('/subscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(422).json({ error: 'endpoint required' });
    await removePushSubscription(req.user.id, endpoint);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /notifications/vapid-public-key  — client needs this to subscribe
router.get('/vapid-public-key', (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'Push not configured' });
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

export default router;
