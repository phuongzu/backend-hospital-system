import Groq from 'groq-sdk';
import { config } from '../config/config';
import Specialty from '../models/specialty';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Review from '../models/review';

// ==================== TYPES ====================

export type Language = 'en' | 'vi';
export type MessageRole = 'user' | 'assistant';
export type MedicalCategory =
  | 'cardiology'
  | 'dermatology'
  | 'neurology'
  | 'pediatrics'
  | 'orthopedics'
  | 'ophthalmology'
  | 'medications'
  | 'emergency'
  | 'general';

export interface AIMessage {
  role: MessageRole;
  content: string;
  timestamp: Date;
  category?: MedicalCategory;
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
}

export interface MedicationInfo {
  name: string;
  information: string;
  confidence: number;
  lastUpdated: string;
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

export interface AppointmentSuggestion {
  shouldBook: boolean;
  urgencyLevel: 'low' | 'medium' | 'high';
  suggestedSpecialty?: string;
  suggestedSpecialtyId?: string;
  recommendedTimeframe?: string;
  reason?: string;
  symptoms: string[];
  suggestedDoctors?: Array<{
    id: string;
    name: string;
    availableSlots: string[];
    consultationFee?: number;
    experience?: number;
    rating?: number;
  }>;
}

// ==================== CUSTOM ERRORS ====================

class QuotaExceededError extends Error {
  constructor() {
    super('QUOTA_EXCEEDED');
    this.name = 'QuotaExceededError';
  }
}

class EmptyMessageError extends Error {
  constructor() {
    super('Empty message provided');
    this.name = 'EmptyMessageError';
  }
}

// ==================== CONSTANTS ====================

const MAX_HISTORY_LENGTH = 6;
const MAX_REQUESTS_PER_MINUTE = 25;
const LANGUAGE_CACHE_MAX_SIZE = 100;
const CATEGORY_CACHE_MAX_SIZE = 100;
const QUOTA_COOLDOWN_MS = 3 * 60 * 1000;
const SPECIALTY_CACHE_TTL = 5 * 60 * 1000;

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_OUTPUT_TOKENS = 700; // tăng lên để đủ chỗ cho booking block

// ==================== DETECTION PATTERNS ====================

const VIETNAMESE_CHAR_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const VIETNAMESE_KEYWORDS = [
  'tôi', 'bạn', 'của', 'và', 'có', 'là', 'trong', 'cho', 'với', 'không',
  'bị', 'đau', 'thuốc', 'bệnh', 'khám', 'bác sĩ', 'bệnh viện',
  'điều trị', 'triệu chứng', 'làm sao', 'như thế nào', 'tại sao',
  'khi nào', 'ở đâu', 'sức khỏe', 'xét nghiệm', 'uống thuốc',
];

const ENGLISH_KEYWORDS = [
  'what', 'how', 'when', 'where', 'why', 'who', 'which', 'can', 'could',
  'would', 'should', 'pain', 'disease', 'treatment', 'symptom',
  'doctor', 'hospital', 'medicine', 'medication', 'test', 'diagnosis',
  'health', 'feel', 'taking', 'blood', 'heart', 'skin',
];

const CATEGORY_KEYWORDS: Record<MedicalCategory, string[]> = {
  cardiology: [
    'heart', 'cardio', 'huyết áp', 'tim mạch', 'chest pain', 'đau ngực',
    'tim', 'mạch máu', 'blood pressure', 'cholesterol', 'arrhythmia', 'nhồi máu',
    'đau tim', 'heart pain', 'cardiac',
  ],
  dermatology: [
    'skin', 'da', 'rash', 'phát ban', 'acne', 'mụn', 'da liễu',
    'ngứa', 'eczema', 'vảy nến', 'psoriasis', 'dị ứng da', 'allergy skin',
  ],
  neurology: [
    'brain', 'não', 'headache', 'đau đầu', 'stroke', 'đột quỵ',
    'thần kinh', 'chóng mặt', 'migraine', 'động kinh', 'epilepsy', 'tê tay',
  ],
  pediatrics: [
    'child', 'trẻ em', 'baby', 'trẻ sơ sinh', 'pediatric', 'nhi',
    'con', 'bé', 'infant', 'trẻ nhỏ', 'sốt trẻ em', 'vaccination', 'tiêm chủng',
  ],
  orthopedics: [
    'bone', 'xương', 'joint', 'khớp', 'fracture', 'gãy xương',
    'chỉnh hình', 'arthritis', 'viêm khớp', 'đau lưng', 'back pain', 'spine',
  ],
  ophthalmology: [
    'eye', 'mắt', 'vision', 'thị lực', 'cataract', 'đục thủy tinh thể',
    'nhãn khoa', 'glaucoma', 'cận thị', 'myopia', 'đau mắt', 'mờ mắt',
  ],
  medications: [
    'medicine', 'thuốc', 'pill', 'viên thuốc', 'prescription', 'đơn thuốc',
    'dược', 'medication', 'liều dùng', 'dosage', 'tác dụng phụ', 'side effect',
  ],
  emergency: [
    'emergency', 'cấp cứu', 'urgent', 'khẩn cấp', '911', '115',
    'ambulance', 'xe cấp cứu', 'nguy hiểm', 'critical', 'severe', 'ngất xỉu',
  ],
  general: [],
};

type EmergencyProtocol = 'cardiac_emergency' | 'stroke_emergency' | 'respiratory_emergency';

const EMERGENCY_KEYWORDS: Record<EmergencyProtocol, string[]> = {
  cardiac_emergency: [
    'chest pain', 'đau ngực', 'heart pain', 'đau tim', 'palpitations',
    'đánh trống ngực', 'tightness in chest', 'tức ngực',
    'heart attack', 'nhồi máu cơ tim',
  ],
  stroke_emergency: [
    'facial drooping', 'mặt xệ', 'méo miệng', 'arm weakness', 'tay yếu',
    'liệt tay', 'speech difficulty', 'nói khó', 'nói ngọng',
    'sudden numbness', 'tê liệt đột ngột', 'đột quỵ', 'stroke',
  ],
  respiratory_emergency: [
    'breathing difficulty', 'khó thở nặng', 'choking', 'ngạt thở',
    'nghẹt thở', 'blue lips', 'môi tím', 'severe asthma', 'hen nặng',
    'không thở được', 'cannot breathe',
  ],
};

// ==================== APPOINTMENT PATTERNS ====================
// Những từ khoá này khi xuất hiện → gợi ý đặt lịch

const APPOINTMENT_PATTERNS = {
  high: {
    vi: [
      'đau kéo dài', 'đau không giảm', 'đau nhiều ngày', 'đau mấy ngày',
      'sốt cao không hạ', 'khó thở tăng dần', 'sụt cân không rõ nguyên nhân',
      'chảy máu bất thường', 'đau ngực khi gắng sức', 'đau đầu dữ dội',
      'nôn ra máu', 'đi ngoài phân đen', 'ngực đau', 'tim đau',
    ],
    en: [
      'persistent pain', 'pain not improving', 'pain for several days',
      'pain for many days', 'been in pain', 'days of pain',
      'high fever not reducing', 'worsening shortness of breath',
      'unexplained weight loss', 'abnormal bleeding',
      'chest pain on exertion', 'severe headache',
      'vomiting blood', 'black stools', 'heart pain', 'heart hurts',
      'still hurts', "hasn't gone away", 'still in pain',
    ],
  },
  medium: {
    vi: [
      'đau âm ỉ', 'mệt mỏi kéo dài', 'chán ăn', 'rối loạn giấc ngủ',
      'lo âu', 'tê bì chân tay', 'ho kéo dài', 'nổi mẩn ngứa',
      'đau khớp', 'huyết áp cao',
    ],
    en: [
      'dull pain', 'prolonged fatigue', 'loss of appetite',
      'sleep disturbance', 'anxiety', 'numbness in limbs',
      'persistent cough', 'skin rash', 'joint pain', 'high blood pressure',
    ],
  },
  low: {
    vi: [
      'đau nhẹ', 'hỏi thông tin', 'tư vấn', 'kiểm tra sức khỏe',
      'tiêm chủng', 'khám định kỳ',
    ],
    en: [
      'mild pain', 'information inquiry', 'consultation',
      'health check', 'vaccination', 'routine checkup',
    ],
  },
};

// ==================== SPECIALTY MAPPING ====================

const CATEGORY_TO_SPECIALTY_NAME: Record<MedicalCategory, string[]> = {
  cardiology:    ['Cardiology', 'Tim mạch', 'Cardiovascular'],
  dermatology:   ['Dermatology', 'Da liễu', 'Skin'],
  neurology:     ['Neurology', 'Thần kinh', 'Brain'],
  pediatrics:    ['Pediatrics', 'Nhi khoa', 'Children'],
  orthopedics:   ['Orthopedics', 'Chỉnh hình', 'Bone'],
  ophthalmology: ['Ophthalmology', 'Nhãn khoa', 'Eye'],
  medications:   ['General Medicine', 'Nội tổng quát', 'Internal Medicine'],
  emergency:     ['Emergency', 'Cấp cứu', 'Emergency Medicine'],
  general:       ['General Practice', 'Đa khoa', 'Family Medicine'],
};

// ==================== EMERGENCY MESSAGES ====================

const EMERGENCY_PROTOCOLS: Record<Language, Record<EmergencyProtocol, string>> = {
  vi: {
    cardiac_emergency: `🚨 CẤP CỨU TIM MẠCH - HÀNH ĐỘNG NGAY LẬP TỨC!

HƯỚNG DẪN CẤP CỨU:
1. 🚑 GỌI CẤP CỨU 115 NGAY LẬP TỨC
2. 🏥 ĐẾN BỆNH VIỆN CÓ KHOA TIM MẠCH GẦN NHẤT
3. 💊 NẰM YÊN, TRÁNH MỌI VẬN ĐỘNG
4. 📞 THÔNG BÁO CHO NGƯỜI THÂN NGAY

⚠️ ĐỪNG TỰ Ý LÁI XE ĐẾN BỆNH VIỆN - GỌI CẤP CỨU!`,
    stroke_emergency: `🚨 CẤP CỨU ĐỘT QUỴ - THỜI GIAN LÀ BỘ NÃO!

Nhớ khẩu hiệu FAST:
F - MẶT: Miệng bị lệch sang một bên
A - TAY: Một tay không giơ lên được
S - NÓI: Nói ngọng, nói không rõ
T - THỜI GIAN: GỌI CẤP CỨU 115 NGAY!

⚠️ VÀNG 4.5 TIẾNG ĐẦU LÀ QUYẾT ĐỊNH - ĐỪNG TRỄ!`,
    respiratory_emergency: `🚨 CẤP CỨU HÔ HẤP - NGUY CẤP!

HÀNH ĐỘNG NGAY:
1. 🚑 GỌI CẤP CỨU 115 NGAY LẬP TỨC
2. 🏥 ĐƯA BỆNH NHÂN ĐẾN BỆNH VIỆN GẦN NHẤT
3. 💨 GIỮ ĐƯỜNG THỞ THÔNG THOÁNG
4. 🪑 ĐỂ BỆNH NHÂN NGỒI TƯ THẾ THOẢI MÁI

⚠️ ĐÂY LÀ CẤP CỨU - ĐỪNG CHỜ ĐỢI!`,
  },
  en: {
    cardiac_emergency: `🚨 CARDIAC EMERGENCY - IMMEDIATE ACTION REQUIRED!

EMERGENCY INSTRUCTIONS:
1. 🚑 CALL EMERGENCY SERVICES (911/115) IMMEDIATELY
2. 🏥 GO TO NEAREST HOSPITAL WITH CARDIAC DEPARTMENT
3. 💊 LIE DOWN, AVOID ALL MOVEMENT
4. 📞 NOTIFY FAMILY MEMBERS IMMEDIATELY

⚠️ DO NOT DRIVE YOURSELF - CALL EMERGENCY SERVICES!`,
    stroke_emergency: `🚨 STROKE EMERGENCY - TIME IS BRAIN!

Remember FAST:
F - FACE: Facial drooping on one side
A - ARMS: Unable to raise one arm
S - SPEECH: Slurred or difficulty speaking
T - TIME: CALL 911/115 IMMEDIATELY!

⚠️ GOLDEN 4.5 HOURS - DON'T DELAY!`,
    respiratory_emergency: `🚨 RESPIRATORY EMERGENCY - CRITICAL!

IMMEDIATE ACTIONS:
1. 🚑 CALL 911/115 IMMEDIATELY
2. 🏥 GET TO NEAREST HOSPITAL
3. 💨 KEEP AIRWAY CLEAR
4. 🪑 POSITION PATIENT COMFORTABLY

⚠️ THIS IS AN EMERGENCY - DON'T WAIT!`,
  },
};

// ==================== FALLBACK RESPONSES ====================

type FallbackKey = 'general' | 'cardiology' | 'emergency' | 'medications';

const FALLBACK_RESPONSES: Record<Language, Record<FallbackKey, string>> = {
  vi: {
    general: `Xin lỗi, dịch vụ AI hiện đang tạm thời không khả dụng do quá tải.

⚠️ LƯU Ý QUAN TRỌNG:
- Vui lòng tham khảo ý kiến bác sĩ chuyên khoa để được tư vấn chính xác
- Nếu có triệu chứng nghiêm trọng, hãy gọi cấp cứu 115 ngay lập tức
- Không tự ý dùng thuốc mà không có chỉ định của bác sĩ

Hệ thống sẽ sớm hoạt động trở lại. Xin lỗi vì sự bất tiện này.`,
    cardiology: `Về vấn đề tim mạch của bạn:

⚠️ KHUYẾN CÁO:
- Hãy đặt lịch khám tim mạch ngay
- Theo dõi huyết áp thường xuyên
- Tránh stress và vận động quá sức

🚨 GỌI CẤP CỨU 115 NẾU CÓ: Đau ngực dữ dội, Khó thở nặng, Ngất xỉu

Vui lòng gặp bác sĩ tim mạch để được tư vấn chi tiết.`,
    emergency: `🚨 CẢNH BÁO CẤP CỨU!
1. 🚑 GỌI CẤP CỨU 115 NGAY LẬP TỨC
2. 🏥 ĐẾN BỆNH VIỆN GẦN NHẤT`,
    medications: `Về thông tin thuốc bạn hỏi:

⚠️ QUAN TRỌNG: Tham khảo dược sĩ hoặc bác sĩ về liều lượng.
Vui lòng tham khảo dược sĩ để được tư vấn chi tiết.`,
  },
  en: {
    general: `I apologize, the AI service is temporarily unavailable.

⚠️ IMPORTANT: Please consult a qualified doctor for accurate medical advice.
If experiencing severe symptoms, call emergency services (911/115) immediately.`,
    cardiology: `Regarding your cardiac concern:

⚠️ RECOMMENDATIONS: Schedule a cardiology appointment immediately.

🚨 CALL EMERGENCY (911/115) IF YOU HAVE: Severe chest pain, Severe shortness of breath, Fainting

Please see a cardiologist for detailed consultation.`,
    emergency: `🚨 EMERGENCY ALERT!
1. 🚑 CALL EMERGENCY SERVICES (911/115) NOW
2. 🏥 GO TO NEAREST HOSPITAL`,
    medications: `Regarding the medication you asked about:

⚠️ IMPORTANT: Consult a pharmacist or doctor about proper dosage.`,
  },
};

// ==================== MAIN SERVICE CLASS ====================

export class AIMedicalService {
  private readonly groq: Groq;
  private conversationHistory: AIMessage[] = [];

