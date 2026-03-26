import { Router }          from 'express';
import { z }               from 'zod';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { rateLimiter }     from '../../shared/middleware/rateLimiter.js';
import { sendMessage, getChatHistory } from './chatbot.service.js';

const router = Router();

// Tighter IP-level rate limit on top of the per-user Redis counter
const chatRateLimiter = rateLimiter({
  windowSecs: 60,
  max       : 30,
  keyFn     : (req) => `chatbot:ip:${req.ip}`,
});

const messageSchema = z.object({
  body: z.object({
    message: z.string().min(1).max(1000),
  }),
});

router.use(authenticate);
router.use(authorize('PATIENT'));

// POST /chatbot/message
router.post(
  '/message',
  chatRateLimiter,
  validate(messageSchema),
  async (req, res) => {
    try {
      const io     = req.app.get('io');
      const result = await sendMessage(req.user.id, req.body.message, io);
      res.json({ data: result });
    } catch (err) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  }
);

// GET /chatbot/history
router.get('/history', async (req, res) => {
  try {
    const history = await getChatHistory(req.user.id);
    res.json({ data: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
