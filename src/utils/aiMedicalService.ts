import Groq from 'groq-sdk';
import { config } from '../config/config';
import Specialty from '../models/specialty';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Review from '../models/review';
import { PatientProfileService } from './PatientProfileService';
import { auditLogger } from '../middlewares/SecurityMiddleware';
import { fetchDBContext, AIDecision, DBContext } from './AIDecisionEngine';

// ==================== CORE TYPES ====================

export type Language = 'en';
export type MessageRole = 'user' | 'assistant';
export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PatientProfile {
  userId: string;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  recentDiagnoses: string[];
}

export interface AIMessage {
  role: MessageRole;
  content: string;
  timestamp: Date;
  category?: string;
  language: Language;
}

export interface SpecialtyData {
  id: string;
  name: string;
  keywords: string[];
  category: string;
  icon?: string;
  color?: string;
  relatedSpecialties: string[];
}

export interface AppointmentSuggestion {
  shouldBook: boolean;
  urgencyLevel: UrgencyLevel;
  suggestedSpecialty?: string;
  suggestedSpecialtyId?: string;
  recommendedTimeframe?: string;
  reason?: string;
  symptoms?: string[];
  suggestedDoctors?: Array<{
    id: string;
    name: string;
    availableSlots: string[];
    consultationFee: number;
    experience: number;
    rating: number;
  }>;
  awaitingBookingConfirmation?: boolean;
  bookingQuestion?: string;
  bookingMessage?: string;
  hasExistingAppointment?: boolean;
  existingAppointmentDetails?: {
    date: string;
    time: string;
    doctorName: string;
    specialty: string;
  };
  emergencyInstructions?: string;
}

export interface AIResponse {
  response: string;
  confidence: number;
  suggestedActions?: string[];
  emergencyAlert: boolean;
  category?: string;
  relatedSpecialties?: string[];
  language: Language;
  usedFallback?: boolean;
  provider: string;
  appointmentRecommendation?: AppointmentSuggestion;
  patientContextUsed?: boolean;
  urgencyLevel?: UrgencyLevel;
  triageScore?: number;
  shouldAskBookingConfirmation?: boolean;
  requiresMoreInfo?: boolean;
  userIntent?: string;
  followUpNeeded?: boolean;
  estimatedWaitDays?: number;
  followUpQuestions?: string[];
}