  private readonly languageCache = new Map<string, Language>();
  private readonly categoryCache = new Map<string, MedicalCategory>();
  private readonly specialtyCache = new Map<string, { id: string; name: string }>();

  private requestCount = 0;
  private requestResetTime: number = Date.now() + 60_000;

  private quotaExceededUntil: number | null = null;
  private lastSpecialtyFetch = 0;

  constructor() {
    if (!config.groqApiKey) {
      throw new Error('Groq API key is required.');
    }
    this.groq = new Groq({ apiKey: config.groqApiKey });
    console.info(`✅ AIMedicalService initialized — provider: Groq (${GROQ_MODEL})`);
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

  // ==================== CIRCUIT BREAKER ====================

  private isQuotaExceeded(): boolean {
    if (this.quotaExceededUntil === null) return false;
    if (Date.now() > this.quotaExceededUntil) {
      this.quotaExceededUntil = null;
      console.info('ℹ️ Groq quota cooldown expired — API calls re-enabled');
      return false;
    }
    return true;
  }

  private markQuotaExceeded(): void {
    this.quotaExceededUntil = Date.now() + QUOTA_COOLDOWN_MS;
    console.warn(`⚠️ Groq rate limit hit. Circuit breaker active.`);
  }

  // ==================== LANGUAGE DETECTION ====================

  private detectLanguage(message: string): Language {
    const cached = this.languageCache.get(message);
    if (cached) return cached;

    if (VIETNAMESE_CHAR_REGEX.test(message)) {
      return this.setCachedLanguage(message, 'vi');
    }

    const lowerMsg = message.toLowerCase();
    const viScore = VIETNAMESE_KEYWORDS.filter(kw => lowerMsg.includes(kw)).length;
    const enScore = ENGLISH_KEYWORDS.filter(kw => lowerMsg.includes(kw)).length;

    return this.setCachedLanguage(message, viScore > enScore ? 'vi' : 'en');
  }

  private setCachedLanguage(message: string, lang: Language): Language {
    if (this.languageCache.size >= LANGUAGE_CACHE_MAX_SIZE) this.languageCache.clear();
    this.languageCache.set(message, lang);
    return lang;
  }

  // ==================== CATEGORY DETECTION ====================

  private detectCategory(message: string): MedicalCategory {
    const cached = this.categoryCache.get(message);
    if (cached) return cached;

    const lowerMsg = message.toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [MedicalCategory, string[]][]) {
      if (cat === 'general') continue;
      if (keywords.some(kw => lowerMsg.includes(kw.toLowerCase()))) {
        return this.setCachedCategory(message, cat);
      }
    }
    return this.setCachedCategory(message, 'general');
  }

