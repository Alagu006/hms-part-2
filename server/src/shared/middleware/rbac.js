/**
 * RBAC middleware factory.
 *
 * Usage:
 *   router.get('/resource', authenticate, authorize('ADMIN', 'DOCTOR'), handler)
 *
 * Supports wildcard: authorize('*') allows any authenticated user.
 */
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    if (allowedRoles.includes('*')) {
      return next();
    }

    const userRoles = req.user.roles ?? [];
    const permitted = allowedRoles.some((role) => userRoles.includes(role));

    if (!permitted) {
      return res.status(403).json({
        error: `Access denied. Required roles: ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
}

/**
 * Convenience: only SUPER_ADMIN or ADMIN
 */
export const adminOnly = authorize('SUPER_ADMIN', 'ADMIN');

/**
 * Convenience: clinical staff
 */
export const clinicalStaff = authorize(
  'SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'NURSE', 'ANESTHETIST', 'RADIOLOGIST'
);
