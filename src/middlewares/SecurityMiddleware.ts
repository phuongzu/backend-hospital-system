import { Request, Response, NextFunction } from 'express';

// ==================== PROMPT INJECTION PATTERNS ====================

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /forget\s+(everything|all|previous)/i,
  /you\s+are\s+now\s+(a\s+)?/i,
  /act\s+as\s+(if\s+you\s+are\s+)?/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /disregard\s+(your|all|previous)/i,
  /override\s+(your\s+)?(instructions|rules|guidelines)/i,
  /system\s*:\s*/i,
  /<\s*system\s*>/i,
  /\[INST\]/i,
  /###\s*(instruction|system|prompt)/i,
  /jailbreak/i,
  /dan\s+mode/i,
  /developer\s+mode/i,
];

const XSS_PATTERNS: RegExp[] = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
];

// ==================== SANITIZE INPUT ====================

export function sanitizeInput(text: string): { safe: boolean; sanitized: string; reason?: string } {
  if (!text || typeof text !== 'string') {
    return { safe: false, sanitized: '', reason: 'Invalid input type' };
  }

  // Check length
  if (text.length > 500) {
    return { safe: false, sanitized: '', reason: 'Input too long' };
  }

  // Check XSS
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, sanitized: '', reason: 'Potentially unsafe content detected' };
    }
  }

  // Check prompt injection
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, sanitized: '', reason: 'Invalid message format' };
    }
  }

  // Basic sanitize: strip HTML tags, trim
  const sanitized = text
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .trim();

  return { safe: true, sanitized };
}

// ==================== MIDDLEWARE ====================

export function inputSanitizationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.body?.message) {
    const result = sanitizeInput(req.body.message);
    if (!result.safe) {
      res.status(400).json({
        success: false,
        message: result.reason || 'Invalid input',
      });
      return;
    }
    req.body.message = result.sanitized;
  }
  next();
}

// ==================== AUDIT LOGGER ====================

export interface AuditEntry {
  userId?: string;
  sessionId?: string;
  action: string;
  userMessage?: string;
  aiResponse?: string;
  category?: string;
  urgencyLevel?: string;
  emergencyAlert?: boolean;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  appointmentBooked?: boolean;
  metadata?: Record<string, unknown>;
}

// In production, replace with a proper audit log service (e.g., write to DB, ELK, etc.)
class AuditLogger {
  private logs: AuditEntry[] = [];
  private readonly MAX_IN_MEMORY = 1000;

  log(entry: AuditEntry): void {
    // Always include timestamp
    entry.timestamp = entry.timestamp || new Date();

    // Store in memory (replace with DB write in production)
    this.logs.push(entry);
    if (this.logs.length > this.MAX_IN_MEMORY) {
      this.logs = this.logs.slice(-this.MAX_IN_MEMORY);
    }

    // Log emergencies to console immediately
    if (entry.emergencyAlert || entry.urgencyLevel === 'high') {
      console.warn('🚨 AUDIT [HIGH PRIORITY]:', JSON.stringify({
        userId: entry.userId,
        action: entry.action,
        category: entry.category,
        urgencyLevel: entry.urgencyLevel,
        emergencyAlert: entry.emergencyAlert,
        timestamp: entry.timestamp,
      }));
    }
  }

  getLogs(userId?: string, limit = 100): AuditEntry[] {
    let result = this.logs;
    if (userId) result = result.filter(l => l.userId === userId);
    return result.slice(-limit);
  }

  // Persist to DB — call this periodically in production
  async persistToDB(): Promise<void> {
    // TODO: implement DB persistence
    // await AuditLog.insertMany(this.logs);
    // this.logs = [];
  }
}

export const auditLogger = new AuditLogger();