  private setCachedCategory(message: string, cat: MedicalCategory): MedicalCategory {
    if (this.categoryCache.size >= CATEGORY_CACHE_MAX_SIZE) this.categoryCache.clear();
    this.categoryCache.set(message, cat);
    return cat;
  }

  // ==================== EMERGENCY DETECTION ====================

  private detectEmergency(message: string): { isEmergency: boolean; protocol?: EmergencyProtocol } {
    const lowerMsg = message.toLowerCase();
    for (const [protocol, keywords] of Object.entries(EMERGENCY_KEYWORDS) as [EmergencyProtocol, string[]][]) {
      if (keywords.some(kw => lowerMsg.includes(kw.toLowerCase()))) {
        return { isEmergency: true, protocol };
      }
    }
    return { isEmergency: false };
  }

  // ==================== SPECIALTY MANAGEMENT ====================

  private async getSpecialtyIdFromCategory(category: MedicalCategory): Promise<string | null> {
    try {
      const now = Date.now();
      if (now - this.lastSpecialtyFetch > SPECIALTY_CACHE_TTL) {
        this.specialtyCache.clear();
        this.lastSpecialtyFetch = now;
      }

      const cached = this.specialtyCache.get(category);
      if (cached) return cached.id;

      const possibleNames = CATEGORY_TO_SPECIALTY_NAME[category];
      for (const name of possibleNames) {
        const specialty = await Specialty.findOne({
          name: { $regex: new RegExp(name, 'i') },
          isActive: true,
        }).select('_id name');

        if (specialty) {
          this.specialtyCache.set(category, {
            id: specialty._id.toString(),
            name: specialty.name,
          });
          return specialty._id.toString();
        }
      }

      const defaultSpecialty = await Specialty.findOne({
        name: { $regex: /General|Đa khoa/i },
        isActive: true,
      }).select('_id name');

      if (defaultSpecialty) {
        this.specialtyCache.set(category, {
          id: defaultSpecialty._id.toString(),
          name: defaultSpecialty.name,
        });
        return defaultSpecialty._id.toString();
      }

      return null;
    } catch (error) {
      console.error('Error getting specialty ID:', error);
      return null;
    }
  }