export interface MedicationInfo {
  name: string;
  information: string;
  confidence: number;
  lastUpdated: string;
  warnings: string[];
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

export interface AuditLogEntry {
  userId?: string;
  action: string;
  userMessage?: string;
  aiResponse?: string;
  category?: string;
  urgencyLevel?: string;
  emergencyAlert?: boolean;
  appointmentBooked?: boolean;
  timestamp: Date;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

// ==================== ASSESSMENT PHASE ====================

export type AssessmentPhase = 'idle' | 'complete';

export interface AssessmentSession {
  userId: string;
  phase: AssessmentPhase;
  startTime: Date;
  lastUpdate: Date;
  collectedSymptoms: string[];
  suggestedSpecialtyId?: string;
}

export type EmergencyProtocol =
  | 'cardiac_emergency'
  | 'stroke_emergency'
  | 'respiratory_emergency'
  | 'psychiatric_emergency'
  | 'pediatric_emergency'
  | 'general_emergency';

// ==================== CONSTANTS ====================

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_OUTPUT_TOKENS = 1024;
const MAX_REQUESTS_PER_MINUTE = 20;
const MAX_HISTORY_LENGTH = 12;
const QUOTA_COOLDOWN_MS = 60000;
const LANGUAGE_CACHE_MAX_SIZE = 1000;
const SPECIALTY_CACHE_TTL = 3600000; // 1 hour
const ALL_TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '13:30', '14:00', '14:30', '15:00',
  '15:30', '16:00', '16:30', '17:00'
];

type FallbackKey = 'emergency' | 'cardiology' | 'medications' | 'general';
const FALLBACK_RESPONSES: Record<FallbackKey, string> = {
  emergency: `🚨 EMERGENCY detected! Contact family now and seek help immediately!`,
  cardiology: `⚠️ Cardiovascular symptoms detected. Please consult a cardiologist immediately.`,
  medications: `💊 Consult a pharmacist or doctor about medications.\n\n⚕️ Educational purposes only.`,
  general: `Thank you for sharing. Please consult a doctor for a professional evaluation.`
};

const EMERGENCY_PROTOCOLS: Record<string, string> = {
  cardiac_emergency: `🚨 **CRITICAL: CARDIAC EMERGENCY**\n1. Call 911/115 IMMEDIATELY!\n2. Keep patient calm and sitting.\n3. Do not give food or drink.\n🏥 GO TO NEAREST HOSPITAL NOW.`,
  stroke_emergency: `🚨 **CRITICAL: STROKE EMERGENCY**\n1. Call 911/115 IMMEDIATELY!\n2. Note the time symptoms started.\n3. Do not allow patient to sleep.\n🏥 GO TO NEAREST EMERGENCY ROOM.`,
  respiratory_emergency: `🚨 **CRITICAL: RESPIRATORY EMERGENCY**\n1. Call 911/115 IMMEDIATELY!\n2. Help patient sit upright.\n3. Assist with inhaler if available.\n🏥 SEEK URGENT MEDICAL CARE.`,
  psychiatric_emergency: `🚨 **CRITICAL: PSYCHIATRIC EMERGENCY**\n1. Call 911/115 hay Hotline 0243.212.3131.\n2. Do not leave the person alone.\n3. Remove any dangerous objects.\n🏥 SEEK IMMEDIATE MENTAL HEALTH SUPPORT.`,
  pediatric_emergency: `🚨 **CRITICAL: PEDIATRIC EMERGENCY**\n1. Call 911/115 IMMEDIATELY!\n2. Seek pediatric ER.\n🏥 TAKE CHILD TO ER NOW.`,
  general_emergency: `🚨 **CRITICAL: EMERGENCY**\n1. Call 911/115 IMMEDIATELY!\n🏥 GO TO NEAREST HOSPITAL.`,
};

const BOOKING_CONFIRM = ['yes', 'confirm', 'agree', 'correct', 'book', 'close', 'schedule', 'ok', 'okay', 'sure', 'let\'s do it', 'sounds good', 'go ahead', 'do it', 'please do', 'i want to book'];

const BOOKING_DECLINE = ['no', 'cancel', 'reject', 'water', 'later', 'not now', 'don\'t', 'do not', 'nope', 'negative', 'decline', 'refuse', 'deny', 'disagree', 'reschedule'];

const BOOKING_INQUIRY = ['appointment', 'coming soon', 'schedule', 'upcoming', 'next week', 'next month'];

// ==================== CUSTOM ERRORS ====================

class QuotaExceededError extends Error {
  constructor() {
    super('QUOTA_EXCEEDED');
    this.name = 'QuotaExceededError';
  }
}
class EmptyMessageError extends Error {
  constructor() {
    super('Empty message');
    this.name = 'EmptyMessageError';
  }
}

// ==================== SPECIALTY MANAGER ====================

class SpecialtyManager {
  private specialties: Map<string, SpecialtyData> = new Map();
  private categoryToSpecialtyIds: Map<string, string[]> = new Map();
  private lastFetchTime = 0;
  private fetchPromise: Promise<void> | null = null;

