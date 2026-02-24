import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../utils/AppError';
import logger from '../utils/logger';

/**
 * Middleware to validate request data against Zod schemas
 * @param schema The Zod schema to validate against
 * @param field The field to validate ('body', 'query', or 'params')
 */
export const validateRequest = (schema: ZodSchema, field: 'body' | 'query' | 'params' = 'body') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req[field]);
      req[field] = validated;
      next();
    } catch (error: any) {
      logger.warn('Validation error', {
        path: req.path,
        method: req.method,
        field,
        errors: error.errors
      });

      const errors = error.errors.map((e: any) => ({
        field: e.path.join('.') || field,
        message: e.message
      }));

      const validationError = new ValidationError('Validation failed', errors);
      next(validationError);
    }
  };
};