  private mapCategoryToSpecialty(category: MedicalCategory): string {
    const mapping: Record<MedicalCategory, string> = {
      cardiology:    'Cardiology',
      dermatology:   'Dermatology',
      neurology:     'Neurology',
      pediatrics:    'Pediatrics',
      orthopedics:   'Orthopedics',
      ophthalmology: 'Ophthalmology',
      medications:   'General Medicine',
      general:       'General Medicine',
      emergency:     'Emergency',
    };
    return mapping[category] ?? 'General Medicine';
  }

  // ==================== DOCTOR AVAILABILITY ====================

  private async findAvailableDoctors(
    specialtyId: string,
    preferredDate?: Date,
    limit: number = 3,
  ): Promise<AppointmentSuggestion['suggestedDoctors']> {
    try {
      const doctors = await Doctor.find({
        specialty_id: specialtyId,
        isAvailable: true,
      })
        .populate('user_id', 'name email')
        .limit(limit);

      const targetDate = preferredDate ? new Date(preferredDate) : new Date();
      if (targetDate <= new Date()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }

      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const ALL_TIME_SLOTS = [
        '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
      ];

      const result: AppointmentSuggestion['suggestedDoctors'] = [];

      for (const doctor of doctors) {
        const booked = await Appointment.find({
          doctor_id: doctor._id,
          appointment_date: { $gte: startOfDay, $lte: endOfDay },
          status: { $in: ['pending', 'confirmed'] },
        }).select('time_slot');

        const bookedSlots = new Set(booked.map(a => a.time_slot));
        const availableSlots = ALL_TIME_SLOTS.filter(s => !bookedSlots.has(s));
        if (availableSlots.length === 0) continue;

        const [review] = await Review.aggregate([
          { $match: { doctor_id: doctor._id } },
          { $group: { _id: null, avgRating: { $avg: '$rating' } } },
        ]);

        result.push({
          id:               doctor._id.toString(),
          name:             (doctor as any).user_id?.name ?? 'Doctor',
          availableSlots:   availableSlots.slice(0, 3),
          consultationFee:  doctor.consultation_fee,
          experience:       doctor.years_of_experience,
          rating:           review?.avgRating ?? 0,
        });
      }

      return result.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } catch (error) {
      console.error('Error finding available doctors:', error);
      return [];
    }
  }

  // ==================== APPOINTMENT EVALUATION ====================

  private async evaluateAppointmentNeed(
    userMessage: string,
    category: MedicalCategory,
    isEmergency: boolean,
  ): Promise<AppointmentSuggestion> {
    // Emergency → đừng gợi ý đặt lịch, chỉ gọi cấp cứu
    if (isEmergency) {
      return {
        shouldBook: false,
        urgencyLevel: 'high',
        symptoms: [],
        reason: 'Emergency — call 115/911 immediately',
      };
    }

    const language  = this.detectLanguage(userMessage);
    const lowerMsg  = userMessage.toLowerCase();
    const detectedSymptoms: string[] = [];
    let   urgencyLevel: 'low' | 'medium' | 'high' = 'low';

    // ── Kiểm tra high → medium → low (ưu tiên mức cao nhất) ─────────
    const highList   = language === 'vi' ? APPOINTMENT_PATTERNS.high.vi   : APPOINTMENT_PATTERNS.high.en;
    const mediumList = language === 'vi' ? APPOINTMENT_PATTERNS.medium.vi : APPOINTMENT_PATTERNS.medium.en;
    const lowList    = language === 'vi' ? APPOINTMENT_PATTERNS.low.vi    : APPOINTMENT_PATTERNS.low.en;

    for (const pattern of highList) {
      if (lowerMsg.includes(pattern.toLowerCase())) {
        detectedSymptoms.push(pattern);
        urgencyLevel = 'high';
      }
    }

    if (urgencyLevel !== 'high') {
      for (const pattern of mediumList) {
        if (lowerMsg.includes(pattern.toLowerCase())) {
          detectedSymptoms.push(pattern);
          urgencyLevel = 'medium';
        }
      }
    }

    if (detectedSymptoms.length === 0) {
      for (const pattern of lowList) {
        if (lowerMsg.includes(pattern.toLowerCase())) {
          detectedSymptoms.push(pattern);
          // urgencyLevel giữ 'low'
        }
      }
    }

    // Không phát hiện triệu chứng → không gợi ý
    if (detectedSymptoms.length === 0) {
      return { shouldBook: false, urgencyLevel: 'low', symptoms: [] };
    }

    // ── Timeframe & reason ───────────────────────────────────────────
    const timeframeMap = {
      high:   { vi: 'Trong vòng 24 giờ',   en: 'Within 24 hours' },
      medium: { vi: 'Trong vòng 2-3 ngày', en: 'Within 2-3 days' },
      low:    { vi: 'Trong tuần này',       en: 'Within this week' },
    } as const;

    const reasonMap = {
      high: {
        vi: 'Triệu chứng của bạn kéo dài và cần được đánh giá khẩn cấp bởi bác sĩ chuyên khoa.',
        en: 'Your symptoms have persisted and require urgent evaluation by a specialist.',
      },
      medium: {
        vi: 'Nên tham khảo ý kiến bác sĩ để được chẩn đoán chính xác.',
        en: 'You should consult a doctor for an accurate diagnosis.',
      },
      low: {
        vi: 'Khám định kỳ để đảm bảo sức khỏe tốt nhất.',
        en: 'A routine checkup is recommended for optimal health.',
      },
    } as const;

    // ── Lấy specialty & doctors từ DB ───────────────────────────────
    const specialtyId   = await this.getSpecialtyIdFromCategory(category);
    const specialtyName = this.specialtyCache.get(category)?.name
      ?? this.mapCategoryToSpecialty(category);

    // Chỉ fetch doctors nếu urgency >= medium để tránh query thừa
    let suggestedDoctors: AppointmentSuggestion['suggestedDoctors'] = [];
    if (urgencyLevel !== 'low' && specialtyId) {
      suggestedDoctors = await this.findAvailableDoctors(specialtyId);
    }

    return {
      shouldBook:           true,
      urgencyLevel,
      suggestedSpecialty:   specialtyName,
      suggestedSpecialtyId: specialtyId ?? undefined,
      recommendedTimeframe: timeframeMap[urgencyLevel][language],
      reason:               reasonMap[urgencyLevel][language],
      symptoms:             [...new Set(detectedSymptoms)],
      suggestedDoctors,
    };
  }