  async loadSpecialties(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastFetchTime < SPECIALTY_CACHE_TTL) return;
    if (this.fetchPromise) return this.fetchPromise;
    this.fetchPromise = this.fetchFromDB();
    try {
      await this.fetchPromise;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async fetchFromDB(): Promise<void> {
    try {
      const specialties = await Specialty.find({ isActive: true })
        .select('_id name description icon color keywords category')
        .lean();

      this.specialties.clear();
      this.categoryToSpecialtyIds.clear();

      for (const spec of specialties) {
        const dbKeywords: string[] = Array.isArray(spec.keywords) ? spec.keywords : [];
        const autoKeywords = [
          spec.name.normalize('NFC').toLowerCase(),
          ...spec.name.normalize('NFC').toLowerCase().split(/\s+/),
          ...(spec.description?.normalize('NFC').toLowerCase().split(/\s+/) || []),
        ].filter(k => k.length > 2);

        const keywords = [...new Set([...dbKeywords, ...autoKeywords])];
        const category = (spec as any).category || 'Other';

        const data: SpecialtyData = {
          id: spec._id.toString(),
          name: spec.name,
          keywords,
          category,
          icon: spec.icon,
          color: spec.color,
          relatedSpecialties: [],
        };
        this.specialties.set(data.id, data);

        if (!this.categoryToSpecialtyIds.has(category)) {
          this.categoryToSpecialtyIds.set(category, []);
        }
        this.categoryToSpecialtyIds.get(category)!.push(data.id);
      }

      for (const [, ids] of this.categoryToSpecialtyIds) {
        for (const id of ids) {
          const s = this.specialties.get(id);
          if (s) s.relatedSpecialties = ids.filter(i => i !== id);
        }
      }

      this.lastFetchTime = Date.now();
    } catch (error) {
      console.error('Error loading specialties:', error);
      throw error;
    }
  }

  async detectCategory(message: string): Promise<{ category: string; specialtyId?: string }> {
    return { category: 'general', specialtyId: undefined };
  }

  async getSpecialtyById(id: string): Promise<SpecialtyData | undefined> {
    await this.loadSpecialties();
    return this.specialties.get(id);
  }

  async findByName(name: string): Promise<SpecialtyData | undefined> {
    await this.loadSpecialties();
    const normalizedName = name.normalize('NFC').toLowerCase();
    for (const spec of this.specialties.values()) {
      if (
        spec.name.normalize('NFC').toLowerCase().includes(normalizedName) ||
        normalizedName.includes(spec.name.normalize('NFC').toLowerCase())
      ) {
        return spec;
      }
    }
    return undefined;
  }

  async getAllSpecialties(): Promise<SpecialtyData[]> {
    await this.loadSpecialties();
    return Array.from(this.specialties.values());
  }

  async getAllCategories(): Promise<string[]> {
    await this.loadSpecialties();
    return [...this.categoryToSpecialtyIds.keys()];
  }

  async getRelatedSpecialties(specialtyId: string): Promise<string[]> {
    await this.loadSpecialties();
    return this.specialties.get(specialtyId)?.relatedSpecialties || [];
  }

  async getSpecialtyContext(specialtyId?: string, language: Language = 'en'): Promise<string> {
    if (!specialtyId) {
      return 'Specialty: GENERAL MEDICINE. Provide comprehensive medical information.';
    }
    const spec = await this.getSpecialtyById(specialtyId);
    if (!spec) return 'Specialty: GENERAL MEDICINE';
    return `Specialty: ${spec.name.toUpperCase()}. Providing information about ${spec.name.toLowerCase()}.`;
  }
}

// ==================== MAIN SERVICE CLASS ====================

export class AIMedicalService {
  private readonly groq: Groq;
  private conversationHistory: AIMessage[] = [];
  private readonly specialtyManager: SpecialtyManager;
  private readonly languageCache = new Map<string, Language>();
  private requestCount = 0;
  private requestResetTime: number = Date.now() + 60_000;
  private quotaExceededUntil: number | null = null;
  private patientProfile: PatientProfile | null = null;

  private assessmentSession: AssessmentSession | null = null;
  private accumulatedSymptomText = '';

  private bookingSuggested = false;
  private bookingConfirmed = false;
  private bookingDeclined = false;
  private lastAssessedUrgency: UrgencyLevel = 'low';
  private bookingInquiryDetected = false;

  constructor() {
    if (!config.groqApiKey) throw new Error('Groq API key is required.');
    this.groq = new Groq({ apiKey: config.groqApiKey });
    this.specialtyManager = new SpecialtyManager();
  }

  // ==================== PUBLIC: HISTORY ====================

  public loadHistoryFromDB(
    messages: Array<{
      role: MessageRole;
      content: string;
      timestamp: Date;
      category?: string;
      language?: string;
    }>
  ): void {
    this.conversationHistory = [];
    const recent = messages.slice(-MAX_HISTORY_LENGTH);
    for (const msg of recent) {
      this.conversationHistory.push({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        category: msg.category,
        language: (msg.language as Language) || 'en',
      });
    }
  }

  public addMessageToHistory(msg: AIMessage): void {
    this.addToHistory(msg);
  }

  public async loadPatientProfile(userId: string): Promise<void> {
    this.patientProfile = await PatientProfileService.getProfile(userId);
  }

  // ==================== RATE LIMITING ====================

  private isRateLimited(): boolean {
    const now = Date.now();
    if (now > this.requestResetTime) {
      this.requestCount = 0;
      this.requestResetTime = now + 60_000;
    }
    return this.requestCount >= MAX_REQUESTS_PER_MINUTE;
  }

  private recordRequest(): void {
    this.requestCount++;
  }

  private isQuotaExceeded(): boolean {
    if (!this.quotaExceededUntil) return false;
    if (Date.now() > this.quotaExceededUntil) {
      this.quotaExceededUntil = null;
      return false;
    }
    return true;
  }

  private markQuotaExceeded(): void {
    this.quotaExceededUntil = Date.now() + QUOTA_COOLDOWN_MS;
    console.warn('⚠️ Groq rate limit hit. Circuit breaker active.');
  }

  // ==================== LANGUAGE DETECTION ====================

