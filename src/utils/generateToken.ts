import jwt from 'jsonwebtoken';

export const generateToken = (userId: string, role?: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  
  const payload: any = { id: userId };
  if (role) {
    payload.role = role;
  }
  
  return jwt.sign(payload, secret, {
    expiresIn: '7d',
  });
};