  // ==================== SYSTEM PROMPT ====================

  private buildSystemPrompt(): string {
    return `You are an intelligent, empathetic, and BILINGUAL (English & Vietnamese) medical AI assistant.

LANGUAGE RULES — MANDATORY:
- User asks in ENGLISH → Respond 100% in ENGLISH
- User asks in VIETNAMESE → Respond 100% in VIETNAMESE
- NEVER mix languages in the same response

SCOPE OF SUPPORT:
- Provide general medical information across all specialties
- Explain medical terminology, procedures, treatment protocols
- Provide evidence-based healthy lifestyle advice
- Information about medications and medical devices

SAFETY PRINCIPLES — MANDATORY:
✅ ALWAYS recommend consulting a doctor for accurate advice
✅ ALWAYS add a disclaimer at the end of responses
🚨 ALWAYS guide to call 115/911 immediately for dangerous symptoms
❌ NEVER diagnose diseases or prescribe medications
❌ NEVER claim to replace a doctor

RESPONSE FORMAT:
- Natural, warm, easy-to-understand language
- Use emojis selectively to improve readability
- Break into clear sections if response is long
- End with a brief disclaimer AND the booking question (if provided in context)`;
  }

  // ==================== BOOKING CONTEXT BUILDER ====================
  // Tạo đoạn text inject vào prompt để AI biết có bác sĩ available

  private buildBookingContextBlock(
    appointment: AppointmentSuggestion,
    language: Language,
  ): string {
    if (!appointment.shouldBook) return '';

    const hasDoctors =
      appointment.suggestedDoctors && appointment.suggestedDoctors.length > 0;

    // Ngày khám = ngày mai
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toLocaleDateString(
      language === 'vi' ? 'vi-VN' : 'en-US',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
    );

    const urgencyLabel = {
      high:   { vi: 'khẩn cấp',  en: 'urgent'  },
      medium: { vi: 'sớm',       en: 'soon'    },
      low:    { vi: 'định kỳ',   en: 'routine' },
    }[appointment.urgencyLevel][language];

    if (hasDoctors) {
      const doctor = appointment.suggestedDoctors![0];
      const slot   = doctor.availableSlots[0];

      const feeText = doctor.consultationFee
        ? (language === 'vi'
            ? `${doctor.consultationFee.toLocaleString('vi-VN')} VNĐ`
            : `$${doctor.consultationFee}`)
        : (language === 'vi' ? 'Liên hệ phòng khám' : 'Contact clinic');

      const expText = doctor.experience
        ? (language === 'vi'
            ? `${doctor.experience}+ năm kinh nghiệm`
            : `${doctor.experience}+ years exp.`)
        : '';

      const ratingText = doctor.rating && doctor.rating > 0
        ? `⭐ ${doctor.rating.toFixed(1)}`
        : '';

      if (language === 'vi') {
        return `
=== HƯỚNG DẪN QUAN TRỌNG CHO AI ===
Sau khi cung cấp thông tin y tế, bạn BẮT BUỘC phải thêm đúng đoạn sau vào CUỐI câu trả lời.
KHÔNG được thay đổi tên bác sĩ, giờ khám, ngày khám, phí khám.
Giữ nguyên định dạng như bên dưới:

---
🗓️ **Gợi ý đặt lịch khám**

Dựa trên triệu chứng bạn mô tả, tôi nhận thấy bạn cần được khám **${urgencyLabel}** với bác sĩ chuyên khoa **${appointment.suggestedSpecialty}**.

Hiện tại có bác sĩ phù hợp:
👨‍⚕️ **Bác sĩ ${doctor.name}** ${expText ? `— ${expText}` : ''} ${ratingText}
🕐 Giờ khám còn trống: **${slot}**
📅 Ngày khám: **${dateStr}**
💰 Phí khám: **${feeText}**

**Bạn có muốn tôi đặt lịch khám với Bác sĩ ${doctor.name} vào lúc ${slot} ngày ${dateStr} không?** 📋
---`;
      } else {
        return `
=== IMPORTANT INSTRUCTION FOR AI ===
After providing medical information, you MUST append exactly the following block at the END of your response.
Do NOT change the doctor name, time slot, date, or fee.
Keep the exact format below:

---
🗓️ **Appointment Recommendation**

Based on the symptoms you've described, I recommend you see a **${appointment.suggestedSpecialty}** specialist **${urgencyLabel}ly**.

I found an available doctor for you:
👨‍⚕️ **Dr. ${doctor.name}** ${expText ? `— ${expText}` : ''} ${ratingText}
🕐 Available time slot: **${slot}**
📅 Date: **${dateStr}**
💰 Consultation fee: **${feeText}**

**Would you like me to book an appointment with Dr. ${doctor.name} at ${slot} on ${dateStr}?** 📋
---`;
      }
    }

    // Có triệu chứng nhưng không tìm được bác sĩ nào
    if (language === 'vi') {
      return `
=== HƯỚNG DẪN CHO AI ===
Cuối câu trả lời, hãy thêm đúng câu sau:

---
🗓️ Dựa trên triệu chứng của bạn, tôi khuyên bạn nên đặt lịch khám với bác sĩ chuyên khoa **${appointment.suggestedSpecialty}** **${urgencyLabel}** (${appointment.recommendedTimeframe}).

**Bạn có muốn tôi giúp bạn đặt lịch khám không?** 📋
---`;
    } else {
      return `
=== INSTRUCTION FOR AI ===
At the end of your response, append exactly:

---
🗓️ Based on your symptoms, I recommend scheduling an appointment with a **${appointment.suggestedSpecialty}** specialist **${urgencyLabel}** (${appointment.recommendedTimeframe}).

**Would you like me to help you book an appointment?** 📋
---`;
    }
  }