  private detectLanguage(message: string): Language {
    return 'en';
  }

  private setCachedLang(msg: string, lang: Language): Language {
    if (this.languageCache.size >= LANGUAGE_CACHE_MAX_SIZE) this.languageCache.clear();
    this.languageCache.set(msg, lang);
    return lang;
  }

  // ==================== BOOKING INTENT DETECTION ====================

  private detectBookingIntent(message: string): 'confirm' | 'decline' | 'inquiry' | 'neutral' {
    const lower = message.normalize('NFC').toLowerCase().trim();
    if (BOOKING_INQUIRY.some(kw => lower.includes(kw))) return 'inquiry';
    if (BOOKING_DECLINE.some(kw => lower === kw || lower.includes(kw))) return 'decline';
    if (BOOKING_CONFIRM.some(kw => lower === kw || lower.includes(kw))) return 'confirm';
    return 'neutral';
  }

  // ==================== HANDLE BOOKING INQUIRY ====================

  private async handleBookingInquiry(userId?: string, language: Language = 'en'): Promise<AIResponse | null> {
    if (!userId) return null;
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const upcomingAppointments = await Appointment.find({
        user_id: userId,
        appointment_date: { $gte: startOfToday },
        status: { $in: ['pending', 'confirmed'] },
      })
        .populate('doctor_id', 'name')
        .populate('specialty_id', 'name')
        .sort({ appointment_date: 1 })
        .limit(5);

      if (upcomingAppointments.length === 0) {
        // Fallback: check for recent past appointments to provide context
        const recentPast = await Appointment.find({
          user_id: userId,
          appointment_date: { $lt: startOfToday }
        })
          .populate('doctor_id', 'name')
          .populate('specialty_id', 'name')
          .sort({ appointment_date: -1 })
          .limit(3);

        let response = 'You don\'t have any upcoming appointments.';
        if (recentPast.length > 0) {
          const pastList = recentPast.map(apt => {
            const date = new Date(apt.appointment_date).toLocaleDateString('en-US');
            return `- ${date}: Dr. ${(apt as any).doctor_id?.name || 'Doctor'} (${(apt as any).specialty_id?.name || 'Specialty'})`;
          }).join('\n');
          response += ` However, I see your most recent appointments were:\n${pastList}\n\nWould you like me to help you book a new one?`;
        } else {
          response += ' Would you like me to help you book one?';
        }

        return {
          response,
          confidence: 0.95,
          category: 'booking_inquiry',
          language,
          shouldAskBookingConfirmation: true,
          appointmentRecommendation: {
            shouldBook: false,
            urgencyLevel: 'low',
            symptoms: [],
            awaitingBookingConfirmation: true,
            bookingQuestion: 'Would you like to book an appointment?',
          },
          emergencyAlert: false,
          provider: 'local',
          followUpNeeded: true
        };
      }
      const doctorIds = upcomingAppointments.map(apt => (apt as any).doctor_id?._id || apt.doctor_id);
      const doctorDocs = await Doctor.find({ _id: { $in: doctorIds } })
        .populate('user_id', 'name')
        .lean();

      const doctorNameMap = new Map<string, string>();
      for (const doc of doctorDocs) {
        const name = (doc.user_id as any)?.name;
        if (name) doctorNameMap.set((doc._id as any).toString(), name);
      }

      const appointmentList = upcomingAppointments.map((apt, index) => {
        const doctorId = ((apt as any).doctor_id?._id || apt.doctor_id)?.toString();
        const doctorName = doctorNameMap.get(doctorId) || 'Doctor';
        const specialtyName = (apt as any).specialty_id?.name || 'Specialty';
        const date = new Date(apt.appointment_date).toLocaleDateString('en-US');
        return `${index + 1}. 📅 ${date} at ${apt.time_slot} - ${specialtyName} (Dr. ${doctorName})`;
      }).join('\n');
      return {
        response: `You have ${upcomingAppointments.length} upcoming appointments:\n\n${appointmentList}\n\nDo you need any other assistance?`,
        confidence: 0.95,
        category: 'booking_inquiry',
        language,
        emergencyAlert: false,
        provider: 'local',
        appointmentRecommendation: {
          shouldBook: false,
          urgencyLevel: 'low',
          symptoms: [],
          hasExistingAppointment: true,
        },
      };
    } catch (error) {
      console.error('Error handling booking inquiry:', error);
      return null;
    }
  }

