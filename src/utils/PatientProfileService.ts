import mongoose from 'mongoose';


// ==================== CORE TYPES ====================

export type Language = 'en' | 'vi';
export type MessageRole = 'user' | 'assistant';
export type UrgencyLevel = 'low' | 'medium' | 'high';

// ==================== PATIENT PROFILE ====================

export interface PatientProfile {
  userId: string;
  name?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  bloodType?: string;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  recentDiagnoses: string[];
  emergencyContact?: {
    name: string;
    phone: string;
    relation: string;
  };
}

// ==================== AI MESSAGES ====================

export interface AIMessage {
  role: MessageRole;
  content: string;
  timestamp: Date;
  category?: string;
  language?: Language;
}

export interface AIResponse {
  response: string;
  confidence: number;
  suggestedActions?: string[];
  emergencyAlert?: boolean;
  category?: string;
  relatedSpecialties?: string[];
  language?: Language;
  usedFallback?: boolean;
  provider?: string;
  appointmentRecommendation?: AppointmentSuggestion;
  followUpQuestions?: string[];
  patientContextUsed?: boolean;
  requiresMoreInfo?: boolean;
}

// ==================== APPOINTMENT ====================

export interface AppointmentSuggestion {
  shouldBook: boolean;
  urgencyLevel: UrgencyLevel;
  suggestedSpecialty?: string;
  suggestedSpecialtyId?: string;
  recommendedTimeframe?: string;
  reason?: string;
  symptoms: string[];
  hasExistingAppointment?: boolean;
  suggestedDoctors?: SuggestedDoctor[];
  contraindications?: string[]; // from patient allergies/conditions
}

export interface SuggestedDoctor {
  id: string;
  name: string;
  availableSlots: string[];
  consultationFee?: number;
  experience?: number;
  rating?: number;
}

// ==================== MEDICATION / TERMS ====================

export interface MedicationInfo {
  name: string;
  information: string;
  confidence: number;
  lastUpdated: string;
  warnings?: string[]; // allergy warnings based on patient profile
}

export interface TermExplanation {
  term: string;
  explanation: string;
  confidence: number;
}

export interface LifestyleAdvice {
  topic: string;
  advice: string;
  confidence: number;
  category: string;
}

// ==================== SYMPTOM TRACKING ====================

export interface SymptomEntry {
  symptom: string;
  severity: 1 | 2 | 3 | 4 | 5;
  timestamp: Date;
  sessionId: string;
  notes?: string;
}

export interface SymptomTrend {
  symptom: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  averageSeverity: number;
  trend: 'improving' | 'worsening' | 'stable';
}

// ==================== AUDIT LOG ====================

export interface AuditLogEntry {
  userId: string;
  sessionId: string;
  action: 'chat_message' | 'appointment_booked' | 'emergency_triggered' | 'handoff_requested';
  userMessage?: string;
  aiResponse?: string;
  category?: string;
  urgencyLevel?: UrgencyLevel;
  timestamp: Date;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

// ==================== HANDOFF ====================

export interface HandoffRequest {
  sessionId: string;
  userId: string;
  reason: 'user_requested' | 'ai_insufficient' | 'emergency' | 'complex_case';
  summary: string;
  symptoms: string[];
  urgencyLevel: UrgencyLevel;
  preferredSpecialty?: string;
  timestamp: Date;
}

export class PatientProfileService {
  // Cache: userId → { profile, expiresAt }
  private static cache = new Map<string, { profile: PatientProfile; expiresAt: number }>();
  private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  static async getProfile(userId: string): Promise<PatientProfile | null> {
    // Check cache
    const cached = this.cache.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.profile;
    }

