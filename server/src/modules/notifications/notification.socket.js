import jwt from 'jsonwebtoken';
import fs  from 'fs';

const PUBLIC_KEY = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');

export function registerNotificationSocket(io) {
  const ns = io.of('/notifications');

  // JWT auth middleware
  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token
      ?? socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = jwt.verify(token, PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer    : process.env.JWT_ISSUER   || 'hms',
        audience  : process.env.JWT_AUDIENCE || 'hms-client',
      });
      socket.user = { id: payload.sub, roles: payload.roles ?? [] };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  ns.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    socket.on('notification:read', async ({ notificationId }) => {
      // Handled via REST — socket event is just for optimistic UI sync
      ns.to(`user:${socket.user.id}`).emit('notification:read_ack', { notificationId });
    });

    socket.on('disconnect', () => {});
  });

  return ns;
}