  // ==================== DOCTOR AVAILABILITY ====================

private async findAvailableDoctors(
  specialtyId: string,
  targetDate: Date,
  limit = 3
): Promise<AppointmentSuggestion['suggestedDoctors']> {
  try {
    const doctors = await Doctor.find({ specialty_id: specialtyId, isAvailable: true })
      .populate('user_id', 'name');

    if (!doctors.length) return [];

    const docIds = doctors.map(d => d._id);
    const appointments = await Appointment.find({
      doctor_id: { $in: docIds },
      appointment_date: targetDate,
      status: { $in: ['pending', 'confirmed', 'completed'] },
    }).select('doctor_id time_slot');

    const reviews = await Review.find({ doctor_id: { $in: docIds } });
    const ratingMap = new Map<string, number>();
    docIds.forEach(id => {
      const r = reviews.filter(rev => rev.doctor_id.toString() === id);
      const avg = r.length ? r.reduce((sum, rev) => sum + rev.rating, 0) / r.length : 0;
      ratingMap.set(id, avg);
    });

    const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const result: any[] = [];

    for (const doctor of doctors) {
      if (result.length >= limit) break;
      const docId = (doctor._id as any).toString();
      const bookedSlots = new Set(
        appointments.filter(a => a.doctor_id.toString() === docId).map(a => a.time_slot)
      );

      let slotsForDay: string[] = [];
      const daySchedule = (doctor.available_hours as any)?.[dayOfWeek];
      if (daySchedule && daySchedule.isAvailable !== false && daySchedule.start && daySchedule.end) {
        slotsForDay = ALL_TIME_SLOTS.filter(s => s >= daySchedule.start && s <= daySchedule.end);
      }

      const availableSlots = slotsForDay.filter(s => !bookedSlots.has(s));
      if (availableSlots.length > 0) {
        const doctorName = (doctor as any).user_id?.name;
        if (!doctorName) continue;

        result.push({
          id: docId,
          name: doctorName,
          availableSlots: availableSlots.slice(0, 3),
          consultationFee: doctor.consultation_fee,
          experience: doctor.years_of_experience,
          rating: ratingMap.get(docId) ?? 0,
        });
      }
    }
    return result.sort((a, b) => b.rating - a.rating);
  } catch (error) {
    console.error('Error finding available doctors:', error);
    return [];
  }
}

  public async findAvailableDoctorsForDate(specialtyId: string, targetDate: Date, limit = 3) {
    return this.findAvailableDoctors(specialtyId, targetDate, limit);
  }

  // ==================== SYSTEM PROMPT ====================

  private buildSystemPrompt(): string {
    return `You are an expert AI Medical Diagnostic Assistant. Your role is to perform clinical triage and provide empathetic guidance.

══════════════════════════════════════════
CLINICAL TRIAGE GUIDELINES:
══════════════════════════════════════════
🔴 CRITICAL (Score 90-100): Cardiac arrest, profuse bleeding, stroke symptoms, severe chest pain.
   - Action: EMERGENCY ONLY.
🟠 HIGH (Score 70-89): Fever > 39°C, acute respiratory distress, severe abdominal pain.
   - Action: Urgent appointment (24h).
🟡 MEDIUM (Score 40-69): Persistent pain, high blood sugar, chronic fatigue.
   - Action: Appointment 2-3 days.
🟢 LOW (Score < 40): Mild cough, cold, routine checkup.
   - Action: Routine checkup.

══════════════════════════════════════════
INTENT CLASSIFICATION:
══════════════════════════════════════════
Classify into: "greeting", "small_talk", "symptom_report", "confirm_booking", "decline_booking", "appointment_inquiry", "appointment_reschedule", "appointment_cancel", "general_health_info", "medication_inquiry", "emergency_report".

══════════════════════════════════════════
SAFETY RULES:
══════════════════════════════════════════
1. Always recommend consulting a human doctor.
2. Provide emergency instructions if critical.
3. Max 300 words. Respond 100% in ENGLISH.`;
  }

  // ==================== AI CORE = : tryGenerate ====================

