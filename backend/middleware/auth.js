import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'music-swipe-dev-secret-change-in-prod';

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      req.userId = payload.userId;
      req.username = payload.username;
    } catch {
      // ignore invalid token for optional auth
    }
  }
  next();
}

export { JWT_SECRET };