  // ==================== PROMPT BUILDER ====================

  private buildCategoryContext(category: MedicalCategory, language: Language): string {
    const contexts: Partial<Record<MedicalCategory, Record<Language, string>>> = {
      cardiology: {
        vi: 'Chuyên khoa: TIM MẠCH. Tập trung vào bệnh tim, huyết áp, mạch máu và lối sống tốt cho tim.',
        en: 'Specialty: CARDIOLOGY. Focus on heart disease, blood pressure, vascular health, and heart-healthy lifestyle.',
      },
      dermatology: {
        vi: 'Chuyên khoa: DA LIỄU. Tập trung vào bệnh da, chăm sóc da và phương pháp điều trị.',
        en: 'Specialty: DERMATOLOGY. Focus on skin conditions, skincare routines, and treatments.',
      },
      neurology: {
        vi: 'Chuyên khoa: THẦN KINH. Tập trung vào não bộ, hệ thần kinh và các triệu chứng thần kinh.',
        en: 'Specialty: NEUROLOGY. Focus on brain, nervous system, and neurological symptoms.',
      },
      pediatrics: {
        vi: 'Chuyên khoa: NHI KHOA. Tập trung vào sức khỏe trẻ em, phát triển và tiêm chủng.',
        en: 'Specialty: PEDIATRICS. Focus on child health, development, and immunizations.',
      },
      orthopedics: {
        vi: 'Chuyên khoa: CHỈNH HÌNH. Tập trung vào xương, khớp, cơ bắp và chấn thương vận động.',
        en: 'Specialty: ORTHOPEDICS. Focus on bones, joints, muscles, and sports injuries.',
      },
      ophthalmology: {
        vi: 'Chuyên khoa: NHÃN KHOA. Tập trung vào sức khỏe mắt, thị lực và các bệnh về mắt.',
        en: 'Specialty: OPHTHALMOLOGY. Focus on eye health, vision, and eye diseases.',
      },
      medications: {
        vi: 'Chủ đề: THUỐC & DƯỢC PHẨM. Thông tin về thuốc, liều dùng, tác dụng phụ và tương tác thuốc.',
        en: 'Topic: MEDICATIONS & PHARMACEUTICALS. Information on drugs, dosages, side effects, and interactions.',
      },
    };

    return (
      contexts[category]?.[language] ??
      (language === 'vi'
        ? 'Chuyên khoa: TỔNG QUÁT. Cung cấp tư vấn y tế toàn diện và hướng dẫn sức khỏe cơ bản.'
        : 'Specialty: GENERAL MEDICINE. Provide comprehensive medical information and basic health guidance.')
    );
  }

  private buildUserPrompt(
    userMessage: string,
    category: MedicalCategory,
    language: Language,
    appointmentSuggestion?: AppointmentSuggestion, // ← KEY: inject booking context
  ): string {
    const langInstruction =
      language === 'vi'
        ? '🇻🇳 QUAN TRỌNG: Người dùng đang dùng TIẾNG VIỆT. Bạn PHẢI trả lời 100% bằng TIẾNG VIỆT.'
        : '🇬🇧 IMPORTANT: User is writing in ENGLISH. You MUST respond 100% in ENGLISH.';

    const historyText = this.serializeHistory();
    const parts: string[] = [
      this.buildCategoryContext(category, language),
      langInstruction,
    ];

    if (historyText) {
      parts.push(
        language === 'vi'
          ? `LỊCH SỬ HỘI THOẠI GẦN ĐÂY:\n${historyText}`
          : `RECENT CONVERSATION HISTORY:\n${historyText}`,
      );
    }

    parts.push(
      language === 'vi'
        ? `CÂU HỎI CỦA BỆNH NHÂN: ${userMessage}`
        : `PATIENT'S QUESTION: ${userMessage}`,
    );

    // ── Inject booking block vào prompt trước khi gọi Groq ─────────
    if (appointmentSuggestion?.shouldBook) {
      const bookingBlock = this.buildBookingContextBlock(appointmentSuggestion, language);
      if (bookingBlock) {
        parts.push(bookingBlock);
      }
    }

    parts.push(
      language === 'vi'
        ? 'Hãy trả lời bằng TIẾNG VIỆT, ngôn ngữ tự nhiên, có cấu trúc rõ ràng, và tuân thủ đúng hướng dẫn ở trên.'
        : 'Respond in ENGLISH, use natural language, clear structure, and follow the instructions above exactly.',
    );

    return parts.join('\n\n');
  }

  // ==================== GROQ API CALL ====================

  private async callGroqAPI(userPrompt: string, systemPrompt: string): Promise<string> {
    this.recordRequest();
    try {
      const completion = await this.groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        temperature: 0.7,
        max_tokens:  MAX_OUTPUT_TOKENS,
        top_p:       0.95,
        stream:      false,
      });

      const text = completion.choices[0]?.message?.content ?? '';
      if (!text.trim()) throw new Error('Empty response from Groq API');
      return text;
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string; error?: { type?: string } };
      const isQuota =
        err?.status === 429 ||
        err?.error?.type === 'tokens' ||
        err?.message?.toLowerCase().includes('rate limit') ||
        err?.message?.toLowerCase().includes('quota') ||
        err?.message?.toLowerCase().includes('too many requests');