  private async tryGenerate(prompt: string, category: string, language: Language) {
    if (this.isRateLimited()) return { text: this.getFallbackText(category, language), usedFallback: true };
    this.recordRequest();
    try {
      const response = await this.groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: this.buildSystemPrompt() },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: MAX_OUTPUT_TOKENS,
      });
      return { text: response.choices[0]?.message?.content || '', usedFallback: false };
    } catch (err: any) {
      if (err?.status === 429) this.markQuotaExceeded();
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }
  }

  private getFallbackText(category: string, language: Language): string {
    return FALLBACK_RESPONSES[category as FallbackKey] || FALLBACK_RESPONSES.general;
  }

  // ==================== MESSAGE PROCESSING ====================

  public async processMessage(userMessage: string, userId?: string): Promise<AIResponse> {
    try {
      if (userId && !this.patientProfile) await this.loadPatientProfile(userId);
      this.accumulatedSymptomText += ' ' + userMessage;
      const language = this.detectLanguage(userMessage);
      this.addToHistory({ role: 'user', content: userMessage, timestamp: new Date(), language });

      const dbContext = await fetchDBContext(userId);
      const conversationText = this.serializeHistory();
      const combinedPrompt = this.buildCombinedPrompt(userMessage, conversationText, dbContext, language, 'neutral');

      const { text: rawResponse, usedFallback } = await this.tryGenerate(combinedPrompt, 'medical', language);
      const { aiDecision, responseText } = this.parseAIOutput(rawResponse, dbContext, language);

      if (aiDecision.userIntent === 'appointment_inquiry') {
        const inquiryRes = await this.handleBookingInquiry(userId, language);
        if (inquiryRes) {
          this.addToHistory({ role: 'assistant', content: inquiryRes.response, timestamp: new Date(), language });
          return inquiryRes;
        }
      }

      if (aiDecision.requiresEmergency || aiDecision.userIntent === 'emergency_report') {
        const protocol = this.mapToEmergencyProtocol(aiDecision.redFlags);
        return this.buildEmergencyResponse(protocol, language);
      }

      const bookingIntent = this.mapUserIntentToBookingIntent(aiDecision.userIntent);
      const appointmentRecommendation = this.buildSuggestionFromAIDecision(aiDecision, dbContext, bookingIntent, language);

      this.addToHistory({ role: 'assistant', content: responseText, timestamp: new Date(), language, category: aiDecision.recommendedSpecialtyName });

      auditLogger.log({
        userId, action: 'chat_message', userMessage,
        aiResponse: responseText.substring(0, 500),
        category: aiDecision.recommendedSpecialtyName,
        urgencyLevel: aiDecision.urgencyLevel,
        timestamp: new Date(),
      });

      return {
        response: responseText,
        confidence: usedFallback ? 0.5 : 0.88,
        emergencyAlert: false,
        category: aiDecision.recommendedSpecialtyName,
        language,
        usedFallback,
        provider: 'groq',
        appointmentRecommendation,
        urgencyLevel: aiDecision.urgencyLevel,
        triageScore: aiDecision.triageScore,
        userIntent: aiDecision.userIntent,
      };
    } catch (error) {
      console.error('❌ processMessage error:', error);
      return this.buildErrorResponse('en');
    }
  }

  private buildCombinedPrompt(userMessage: string, conversationText: string, dbContext: DBContext, language: Language, bookingIntent: string): string {
    const doctorsList = dbContext.availableDoctors.slice(0, 10).map(d => `- ID:${d.id} | ${d.name} | ${d.specialtyName}`).join('\n');
    const specialtiesList = dbContext.availableSpecialties.map(s => `- ID:${s.id} | ${s.name}`).join('\n');

    return `You are an AI doctor. Dual task: (1) classify intent + clinical analysis → JSON decision, (2) write a natural patient reply.

─── CONVERSATION HISTORY ───
${conversationText.slice(-2000)}

─── LATEST MESSAGE ───
${userMessage}

─── DATABASE ───
SPECIALTIES:
${specialtiesList}
DOCTORS:
${doctorsList}

OUTPUT FORMAT:
PART 1 — JSON (one line):
{"urgencyLevel":"low|medium|high|critical","triageScore":0-100,"requiresEmergency":false,"shouldBook":false,"reasoning":"brief","recommendedSpecialtyId":"ID","recommendedSpecialtyName":"name","recommendedDoctorId":"ID","recommendedDoctorName":"name","userIntent":"..."}

---RESPONSE---
PART 2 — Natural reply in ENGLISH.`;
  }

  private parseAIOutput(rawOutput: string, dbContext: DBContext, language: Language) {
    const SEPARATOR = '---RESPONSE---';
    let aiDecision: AIDecision;
    let responseText: string;

    // 1. Try splitting by separator
    if (rawOutput.includes(SEPARATOR)) {
      const parts = rawOutput.split(SEPARATOR);
      try {
        const jsonMatch = parts[0].match(/\{[\s\S]*\}/);
        aiDecision = jsonMatch ? this.sanitizeAIDecision(JSON.parse(jsonMatch[0]), dbContext) : this.getDefaultDecision(language);
        responseText = parts[1].trim();
      } catch {
        aiDecision = this.getDefaultDecision(language);
        responseText = parts[1].trim();
      }
    } else {
      // 2. Robust fallback: find the JSON block and the rest
      try {
        const jsonMatch = rawOutput.match(/\{[\s\S]*?\}(?:\s*|$)/); // Non-greedy match for first JSON object
        if (jsonMatch) {
          aiDecision = this.sanitizeAIDecision(JSON.parse(jsonMatch[0]), dbContext);
          // Take everything AFTER the JSON block
          responseText = rawOutput.substring(jsonMatch.index! + jsonMatch[0].length).trim();
        } else {
          aiDecision = this.getDefaultDecision(language);
          responseText = rawOutput;
        }
      } catch {
        aiDecision = this.getDefaultDecision(language);
        responseText = rawOutput;
      }
    }

    // Clean up any remaining artifacts or headers
    responseText = responseText
      .replace(/^PART 2\s*[—:-]*\s*/i, '')
      .replace(/^Natural reply\s*[—:-]*\s*/i, '')
      .trim();

    return { aiDecision, responseText };
  }

  private sanitizeAIDecision(decision: any, dbContext: DBContext): AIDecision {
    const specialty = dbContext.availableSpecialties.find(s => s.id === decision.recommendedSpecialtyId);
    const doctor = dbContext.availableDoctors.find(d => d.id === decision.recommendedDoctorId);
    return {
      urgencyLevel: decision.urgencyLevel || 'medium',
      triageScore: Number(decision.triageScore) || 0,
      shouldBook: Boolean(decision.shouldBook),
      reasoning: String(decision.reasoning || ''),
      recommendedSpecialtyId: specialty?.id,
      recommendedSpecialtyName: specialty?.name || decision.recommendedSpecialtyName,
      recommendedDoctorId: doctor?.id,
      recommendedDoctorName: doctor?.name,
      redFlags: Array.isArray(decision.redFlags) ? decision.redFlags : [],
      requiresEmergency: Boolean(decision.requiresEmergency),
      userIntent: decision.userIntent || 'symptom_report',
      followUpNeeded: Boolean(decision.followUpNeeded ?? true),
      estimatedWaitDays: Number(decision.estimatedWaitDays) || 3,
    };
  }

  private mapToEmergencyProtocol(redFlags: string[]): EmergencyProtocol {
    return 'general_emergency';
  }

  private mapUserIntentToBookingIntent(userIntent?: string): 'confirm' | 'decline' | 'inquiry' | 'neutral' {
    if (userIntent === 'confirm_booking') return 'confirm';
    if (userIntent === 'decline_booking') return 'decline';
    if (userIntent === 'appointment_inquiry') return 'inquiry';
    return 'neutral';
  }

  private buildSuggestionFromAIDecision(decision: AIDecision, dbContext: DBContext, bookingIntent: string, language: Language): AppointmentSuggestion {
    let suggestedDoctors = [...dbContext.availableDoctors];

    // 1. Filter by specialty if recommended
    if (decision.recommendedSpecialtyId) {
      const specialtyDocs = suggestedDoctors.filter(d => d.specialtyId === decision.recommendedSpecialtyId);
      if (specialtyDocs.length > 0) {
        suggestedDoctors = specialtyDocs;
      }
    }

    // 2. Prioritize the specific recommended doctor if they exist in our available list
    if (decision.recommendedDoctorId) {
      const recDoc = dbContext.availableDoctors.find(d => d.id === decision.recommendedDoctorId);
      if (recDoc) {
        // Move to the very top
        suggestedDoctors = [recDoc, ...suggestedDoctors.filter(d => d.id !== recDoc.id)];
      }
    }

    return {
      shouldBook: decision.shouldBook,
      urgencyLevel: decision.urgencyLevel as UrgencyLevel,
      suggestedSpecialty: decision.recommendedSpecialtyName,
      suggestedSpecialtyId: decision.recommendedSpecialtyId,
      reason: decision.reasoning,
      symptoms: [],
      suggestedDoctors: suggestedDoctors.slice(0, 3).map(d => ({
        id: d.id,
        name: d.name,
        availableSlots: d.availableSlots,
        consultationFee: d.consultationFee,
        experience: d.experience,
        rating: d.rating
      })),
      awaitingBookingConfirmation: decision.userIntent === 'symptom_report' && decision.shouldBook,
      bookingQuestion: decision.userIntent === 'symptom_report' && decision.shouldBook
        ? (language === 'en' ? 'Would you like to book an appointment with a specialist?' : 'You want to book an appointment with a specialist?')
        : undefined
    };
  }

  private getDefaultDecision(language: Language): AIDecision {
    return {
      urgencyLevel: 'medium',
      triageScore: 50,
      shouldBook: false,
      reasoning: 'Needs review.',
      redFlags: [],
      requiresEmergency: false,
      userIntent: 'symptom_report',
      followUpNeeded: true,
      estimatedWaitDays: 3
    };
  }

  private buildEmergencyResponse(protocol: EmergencyProtocol, language: Language): AIResponse {
    return { response: EMERGENCY_PROTOCOLS[protocol] || EMERGENCY_PROTOCOLS.general_emergency, confidence: 1.0, emergencyAlert: true, category: 'emergency', language, provider: 'local', urgencyLevel: 'critical', triageScore: 100 };
  }

  private buildErrorResponse(language: Language): AIResponse {
    return {
      response: 'Technical error. Please try again later.',
      confidence: 0,
      emergencyAlert: false,
      language,
      provider: 'local',
      urgencyLevel: 'medium',
      triageScore: 0,
      userIntent: 'symptom_report'
    };
  }

  private addToHistory(message: AIMessage): void {
    this.conversationHistory.push(message);
    if (this.conversationHistory.length > MAX_HISTORY_LENGTH) this.conversationHistory.shift();
  }

  private serializeHistory(): string {
    return this.conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n');
  }

  public async getMedicationInfo(medicationName: string, userId?: string): Promise<MedicationInfo> {
    const { text } = await this.tryGenerate(`Info about: ${medicationName}`, 'medications', 'en');
    return { name: medicationName, information: text, confidence: 0.8, lastUpdated: new Date().toISOString(), warnings: [] };
  }

  public async explainMedicalTerm(term: string): Promise<TermExplanation> {
    const { text } = await this.tryGenerate(`Explain: ${term}`, 'general', 'en');
    return { term, explanation: text, confidence: 0.8 };
  }

  public async getLifestyleAdvice(topic: string): Promise<LifestyleAdvice> {
    const { text } = await this.tryGenerate(`Advice for: ${topic}`, 'lifestyle', 'en');
    return { topic, advice: text, confidence: 0.8, category: 'lifestyle' };
  }

  public clearHistory(): void {
    this.conversationHistory = [];
  }

  public getHistory(): AIMessage[] {
    return [...this.conversationHistory];
  }

  public getLastDetectedLanguage(): Language | null {
    return this.conversationHistory.at(-1)?.language || null;
  }

  public getAssessmentState() { return { active: false, phase: 'idle' }; }
  public getRateLimitStatus() { return { remaining: MAX_REQUESTS_PER_MINUTE - this.requestCount, provider: 'groq', model: GROQ_MODEL }; }
  public async getAllSpecialties() { return this.specialtyManager.getAllSpecialties(); }
  public async getAllCategories(): Promise<string[]> { return this.specialtyManager.getAllCategories(); }
  public async getSpecialtyById(id: string) { return this.specialtyManager.getSpecialtyById(id); }
  public async refreshSpecialties(): Promise<void> { await this.specialtyManager.loadSpecialties(true); }
}

