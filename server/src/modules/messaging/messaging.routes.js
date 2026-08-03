import { Router } from 'express';
import { z }             from 'zod';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import * as svc            from './messaging.service.js';

const router = Router();
router.use(apiRateLimiter);
router.use(authenticate);

const uuid = z.string().uuid();

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮'];

const createGroupSchema = z.object({
  body: z.object({
    name     : z.string().min(1).max(100),
    memberIds: z.array(uuid).min(1).max(50),
  }),
});

const historySchema = z.object({
  params: z.object({ groupId: uuid }),
  query : z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

const dmHistorySchema = z.object({
  params: z.object({ userId: uuid }),
  query : z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

const reactSchema = z.object({
  params: z.object({ id: uuid }),
  body  : z.object({
    emoji : z.enum(ALLOWED_EMOJIS),
    remove: z.boolean().optional().default(false),
  }),
});

const markReadSchema = z.object({
  params: z.object({ id: uuid }),
});

// GET /messages/users — list all non-patient staff (for DM picker + group creation)
router.get(
  '/users',
  authorize('SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST',
            'LAB_TECH','PHARMACIST','HR','IT_ADMIN'),
  async (req, res, next) => {
    try {
      const users = await svc.getMessagingUsers(req.user.id);
      res.json({ data: users });
    } catch (err) { next(err); }
  }
);

// GET /messages/groups
router.get('/groups', async (req, res, next) => {
  try {
    const groups = await svc.getUserGroups(req.user.id);
    res.json({ data: groups });
  } catch (err) { next(err); }
});

// POST /messages/groups
router.post(
  '/groups',
  authorize('SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST',
            'LAB_TECH','PHARMACIST','HR','IT_ADMIN'),
  validate(createGroupSchema),
  async (req, res, next) => {
    try {
      const group = await svc.createGroup(
        req.body.name, 'GROUP', req.user.id, req.body.memberIds
      );
      res.status(201).json({ data: group });
    } catch (err) { next(err); }
  }
);

// GET /messages/groups/:groupId/key — fetch shared group encryption key
router.get('/groups/:groupId/key', async (req, res, next) => {
  try {
    const member = await svc.isMember(req.params.groupId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Not a member' });
    const key = await svc.getOrCreateGroupKey(req.params.groupId);
    res.json({ key });
  } catch (err) { next(err); }
});

// GET /messages/groups/:groupId/members
router.get('/groups/:groupId/members', async (req, res, next) => {
  try {
    const member = await svc.isMember(req.params.groupId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Not a member of this group' });
    const members = await svc.getGroupMembers(req.params.groupId);
    res.json({ data: members });
  } catch (err) { next(err); }
});

// POST /messages/groups/:groupId/members — add a member
router.post('/groups/:groupId/members', async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(422).json({ error: 'userId required' });
    const isMember = await svc.isMember(req.params.groupId, req.user.id);
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });
    await svc.addMember(req.params.groupId, userId);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// GET /messages/groups/:groupId/history
router.get(
  '/groups/:groupId/history',
  validate(historySchema),
  async (req, res, next) => {
    try {
      const result = await svc.getGroupHistory(
        req.params.groupId, req.user.id, req.query
      );
      if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Not a member' });
      res.json(result);
    } catch (err) { next(err); }
  }
);

// GET /messages/groups/:groupId/pinned
router.get('/groups/:groupId/pinned', async (req, res, next) => {
  try {
    const member = await svc.isMember(req.params.groupId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Not a member of this group' });
    const pinned = await svc.getPinnedMessages(req.params.groupId);
    res.json({ data: pinned });
  } catch (err) { next(err); }
});

// GET /messages/direct/:userId/history
router.get(
  '/direct/:userId/history',
  authorize('SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST',
            'LAB_TECH','PHARMACIST','HR','IT_ADMIN'),
  validate(dmHistorySchema),
  async (req, res, next) => {
    try {
      const result = await svc.getDMHistory(
        req.user.id, req.params.userId, req.query
      );
      res.json(result);
    } catch (err) { next(err); }
  }
);

// DELETE /messages/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await svc.deleteMessage(req.params.id, req.user.id);
    if (!result)              return res.status(404).json({ error: 'Message not found' });
    if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Not your message' });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// PATCH /messages/:id/react
router.patch('/:id/react', validate(reactSchema), async (req, res, next) => {
  try {
    const { emoji, remove } = req.body;
    if (remove) {
      await svc.removeReaction(req.params.id, req.user.id, emoji);
    } else {
      await svc.addReaction(req.params.id, req.user.id, emoji);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /messages/:id/read
router.post('/:id/read', validate(markReadSchema), async (req, res, next) => {
  try {
    const result = await svc.markMessageRead(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: 'Message not found' });
    return res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /messages/groups/:groupId/purge-old — admin-only bulk cleanup
router.delete(
  '/groups/:groupId/purge-old',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  async (req, res, next) => {
    try {
      const { beforeDate } = req.query;
      if (!beforeDate) {
        return res.status(422).json({ error: 'beforeDate query parameter required (ISO 8601 format)' });
      }
      
      const isMember = await svc.isMember(req.params.groupId, req.user.id);
      if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this group' });
      }

      const result = await svc.purgeOldMessages(req.params.groupId, beforeDate, req.user.id);
      res.json({ 
        ok: true, 
        deletedCount: result.deletedCount,
        message: `Deleted ${result.deletedCount} old messages from before ${beforeDate}` 
      });
    } catch (err) { next(err); }
  }
);

export default router;
