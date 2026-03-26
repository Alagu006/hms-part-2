import jwt from 'jsonwebtoken';
import { PUBLIC_KEY } from '../../modules/auth/auth.service.js';

/**
 * Verifies the RS256 JWT from the Authorization: Bearer header.
 * Attaches decoded payload to req.user on success.
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, PUBLIC_KEY, {
      algorithms: ['RS256'],
      issuer    : process.env.JWT_ISSUER   || 'hms',
      audience  : process.env.JWT_AUDIENCE || 'hms-client',
    });

    req.user = {
      id          : payload.sub,
      roles       : payload.roles ?? [],
      departmentId: payload.departmentId,
      firstName   : payload.firstName,
      lastName    : payload.lastName,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}
