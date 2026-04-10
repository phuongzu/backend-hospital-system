import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User from '../models/user';

export interface AuthRequest extends Request {
  user?: any;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  console.log('🔐 Authorization Header:', authHeader);
  console.log('🔐 Request URL:', req.url);
  console.log('🔐 Request Method:', req.method);

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    console.log('🔐 Token received:', token ? 'Yes' : 'No');

    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('❌ JWT_SECRET environment variable is not set');
        return res.status(500).json({ message: 'Server configuration error' });
      }

      const decoded = jwt.verify(token, secret) as { id: string; role?: string };
      console.log('🔎 Decoded JWT:', decoded);

      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        console.log('❌ User not found in database');
        return res.status(401).json({ message: 'User not found' });
      }

      console.log('✅ User authenticated:', { id: user._id, role: user.role, email: user.email });
      req.user = user;
      next();
    } catch (err) {
      console.error('❌ Invalid token', err);
      return res.status(401).json({ message: 'Invalid token' });
    }
  } else {
    console.log('❌ No token provided or invalid format');
    return res.status(403).json({ message: 'No token, access forbidden' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      console.log('❌ No user found in request for authorization');
      res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
      return;
    }

    console.log('🔐 Authorization check - User role:', req.user.role, 'Required roles:', roles);

    if (!roles.includes(req.user.role)) {
      console.log('❌ Access denied - User role not authorized:', {
        userRole: req.user.role,
        requiredRoles: roles,
        userId: req.user._id,
        email: req.user.email
      });

      res.status(403).json({
        success: false,
        message: `Access denied. ${req.user.role} role is not authorized to access this resource.`
      });
      return;
    }

    console.log('✅ Authorization granted for user:', req.user.email);
    next();
  };
};