      if (isQuota) {
        this.markQuotaExceeded();
        throw new QuotaExceededError();
      }
      throw error;
    }
  }

  // ==================== SMART GENERATE WITH FALLBACK ====================

  private async tryGenerate(
    userPrompt: string,
    category: MedicalCategory,
    language: Language,
  ): Promise<{ text: string; usedFallback: boolean }> {
    if (this.isQuotaExceeded()) {
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }
    if (this.isRateLimited()) {
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }

    try {
      const text = await this.callGroqAPI(userPrompt, this.buildSystemPrompt());
      return { text, usedFallback: false };
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return { text: this.getFallbackText(category, language), usedFallback: true };
      }
      console.error('❌ Groq API error:', (error as Error)?.message);
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }
  }

  private getFallbackText(category: MedicalCategory, language: Language): string {
    const key: FallbackKey =
      category === 'emergency'   ? 'emergency'   :
      category === 'cardiology'  ? 'cardiology'  :
      category === 'medications' ? 'medications' :
      'general';
    return FALLBACK_RESPONSES[language][key];
  }

  // ==================== MAIN: PROCESS MESSAGE ====================
  // Đây là điểm mấu chốt: evaluateAppointmentNeed() chạy TRƯỚC callGroqAPI()

  public async processMessage(userMessage: string): Promise<AIResponse> {
    try {
      if (!userMessage?.trim()) throw new EmptyMessageError();

      const language = this.detectLanguage(userMessage);
      const category = this.detectCategory(userMessage);

      // ── 1. Kiểm tra khẩn cấp trước tiên ─────────────────────────
      const emergencyCheck = this.detectEmergency(userMessage);
      if (emergencyCheck.isEmergency && emergencyCheck.protocol) {
        return this.buildEmergencyResponse(emergencyCheck.protocol, language);
      }

      // ── 2. Đánh giá nhu cầu đặt lịch & lấy bác sĩ từ DB ─────────
      //    Bước này PHẢI chạy TRƯỚC khi gọi Groq
      const appointmentRecommendation = await this.evaluateAppointmentNeed(
        userMessage,
        category,
        false,
      );

      console.info(
        `📋 Appointment evaluation: shouldBook=${appointmentRecommendation.shouldBook}, ` +
        `urgency=${appointmentRecommendation.urgencyLevel}, ` +
        `doctors=${appointmentRecommendation.suggestedDoctors?.length ?? 0}`,
      );

      // ── 3. Lưu lịch sử ───────────────────────────────────────────
      this.addToHistory({ role: 'user', content: userMessage, timestamp: new Date(), category, language });

      // ── 4. Build prompt với thông tin bác sĩ đã inject ───────────
      const userPrompt = this.buildUserPrompt(
        userMessage,
        category,
        language,
        appointmentRecommendation, // ← truyền vào đây để Groq biết có bác sĩ nào
      );

      // ── 5. Gọi Groq — response sẽ tự chứa câu hỏi booking ────────
      const { text: responseText, usedFallback } = await this.tryGenerate(
        userPrompt,
        category,
        language,
      );

      this.addToHistory({ role: 'assistant', content: responseText, timestamp: new Date(), category, language });

      const analysis = this.analyzeResponse(responseText, language);

      return {
        response:                responseText,
        confidence:              usedFallback ? 0.5 : analysis.confidence,
        suggestedActions:        analysis.suggestedActions,
        emergencyAlert:          false,
        category,
        relatedSpecialties:      this.getRelatedSpecialties(category),
        language,
        usedFallback,
        provider:                'groq',
        appointmentRecommendation, // trả về để frontend dùng cho AppointmentSuggestionCard
      };
    } catch (error) {
      if (!(error instanceof EmptyMessageError)) {
        console.error('❌ Unexpected error in processMessage:', error);
      }
      return this.buildErrorResponse(this.detectLanguage(userMessage ?? ''));
    }
  }

  // ==================== RESPONSE BUILDERS ====================

  private buildEmergencyResponse(protocol: EmergencyProtocol, language: Language): AIResponse {
    const responseText =
      EMERGENCY_PROTOCOLS[language][protocol] ??
      EMERGENCY_PROTOCOLS[language].cardiac_emergency;

    return {
      response:           responseText,
      confidence:         0.98,
      suggestedActions:   language === 'vi'
        ? ['Gọi cấp cứu 115', 'Đến bệnh viện gần nhất', 'Liên hệ người thân']
        : ['Call emergency 911/115', 'Go to nearest hospital', 'Contact family member'],
      emergencyAlert:     true,
      category:           'emergency',
      relatedSpecialties: ['Emergency Medicine'],
      language,
      provider:           'local',
    };
  }

  private buildErrorResponse(language: Language): AIResponse {
    const response = language === 'vi'
      ? 'Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng:\n1. Liên hệ trực tiếp với nhà cung cấp dịch vụ y tế\n2. Gọi 115 nếu cần cấp cứu'
      : 'I apologize for the technical difficulty. Please:\n1. Contact your healthcare provider directly\n2. Call 911/115 if this is an emergency';

    return {
      response,
      confidence:         0.3,
      suggestedActions:   language === 'vi'
        ? ['Liên hệ nhà cung cấp y tế', 'Gọi cấp cứu nếu cần']
        : ['Contact healthcare provider', 'Call emergency services if needed'],
      emergencyAlert:     false,
      category:           'technical',
      language,
      usedFallback:       true,
      provider:           'none',
    };
  }

  // ==================== RESPONSE ANALYSIS ====================

  private analyzeResponse(
    responseText: string,
    language: Language,
  ): { confidence: number; suggestedActions: string[] } {
    const lower = responseText.toLowerCase();
    let confidence = 0.78;

    const highConfidenceTerms = language === 'vi'
      ? ['nghiên cứu cho thấy', 'dựa trên bằng chứng', 'hướng dẫn y khoa', 'theo khuyến cáo']
      : ['research shows', 'evidence-based', 'medical guidelines', 'clinical studies'];

    const cautionTerms = language === 'vi'
      ? ['có thể', 'đôi khi', 'trong một số trường hợp']
      : ['may be', 'could possibly', 'sometimes', 'in some cases'];

    if (highConfidenceTerms.some(t => lower.includes(t))) confidence = 0.88;
    if (cautionTerms.some(t => lower.includes(t))) confidence = Math.min(confidence, 0.65);

    const actionMap = language === 'vi'
      ? {
          doctor:     { trigger: 'bác sĩ',     label: 'Đặt lịch khám với bác sĩ' },
          pharmacist: { trigger: 'dược sĩ',    label: 'Tham khảo dược sĩ về thuốc' },
          test:       { trigger: 'xét nghiệm', label: 'Thực hiện xét nghiệm theo chỉ định' },
          emergency:  { trigger: 'cấp cứu',    label: 'Tìm kiếm chăm sóc y tế ngay lập tức' },
          specialist: { trigger: 'chuyên khoa',label: 'Tham khảo bác sĩ chuyên khoa' },
        }
      : {
          doctor:     { trigger: 'doctor',     label: 'Schedule an appointment with your doctor' },
          pharmacist: { trigger: 'pharmacist', label: 'Consult a pharmacist about medications' },
          test:       { trigger: 'test',       label: 'Get recommended tests done' },
          emergency:  { trigger: 'emergency',  label: 'Seek immediate medical attention' },
          specialist: { trigger: 'specialist', label: 'See a specialist for further evaluation' },
        };

    const suggestedActions: string[] = [];
    for (const { trigger, label } of Object.values(actionMap)) {
      if (lower.includes(trigger) && !suggestedActions.includes(label)) {
        suggestedActions.push(label);
      }
    }

    return { confidence, suggestedActions };
  }

  // ==================== HISTORY MANAGEMENT ====================

  private addToHistory(message: AIMessage): void {
    this.conversationHistory.push(message);
    if (this.conversationHistory.length > MAX_HISTORY_LENGTH) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_HISTORY_LENGTH);
    }
  }

  private serializeHistory(): string {
    return this.conversationHistory
      .map(msg => {
        const role = msg.role === 'user'
          ? (msg.language === 'vi' ? 'Bệnh nhân' : 'Patient')
          : (msg.language === 'vi' ? 'Trợ lý AI' : 'AI Assistant');
        return `${role}: ${msg.content}`;
      })
      .join('\n');
  }

  // ==================== ADDITIONAL SERVICES ====================

  public async getMedicationInfo(medicationName: string): Promise<MedicationInfo> {
    const prompt = `Cung cấp thông tin chi tiết về thuốc: "${medicationName}"

Bao gồm:
1. Tên thương mại và tên generic
2. Công dụng và chỉ định điều trị
3. Liều dùng thông thường cho người lớn
4. Tác dụng phụ thường gặp và hiếm gặp
5. Chống chỉ định
6. Tương tác thuốc quan trọng
7. Lưu ý đặc biệt (thai kỳ, người cao tuổi, v.v.)

Trả lời bằng TIẾNG VIỆT, rõ ràng và có cấu trúc. Kết thúc bằng khuyến nghị tham khảo bác sĩ.`;

    const { text } = await this.tryGenerate(prompt, 'medications', 'vi');
    return { name: medicationName, information: text, confidence: 0.85, lastUpdated: new Date().toISOString() };
  }

  public async explainMedicalTerm(term: string): Promise<TermExplanation> {
    const prompt = `Giải thích thuật ngữ y khoa: "${term}"

Bao gồm:
1. Định nghĩa đơn giản, dễ hiểu
2. Giải thích chi tiết về mặt y khoa
3. Ví dụ thực tế trong lâm sàng
4. Liên quan đến bệnh lý hoặc tình trạng nào

Trả lời bằng TIẾNG VIỆT, ngôn ngữ gần gũi và dễ hiểu.`;

    const { text } = await this.tryGenerate(prompt, 'general', 'vi');
    return { term, explanation: text, confidence: 0.9 };
  }

  public async getLifestyleAdvice(topic: string): Promise<LifestyleAdvice> {
    const prompt = `Cung cấp lời khuyên về lối sống cho chủ đề: "${topic}"

Bao gồm:
1. Khuyến nghị chế độ ăn uống phù hợp
2. Hoạt động thể chất và tập luyện thích hợp
3. Thói quen sinh hoạt hàng ngày tốt cho sức khỏe
4. Những điều cần tránh

Trả lời bằng TIẾNG VIỆT, thực tế và dựa trên bằng chứng khoa học.`;

    const { text } = await this.tryGenerate(prompt, 'general', 'vi');
    return { topic, advice: text, confidence: 0.82, category: 'lifestyle' };
  }

  // ==================== PUBLIC UTILITIES ====================

  public clearHistory(): void {
    this.conversationHistory = [];
    this.languageCache.clear();
    this.categoryCache.clear();
    this.specialtyCache.clear();
    console.info('🗑️ Conversation history and caches cleared');
  }

  public getHistory(): AIMessage[] {
    return [...this.conversationHistory];
  }

  public getLastDetectedLanguage(): Language | null {
    return this.conversationHistory.at(-1)?.language ?? null;
  }

  public getRateLimitStatus() {
    const now = Date.now();
    return {
      remaining:           Math.max(0, MAX_REQUESTS_PER_MINUTE - this.requestCount),
      resetIn:             Math.max(0, this.requestResetTime - now),
      quotaCircuitActive:  this.isQuotaExceeded(),
      provider:            'groq',
      model:               GROQ_MODEL,
    };
  }

  public async getAllSpecialties() {
    try {
      const specialties = await Specialty.find({ isActive: true })
        .select('_id name icon color')
        .sort({ name: 1 });
      return specialties.map(s => ({
        id:    s._id.toString(),
        name:  s.name,
        icon:  s.icon,
        color: s.color,
      }));
    } catch (error) {
      console.error('Error fetching specialties:', error);
      return [];
    }
  }

  public getAvailableSpecialties(): string[] {
    return [
      'Cardiology', 'Dermatology', 'Neurology', 'Pediatrics',
      'Orthopedics', 'Ophthalmology', 'Dentistry', 'Psychiatry',
      'Surgery', 'Gynecology', 'Endocrinology', 'Gastroenterology',
    ];
  }

  private getRelatedSpecialties(category: MedicalCategory): string[] {
    const map: Record<MedicalCategory, string[]> = {
      cardiology:    ['Cardiology', 'Internal Medicine'],
      dermatology:   ['Dermatology'],
      neurology:     ['Neurology'],
      pediatrics:    ['Pediatrics', 'Family Medicine'],
      orthopedics:   ['Orthopedics', 'Physical Therapy'],
      ophthalmology: ['Ophthalmology'],
      medications:   ['All Specialties', 'Pharmacy'],
      emergency:     ['Emergency Medicine'],
      general:       ['General Practice', 'Family Medicine'],
    };
    return map[category] ?? ['General Practice'];
  }
}