// ==================== SESSION MANAGER ====================

const serviceInstances = new Map<string, AIMedicalService>();
const serviceLastUsed = new Map<string, number>();
const SERVICE_IDLE_TIMEOUT = 30 * 60 * 1000;
const MAX_SESSIONS = 500;

export function getServiceForSession(sessionId: string): AIMedicalService {
  if (!serviceInstances.has(sessionId)) {
    if (serviceInstances.size >= MAX_SESSIONS) {
      let oldestId = '';
      let oldestTime = Infinity;
      for (const [id, time] of serviceLastUsed) { if (time < oldestTime) { oldestTime = time; oldestId = id; } }
      if (oldestId) { serviceInstances.delete(oldestId); serviceLastUsed.delete(oldestId); }
    }
    serviceInstances.set(sessionId, new AIMedicalService());
  }
  serviceLastUsed.set(sessionId, Date.now());
  return serviceInstances.get(sessionId)!;
}

export function cleanupServiceForSession(sessionId: string): void {
  serviceInstances.delete(sessionId);
  serviceLastUsed.delete(sessionId);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, lastUsed] of serviceLastUsed) {
    if (now - lastUsed > SERVICE_IDLE_TIMEOUT) {
      serviceInstances.delete(id);
      serviceLastUsed.delete(id);
    }
  }
}, 15 * 60 * 1000);

export function stopSessionCleanup(): void {
  // Not implemented but exported for consistency
}
