import { Server }  from 'socket.io';
import jwt         from 'jsonwebtoken';
import fs          from 'fs';

import { registerNotificationSocket } from './modules/notifications/notification.socket.js';
import { registerMessagingSocket }    from './modules/messaging/messaging.socket.js';
import { registerTelemedicineSocket } from './modules/telemedicine/telemedicine.socket.js';

// ---------------------------------------------------------------------------
// Load RS256 public key once at startup
// ---------------------------------------------------------------------------
const PUBLIC_KEY = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Shared JWT auth middleware for all Socket.io namespaces
// ---------------------------------------------------------------------------
export function socketAuthMiddleware(socket, next) {
  const token =
    socket.handshake.auth?.token ??
    socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) return next(new Error('Authentication required'));

  try {
    const payload = jwt.verify(token, PUBLIC_KEY, {
      algorithms: ['RS256'],
      issuer    : process.env.JWT_ISSUER   || 'hms',
      audience  : process.env.JWT_AUDIENCE || 'hms-client',
    });

    socket.user = {
      id          : payload.sub,
      roles       : payload.roles ?? [],
      firstName   : payload.firstName,
      lastName    : payload.lastName,
      departmentId: payload.departmentId,
    };

    next();
  } catch (err) {
    next(new Error(err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token'));
  }
}

// ---------------------------------------------------------------------------
// Bootstrap Socket.io — attach to the HTTP server, register all namespaces
// ---------------------------------------------------------------------------
export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl)
        if (!origin) return callback(null, true);
        const allowed = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
          .split(',')
          .map(o => o.trim());
        // Also allow any https:// origin in development
        if (process.env.NODE_ENV !== 'production' && origin.startsWith('https://')) {
          return callback(null, true);
        }
        if (allowed.includes(origin)) return callback(null, true);
        callback(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true,
    },
    // Prefer WebSocket, fall back to polling
    transports: ['websocket', 'polling'],
    // Ping every 25 s, disconnect after 60 s of silence
    pingInterval: 25_000,
    pingTimeout : 60_000,
  });

  // ── Default namespace: reject unauthenticated connections ─────────────────
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    // Join a personal room so server can push to a specific user
    socket.join(`user:${socket.user.id}`);

    socket.on('disconnect', () => {});
  });

  // ── Feature namespaces ────────────────────────────────────────────────────
  // Each namespace applies its own auth middleware internally
  registerNotificationSocket(io);   // /notifications
  registerMessagingSocket(io);      // /messaging
  registerTelemedicineSocket(io);   // /telemedicine

  return io;
}
