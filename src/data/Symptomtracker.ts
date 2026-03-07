import mongoose, { Schema, Document, Model } from 'mongoose';

// ==================== SCHEMA ====================

export interface ISymptomLog extends Document {
  user_id: mongoose.Types.ObjectId;
  session_id: string;
  symptom: string;
  severity: number; // 1-5
  timestamp: Date;
  category?: string;
  notes?: string;
}

const SymptomLogSchema = new Schema<ISymptomLog>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  session_id: { type: String, required: true },
  symptom: { type: String, required: true, trim: true, lowercase: true },
  severity: { type: Number, min: 1, max: 5, default: 3 },
  timestamp: { type: Date, default: Date.now, index: true },
  category: { type: String, trim: true },
  notes: { type: String, trim: true },
});

SymptomLogSchema.index({ user_id: 1, timestamp: -1 });
SymptomLogSchema.index({ user_id: 1, symptom: 1 });

export const SymptomLog = mongoose.model<ISymptomLog>('SymptomLog', SymptomLogSchema);

// ==================== TRACKER CLASS ====================

export interface SymptomTrend {
  symptom: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  averageSeverity: number;
  trend: 'improving' | 'worsening' | 'stable' | 'new';
  category?: string;
}

// Severity keywords → numeric map
const SEVERITY_KEYWORDS: Record<string, number> = {
  // Severity 5 — critical
  'dữ dội': 5, 'cực kỳ': 5, 'không chịu nổi': 5, 'rất nặng': 5,
  'severe': 5, 'unbearable': 5, 'excruciating': 5, 'extreme': 5,

  // Severity 4 — serious
  'nặng': 4, 'nghiêm trọng': 4, 'bad': 4, 'serious': 4, 'intense': 4,

  // Severity 3 — moderate
  'vừa': 3, 'trung bình': 3, 'khá': 3,
  'moderate': 3, 'medium': 3, 'noticeable': 3,

  // Severity 2 — mild
  'nhẹ': 2, 'hơi': 2, 'một chút': 2,
  'mild': 2, 'slight': 2, 'little': 2, 'minor': 2,

  // Severity 1 — minimal
  'rất nhẹ': 1, 'barely': 1, 'minimal': 1,
};

export class SymptomTrackerService {
  // ==================== DETECT SEVERITY FROM TEXT ====================

  static detectSeverity(message: string): number {
    const lower = message.normalize('NFC').toLowerCase();
    for (const [keyword, score] of Object.entries(SEVERITY_KEYWORDS)) {
      if (lower.includes(keyword.normalize('NFC').toLowerCase())) return score;
    }
    return 3;
  }

  static extractSymptoms(message: string, detectedSymptoms: string[]): string[] {
    const symptoms = [...detectedSymptoms];
    const normalizedMsg = message.normalize('NFC');

    const patterns = [
      /bị\s+([\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+?)(?:\s+(?:từ|trong|khoảng|mấy)|[,.]|$)/giu,
      /đau\s+([\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+?)(?:\s+(?:từ|trong|khoảng|mấy)|[,.]|$)/giu,
      /triệu chứng[:\s]+([\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ,]+)/giu,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(normalizedMsg)) !== null) {
        const symptom = match[1].trim().normalize('NFC').toLowerCase();
        if (symptom.length > 2 && symptom.length < 50 && !symptoms.includes(symptom)) {
          symptoms.push(symptom);
        }
      }
    }
    return [...new Set(symptoms)];
  }

  // ==================== LOG SYMPTOMS ====================

  static async logSymptoms(
    userId: string,
    sessionId: string,
    symptoms: string[],
    message: string,
    category?: string
  ): Promise<void> {
    if (!symptoms.length) return;

    const severity = this.detectSeverity(message);

    try {
      const docs = symptoms.map(symptom => ({
        user_id: new mongoose.Types.ObjectId(userId),
        session_id: sessionId,
        symptom: symptom.toLowerCase().trim(),
        severity,
        category,
        timestamp: new Date(),
        notes: message.substring(0, 200),
      }));

      await SymptomLog.insertMany(docs, { ordered: false });
    } catch (error) {
      console.error('Error logging symptoms:', error);
    }
  }

  // ==================== GET TRENDS ====================

  static async getSymptomTrends(
    userId: string,
    days = 30
  ): Promise<SymptomTrend[]> {
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const logs = await SymptomLog.find({
        user_id: new mongoose.Types.ObjectId(userId),
        timestamp: { $gte: since },
      }).sort({ timestamp: 1 });

      // Group by symptom
      const grouped = new Map<string, ISymptomLog[]>();
      for (const log of logs) {
        const key = log.symptom;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(log);
      }

      const trends: SymptomTrend[] = [];

      for (const [symptom, entries] of grouped) {
        const severities = entries.map(e => e.severity);
        const avgSeverity = severities.reduce((a, b) => a + b, 0) / severities.length;

        // Calculate trend: compare first half vs second half severity
        const half = Math.floor(entries.length / 2);
        let trend: SymptomTrend['trend'] = 'stable';

        if (entries.length >= 2 && half > 0) {
          const firstHalf = severities.slice(0, half);
          const secondHalf = severities.slice(half);
          const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
          const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

          if (secondAvg - firstAvg > 0.5) trend = 'worsening';
          else if (firstAvg - secondAvg > 0.5) trend = 'improving';
        } else if (entries.length === 1) {
          trend = 'new';
        }

        trends.push({
          symptom,
          occurrences: entries.length,
          firstSeen: entries[0].timestamp,
          lastSeen: entries[entries.length - 1].timestamp,
          averageSeverity: Math.round(avgSeverity * 10) / 10,
          trend,
          category: entries[0].category,
        });
      }

      return trends.sort((a, b) => b.occurrences - a.occurrences);
    } catch (error) {
      console.error('Error getting symptom trends:', error);
      return [];
    }
  }

  // ==================== GET SUMMARY FOR AI CONTEXT ====================

  static async getContextSummary(userId: string, language: 'en' | 'vi' = 'vi'): Promise<string> {
    const trends = await this.getSymptomTrends(userId, 30);
    if (!trends.length) return '';

    const worsening = trends.filter(t => t.trend === 'worsening');
    const frequent = trends.filter(t => t.occurrences >= 3);

    if (language === 'vi') {
      const parts: string[] = [];
      if (worsening.length) {
        parts.push(`Triệu chứng đang xấu hơn: ${worsening.map(t => t.symptom).join(', ')}`);
      }
      if (frequent.length) {
        parts.push(`Triệu chứng thường gặp (30 ngày qua): ${frequent.map(t => `${t.symptom} (${t.occurrences} lần)`).join(', ')}`);
      }
      return parts.length ? `LỊCH SỬ TRIỆU CHỨNG:\n${parts.join('\n')}` : '';
    } else {
      const parts: string[] = [];
      if (worsening.length) {
        parts.push(`Worsening symptoms: ${worsening.map(t => t.symptom).join(', ')}`);
      }
      if (frequent.length) {
        parts.push(`Frequent symptoms (last 30 days): ${frequent.map(t => `${t.symptom} (${t.occurrences}x)`).join(', ')}`);
      }
      return parts.length ? `SYMPTOM HISTORY:\n${parts.join('\n')}` : '';
    }
  }
}