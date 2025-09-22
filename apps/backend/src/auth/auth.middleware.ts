import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JsonDatabase } from '../storage/json-db.js';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string };
}

export const createAuthMiddleware = (db: JsonDatabase, jwtSecret: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = jwt.verify(token, jwtSecret) as { sub: string; email: string };
      const user = await db.findUserById(payload.sub);
      if (!user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      req.user = { id: user.id, email: user.email };
      return next();
    } catch (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
  };
};