    try {
      // Fetch User model
      const User = mongoose.model('User');
      const user = await User.findById(userId)
        .select('name dateOfBirth gender bloodType')
        .lean() as any;

      if (!user) return null;

      // Calculate age
      let age: number | undefined;
      if (user.dateOfBirth) {
        age = Math.floor((Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      }

      // Try to fetch MedicalRecord if model exists
      let allergies: string[] = [];
      let chronicConditions: string[] = [];
      let currentMedications: string[] = [];
      let recentDiagnoses: string[] = [];

      try {
        const MedicalRecord = mongoose.model('MedicalRecord');
        const records = await MedicalRecord.find({ patient_id: userId })
          .sort({ created_at: -1 })
          .limit(5)
          .lean() as any[];

        for (const record of records) {
          if (record.allergies?.length) allergies.push(...record.allergies);
          if (record.chronic_conditions?.length) chronicConditions.push(...record.chronic_conditions);
          if (record.current_medications?.length) {
            currentMedications.push(...(record.current_medications.map((m: any) =>
              typeof m === 'string' ? m : m.name || m.medication_name || ''
            ).filter(Boolean)));
          }
          if (record.diagnosis) recentDiagnoses.push(record.diagnosis);
        }

        // Deduplicate
        allergies = [...new Set(allergies)];
        chronicConditions = [...new Set(chronicConditions)];
        currentMedications = [...new Set(currentMedications)];
        recentDiagnoses = [...new Set(recentDiagnoses)].slice(0, 5);
      } catch {
        // MedicalRecord model may not exist — graceful fallback
      }

      const profile: PatientProfile = {
        userId,
        name: user.name,
        age,
        gender: user.gender,
        bloodType: user.bloodType,
        allergies,
        chronicConditions,
        currentMedications,
        recentDiagnoses,
      };

      // Cache
      this.cache.set(userId, { profile, expiresAt: Date.now() + this.CACHE_TTL });
      return profile;
    } catch (error) {
      console.error('Error loading patient profile:', error);
      return null;
    }
  }

  static invalidateCache(userId: string): void {
    this.cache.delete(userId);
  }

  // ==================== BUILD CONTEXT BLOCK FOR AI ====================

  static buildContextBlock(profile: PatientProfile, language: 'en' | 'vi'): string {
    const parts: string[] = [];

    if (language === 'vi') {
      parts.push('=== HỒ SƠ BỆNH NHÂN ===');
      if (profile.age) parts.push(`Tuổi: ${profile.age}`);
      if (profile.gender) {
        const genderMap = { male: 'Nam', female: 'Nữ', other: 'Khác' };
        parts.push(`Giới tính: ${genderMap[profile.gender] || profile.gender}`);
      }
      if (profile.bloodType) parts.push(`Nhóm máu: ${profile.bloodType}`);
      if (profile.allergies.length) {
        parts.push(`⚠️ DỊ ỨNG: ${profile.allergies.join(', ')} — TUYỆT ĐỐI KHÔNG gợi ý các chất này`);
      }
      if (profile.chronicConditions.length) {
        parts.push(`Bệnh mãn tính: ${profile.chronicConditions.join(', ')}`);
      }
      if (profile.currentMedications.length) {
        parts.push(`Thuốc đang dùng: ${profile.currentMedications.join(', ')}`);
      }
      if (profile.recentDiagnoses.length) {
        parts.push(`Chẩn đoán gần đây: ${profile.recentDiagnoses.slice(0, 3).join(', ')}`);
      }
      parts.push('QUAN TRỌNG: Cá nhân hóa lời khuyên dựa trên hồ sơ trên. Cảnh báo rõ nếu có tương tác thuốc hoặc chống chỉ định.');
    } else {
      parts.push('=== PATIENT PROFILE ===');
      if (profile.age) parts.push(`Age: ${profile.age}`);
      if (profile.gender) parts.push(`Gender: ${profile.gender}`);
      if (profile.bloodType) parts.push(`Blood type: ${profile.bloodType}`);
      if (profile.allergies.length) {
        parts.push(`⚠️ ALLERGIES: ${profile.allergies.join(', ')} — DO NOT recommend these substances`);
      }
      if (profile.chronicConditions.length) {
        parts.push(`Chronic conditions: ${profile.chronicConditions.join(', ')}`);
      }
      if (profile.currentMedications.length) {
        parts.push(`Current medications: ${profile.currentMedications.join(', ')}`);
      }
      if (profile.recentDiagnoses.length) {
        parts.push(`Recent diagnoses: ${profile.recentDiagnoses.slice(0, 3).join(', ')}`);
      }
      parts.push('IMPORTANT: Personalize advice based on profile above. Clearly warn about drug interactions or contraindications.');
    }

    return parts.join('\n');
  }

  // ==================== CHECK CONTRAINDICATIONS ====================

  static checkContraindications(
    profile: PatientProfile,
    suggestedMedications: string[]
  ): string[] {
    const warnings: string[] = [];

    for (const med of suggestedMedications) {
      const medLower = med.toLowerCase();
      for (const allergy of profile.allergies) {
        if (medLower.includes(allergy.toLowerCase()) || allergy.toLowerCase().includes(medLower)) {
          warnings.push(`⚠️ ${med} — patient is allergic to ${allergy}`);
        }
      }
    }

    return warnings;
  }
}