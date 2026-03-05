import Groq from 'groq-sdk';
import { config } from '../config/config';
import Specialty, { ISpecialty } from '../models/specialty';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Review from '../models/review';

// ==================== TYPES ====================

export type Language = 'en' | 'vi';
export type MessageRole = 'user' | 'assistant';

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
  hasExistingAppointment?: boolean;
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
const QUOTA_COOLDOWN_MS = 3 * 60 * 1000;
const SPECIALTY_CACHE_TTL = 5 * 60 * 1000;
const ALL_TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
];

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_OUTPUT_TOKENS = 700;

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

type EmergencyProtocol =
  | 'cardiac_emergency'
  | 'stroke_emergency'
  | 'respiratory_emergency';

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

// ==================== SPECIALTY CACHE & LOADER ====================

interface SpecialtyData {
  id: string;
  name: string;
  keywords: string[];
  category: string;
  icon?: string;
  color?: string;
  relatedSpecialties: string[];
}

class SpecialtyManager {
  private specialties: Map<string, SpecialtyData> = new Map();
  private categoryToSpecialtyIds: Map<string, string[]> = new Map();
  private lastFetchTime = 0;
  private fetchPromise: Promise<void> | null = null;

  async loadSpecialties(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastFetchTime < SPECIALTY_CACHE_TTL) return;
    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = this.fetchSpecialtiesFromDB();
    try {
      await this.fetchPromise;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async fetchSpecialtiesFromDB(): Promise<void> {
    try {
      // ✅ FIX #4: Giờ `category` và `keywords` là field thực trong DB
      const specialties = await Specialty.find({ isActive: true })
        .select('_id name description icon color keywords category')
        .lean();

      this.specialties.clear();
      this.categoryToSpecialtyIds.clear();

      for (const spec of specialties) {
        // Merge keywords từ DB với keywords tự sinh từ tên
        const dbKeywords: string[] = Array.isArray(spec.keywords)
          ? spec.keywords
          : [];

        const autoKeywords = [
          spec.name.toLowerCase(),
          ...spec.name.toLowerCase().split(' '),
          ...(spec.description?.toLowerCase().split(' ') || []),
        ].filter((k) => k.length > 2);

        const uniqueKeywords = [...new Set([...dbKeywords, ...autoKeywords])];
        const category = (spec as any).category || 'Other';

        const specialtyData: SpecialtyData = {
          id: spec._id.toString(),
          name: spec.name,
          keywords: uniqueKeywords,
          category,
          icon: spec.icon,
          color: spec.color,
          relatedSpecialties: [],
        };

        this.specialties.set(specialtyData.id, specialtyData);

        if (!this.categoryToSpecialtyIds.has(category)) {
          this.categoryToSpecialtyIds.set(category, []);
        }
        this.categoryToSpecialtyIds.get(category)!.push(specialtyData.id);
      }

      // Tính related specialties
      for (const [, specIds] of this.categoryToSpecialtyIds) {
        for (const specId of specIds) {
          const spec = this.specialties.get(specId);
          if (spec) {
            spec.relatedSpecialties = specIds.filter((id) => id !== specId);
          }
        }
      }

      this.lastFetchTime = Date.now();
      console.info(`✅ Loaded ${this.specialties.size} specialties from database`);
    } catch (error) {
      console.error('Error loading specialties from DB:', error);
      throw error;
    }
  }

  // ✅ FIX #8: Word boundary matching thay vì includes() đơn giản
  async detectCategory(
    message: string
  ): Promise<{ category: string; specialtyId?: string }> {
    await this.loadSpecialties();

    const lowerMsg = message.toLowerCase();
    let bestMatch: { category: string; specialtyId?: string; score: number } =
      { category: 'general', score: 0 };

    for (const [id, spec] of this.specialties) {
      let score = 0;
      for (const keyword of spec.keywords) {
        // ✅ FIX #8: Dùng word boundary regex, tránh "tim" match "vitamin"
        try {
          const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          if (regex.test(lowerMsg)) score++;
        } catch {
          // Fallback nếu regex lỗi
          if (lowerMsg.includes(keyword)) score++;
        }
      }

      if (score > bestMatch.score) {
        bestMatch = { category: spec.category, specialtyId: id, score };
      }
    }

    return { category: bestMatch.category, specialtyId: bestMatch.specialtyId };
  }

  async getSpecialtyById(id: string): Promise<SpecialtyData | undefined> {
    await this.loadSpecialties();
    return this.specialties.get(id);
  }

  async getSpecialtiesByCategory(category: string): Promise<SpecialtyData[]> {
    await this.loadSpecialties();
    const specIds = this.categoryToSpecialtyIds.get(category) || [];
    return specIds
      .map((id) => this.specialties.get(id))
      .filter(Boolean) as SpecialtyData[];
  }

  async getAllCategories(): Promise<string[]> {
    await this.loadSpecialties();
    return [...this.categoryToSpecialtyIds.keys()];
  }

  async getAllSpecialties(): Promise<SpecialtyData[]> {
    await this.loadSpecialties();
    return Array.from(this.specialties.values());
  }

  async getRelatedSpecialties(specialtyId: string): Promise<string[]> {
    await this.loadSpecialties();
    const spec = this.specialties.get(specialtyId);
    return spec?.relatedSpecialties || [];
  }

  async getSpecialtyContext(
    specialtyId?: string,
    language: Language = 'en'
  ): Promise<string> {
    if (!specialtyId) {
      return language === 'vi'
        ? 'Chuyên khoa: TỔNG QUÁT. Cung cấp tư vấn y tế toàn diện và hướng dẫn sức khỏe cơ bản.'
        : 'Specialty: GENERAL MEDICINE. Provide comprehensive medical information and basic health guidance.';
    }

    const spec = await this.getSpecialtyById(specialtyId);
    if (!spec) {
      return language === 'vi'
        ? 'Chuyên khoa: Y HỌC TỔNG QUÁT'
        : 'Specialty: GENERAL MEDICINE';
    }

    return language === 'vi'
      ? `Chuyên khoa: ${spec.name.toUpperCase()}. ${spec.category ? `Thuộc nhóm: ${spec.category}. ` : ''}Tư vấn về các vấn đề liên quan đến ${spec.name.toLowerCase()}.`
      : `Specialty: ${spec.name.toUpperCase()}. ${spec.category ? `Category: ${spec.category}. ` : ''}Providing information related to ${spec.name.toLowerCase()}.`;
  }
}

// ==================== EMERGENCY MESSAGES ====================

const EMERGENCY_PROTOCOLS: Record<
  Language,
  Record<EmergencyProtocol, string>
> = {
  vi: {
    cardiac_emergency: `🚨 CẤP CỨU TIM MẠCH - HÀNH ĐỘNG NGAY LẬP TỨC!

HƯỚNG DẪN CẤP CỨU:
1. 🚑 GỌI CẤP CỨU 115 NGAY LẬP TỨC
2. 🏥 ĐẾN BỆNH VIỆN CÓ KHOA TIM MẠCH GẦN NHẤT
3. 💊 NẰM YÊN, TRÁNH MỌI VẬN ĐỘNG
4. 📞 THÔNG BÁO CHO NGƯỜI THÂN NGAY

⚠️ ĐỪNG TỰ Ý LÁI XE ĐẾN BỆNH VIỆN - GỌI CẤP CỨU!

⚕️ Đây là tình huống khẩn cấp y tế. Hãy hành động ngay!`,
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

⚠️ DO NOT DRIVE YOURSELF - CALL EMERGENCY SERVICES!

⚕️ This is a medical emergency. Act immediately!`,
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

⚕️ Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp.`,
    cardiology: `Về vấn đề tim mạch của bạn:

⚠️ KHUYẾN CÁO: Hãy đặt lịch khám tim mạch ngay

🚨 GỌI CẤP CỨU 115 NẾU CÓ: Đau ngực dữ dội, Khó thở nặng, Ngất xỉu

⚕️ Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp.`,
    emergency: `🚨 CẢNH BÁO CẤP CỨU!
1. 🚑 GỌI CẤP CỨU 115 NGAY LẬP TỨC
2. 🏥 ĐẾN BỆNH VIỆN GẦN NHẤT`,
    medications: `Về thông tin thuốc bạn hỏi:

⚠️ QUAN TRỌNG: Tham khảo dược sĩ hoặc bác sĩ về liều lượng.

⚕️ Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp.`,
  },
  en: {
    general: `I apologize, the AI service is temporarily unavailable.

⚠️ IMPORTANT: Please consult a qualified doctor for accurate medical advice.
If experiencing severe symptoms, call emergency services (911/115) immediately.

⚕️ This information is for educational purposes only and does not replace professional medical advice.`,
    cardiology: `Regarding your cardiac concern:

⚠️ RECOMMENDATIONS: Schedule a cardiology appointment immediately.

🚨 CALL EMERGENCY (911/115) IF YOU HAVE: Severe chest pain, Severe shortness of breath, Fainting

⚕️ This information is for educational purposes only and does not replace professional medical advice.`,
    emergency: `🚨 EMERGENCY ALERT!
1. 🚑 CALL EMERGENCY SERVICES (911/115) NOW
2. 🏥 GO TO NEAREST HOSPITAL`,
    medications: `Regarding the medication you asked about:

⚠️ IMPORTANT: Consult a pharmacist or doctor about proper dosage.

⚕️ This information is for educational purposes only and does not replace professional medical advice.`,
  },
};

// ==================== MAIN SERVICE CLASS ====================

export class AIMedicalService {
  private readonly groq: Groq;
  // ✅ FIX #3: conversationHistory là per-instance (không shared)
  private conversationHistory: AIMessage[] = [];
  private readonly specialtyManager: SpecialtyManager;
  private readonly languageCache = new Map<string, Language>();
  private requestCount = 0;
  private requestResetTime: number = Date.now() + 60_000;
  private quotaExceededUntil: number | null = null;

  constructor() {
    if (!config.groqApiKey) throw new Error('Groq API key is required.');
    this.groq = new Groq({ apiKey: config.groqApiKey });
    this.specialtyManager = new SpecialtyManager();
  }

  // ==================== PUBLIC: LOAD HISTORY FROM DB ====================

  // ✅ FIX #14: Load lịch sử từ DB vào service khi bắt đầu session
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

  // Expose để controller có thể thêm message sau khi lưu DB
  public addMessageToHistory(msg: AIMessage): void {
    this.addToHistory(msg);
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

  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }

  // ==================== CIRCUIT BREAKER ====================

  private isQuotaExceeded(): boolean {
    if (this.quotaExceededUntil === null) return false;
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
    const cached = this.languageCache.get(message);
    if (cached) return cached;

    if (VIETNAMESE_CHAR_REGEX.test(message)) {
      return this.setCachedLanguage(message, 'vi');
    }

    const lowerMsg = message.toLowerCase();
    const viScore = VIETNAMESE_KEYWORDS.filter((kw) =>
      lowerMsg.includes(kw)
    ).length;
    const enScore = ENGLISH_KEYWORDS.filter((kw) =>
      lowerMsg.includes(kw)
    ).length;

    return this.setCachedLanguage(message, viScore > enScore ? 'vi' : 'en');
  }

  private setCachedLanguage(message: string, lang: Language): Language {
    if (this.languageCache.size >= LANGUAGE_CACHE_MAX_SIZE)
      this.languageCache.clear();
    this.languageCache.set(message, lang);
    return lang;
  }

  // ==================== CATEGORY DETECTION ====================

  // Bảng symptom → tên specialty (fallback khi DB không match đủ keywords)
  private static readonly SYMPTOM_SPECIALTY_MAP: Array<{
    keywords: string[];
    specialtyNames: string[]; // tên specialty cần tìm trong DB (theo thứ tự ưu tiên)
  }> = [
    {
      keywords: ['tê bì', 'tê tay', 'tê chân', 'tê bì chân tay', 'mất ngủ', 'đau đầu',
                 'chóng mặt', 'hoa mắt', 'đau nửa đầu', 'run tay', 'co giật', 'ngất',
                 'numbness', 'headache', 'dizziness', 'migraine', 'insomnia', 'tremor'],
      specialtyNames: ['neurology', 'thần kinh', 'nội thần kinh'],
    },
    {
      keywords: ['đau khớp', 'đau lưng', 'đau xương', 'đau cổ', 'đau vai',
                 'joint pain', 'back pain', 'bone pain', 'arthritis', 'gout', 'gút',
                 'viêm khớp', 'thoát vị', 'cột sống'],
      specialtyNames: ['orthopedic', 'orthopedics', 'cơ xương khớp', 'xương khớp', 'chấn thương chỉnh hình'],
    },
    {
      keywords: ['ho', 'khó thở', 'hen', 'hen suyễn', 'viêm phổi', 'viêm phế quản',
                 'cough', 'asthma', 'pneumonia', 'bronchitis', 'shortness of breath'],
      specialtyNames: ['pulmonology', 'respiratory', 'hô hấp', 'phổi'],
    },
    {
      keywords: ['mẩn ngứa', 'nổi mề đay', 'mụn', 'da liễu', 'vảy nến', 'eczema',
                 'skin rash', 'acne', 'psoriasis', 'dermatitis', 'ngứa da', 'nám da'],
      specialtyNames: ['dermatology', 'da liễu'],
    },
    {
      keywords: ['đau bụng', 'tiêu chảy', 'táo bón', 'buồn nôn', 'nôn', 'trào ngược',
                 'viêm dạ dày', 'loét dạ dày', 'stomach pain', 'diarrhea', 'constipation',
                 'nausea', 'vomiting', 'gastritis', 'reflux'],
      specialtyNames: ['gastroenterology', 'tiêu hóa', 'nội tiêu hóa'],
    },
    {
      keywords: ['đái tháo đường', 'tiểu đường', 'béo phì', 'tuyến giáp', 'hormone',
                 'diabetes', 'obesity', 'thyroid', 'nội tiết', 'sụt cân', 'weight loss'],
      specialtyNames: ['endocrinology', 'nội tiết', 'đái tháo đường'],
    },
    {
      keywords: ['đau mắt', 'mờ mắt', 'đỏ mắt', 'khô mắt', 'cận thị', 'glaucoma',
                 'eye pain', 'blurry vision', 'red eye', 'dry eye', 'myopia'],
      specialtyNames: ['ophthalmology', 'mắt', 'nhãn khoa'],
    },
    {
      keywords: ['đau tai', 'ù tai', 'viêm tai', 'nghe kém', 'viêm mũi', 'viêm xoang',
                 'ear pain', 'tinnitus', 'sinusitis', 'rhinitis', 'tai mũi họng', 'amidan'],
      specialtyNames: ['ent', 'otolaryngology', 'tai mũi họng'],
    },
    {
      keywords: ['đau ngực', 'huyết áp', 'tim đập', 'nhịp tim', 'suy tim',
                 'chest pain', 'blood pressure', 'heart', 'cardiac', 'tim mạch',
                 'mạch', 'xơ vữa'],
      specialtyNames: ['cardiology', 'tim mạch', 'nội tim mạch'],
    },
    {
      keywords: ['ung thư', 'cancer', 'khối u', 'u bướu', 'tumor', 'lymphoma'],
      specialtyNames: ['oncology', 'ung bướu'],
    },
  ];

  private async detectCategory(
    message: string
  ): Promise<{ category: string; specialtyId?: string }> {
    // Bước 1: Dùng SpecialtyManager (match theo keywords trong DB)
    const dbResult = await this.specialtyManager.detectCategory(message);

    // Nếu DB detect được specialty cụ thể (không phải general) → dùng ngay
    if (dbResult.specialtyId && dbResult.category !== 'general') {
      return dbResult;
    }

    // Bước 2: Fallback — dùng bảng symptom map tĩnh để tìm specialty theo tên
    const lowerMsg = message.toLowerCase();
    for (const entry of AIMedicalService.SYMPTOM_SPECIALTY_MAP) {
      const matched = entry.keywords.some((kw) => lowerMsg.includes(kw.toLowerCase()));
      if (!matched) continue;

      // Tìm specialty trong DB theo danh sách tên ưu tiên
      for (const name of entry.specialtyNames) {
        try {
          const Specialty = (await import('../models/specialty')).default;
          const spec = await Specialty.findOne({
            name: { $regex: new RegExp(name, 'i') },
            isActive: true,
          }).select('_id name category').lean();

          if (spec) {
            return {
              category: (spec as any).category || name,
              specialtyId: (spec as any)._id.toString(),
            };
          }
        } catch {
          // Tiếp tục thử tên tiếp theo
        }
      }

      // Nếu không tìm thấy trong DB, vẫn trả về category name từ map
      return { category: entry.specialtyNames[0], specialtyId: undefined };
    }

    // Bước 3: Không match gì → general
    return { category: 'general', specialtyId: undefined };
  }

  // ==================== EMERGENCY DETECTION ====================

  private detectEmergency(
    message: string
  ): { isEmergency: boolean; protocol?: EmergencyProtocol } {
    const lowerMsg = message.toLowerCase();
    for (const [protocol, keywords] of Object.entries(
      EMERGENCY_KEYWORDS
    ) as [EmergencyProtocol, string[]][]) {
      if (keywords.some((kw) => lowerMsg.includes(kw.toLowerCase()))) {
        return { isEmergency: true, protocol };
      }
    }
    return { isEmergency: false };
  }

  // ==================== DOCTOR AVAILABILITY (N+1 FIX) ====================

  // ✅ FIX #9: Dùng batch queries thay vì query trong loop
  private async findAvailableDoctors(
    specialtyId: string,
    preferredDate?: Date,
    limit: number = 3
  ): Promise<AppointmentSuggestion['suggestedDoctors']> {
    try {
      // ✅ FIX: Bỏ isAvailable filter cứng, thêm status check linh hoạt hơn
      // Doctors có thể có isAvailable=true nhưng status khác nhau tùy DB seed
      const doctors = await Doctor.find({
        specialty_id: specialtyId,
        $or: [
          { isAvailable: true },
          { status: 'working' },
          { status: { $exists: false } }, // Nếu field status chưa có
        ],
      })
        .populate('user_id', 'name email avatar')
        .limit(limit);

      console.info(`🔍 findAvailableDoctors: specialtyId=${specialtyId}, found ${doctors.length} doctors`);

      // ✅ FIX: Nếu không tìm thấy với specialty_id, log để debug
      if (doctors.length === 0) {
        const totalInSpecialty = await Doctor.countDocuments({ specialty_id: specialtyId });
        console.warn(`⚠️ No available doctors for specialty ${specialtyId}. Total in specialty (any status): ${totalInSpecialty}`);
        return [];
      }

      const targetDate = preferredDate ? new Date(preferredDate) : new Date();
      // Dùng ngày mai nếu targetDate là hôm nay hoặc quá khứ
      const now = new Date();
      if (targetDate.toDateString() === now.toDateString() || targetDate < now) {
        targetDate.setDate(now.getDate() + 1);
        targetDate.setHours(0, 0, 0, 0);
      }

      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      // ✅ FIX: Lấy tên thứ trong tuần đúng theo ngày targetDate
      const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayOfWeek = DAYS[targetDate.getDay()]; // 'thursday', 'friday', etc.

      const doctorIds = doctors.map((d) => d._id);

      // Batch query appointments
      const allBooked = await Appointment.find({
        doctor_id: { $in: doctorIds },
        appointment_date: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['pending', 'confirmed'] },
      }).select('doctor_id time_slot');

      const bookedByDoctor = new Map<string, Set<string>>();
      for (const appt of allBooked) {
        const key = appt.doctor_id.toString();
        if (!bookedByDoctor.has(key)) bookedByDoctor.set(key, new Set());
        bookedByDoctor.get(key)!.add(appt.time_slot);
      }

      // Batch query ratings
      const allRatings = await Review.aggregate([
        { $match: { doctor_id: { $in: doctorIds } } },
        { $group: { _id: '$doctor_id', avgRating: { $avg: '$rating' } } },
      ]);

      const ratingMap = new Map<string, number>();
      for (const r of allRatings) {
        ratingMap.set(r._id.toString(), r.avgRating);
      }

      const result: AppointmentSuggestion['suggestedDoctors'] = [];

      for (const doctor of doctors) {
        const docId = doctor._id.toString();
        const bookedSlots = bookedByDoctor.get(docId) || new Set();

        // ✅ FIX: Check available_hours theo đúng ngày trong tuần
        // Nếu bác sĩ có available_hours, dùng nó; nếu không có thì dùng ALL_TIME_SLOTS
        let slotsForDay = ALL_TIME_SLOTS;
        const daySchedule = (doctor.available_hours as any)?.[dayOfWeek];

        if (daySchedule) {
          if (daySchedule.isAvailable === false) {
            // Bác sĩ không làm ngày này → skip
            console.info(`  Doctor ${docId}: off on ${dayOfWeek}`);
            continue;
          }
          // Generate slots trong khoảng start-end của bác sĩ
          if (daySchedule.start && daySchedule.end) {
            slotsForDay = ALL_TIME_SLOTS.filter((slot) => {
              return slot >= daySchedule.start && slot <= daySchedule.end;
            });
          }
        }

        const availableSlots = slotsForDay.filter((s) => !bookedSlots.has(s));

        console.info(`  Doctor ${docId} (${(doctor as any).user_id?.name}): ${availableSlots.length} slots on ${dayOfWeek}`);

        // ✅ FIX: Không skip nếu không có slot — vẫn hiển thị bác sĩ nhưng báo hết chỗ
        result.push({
          id: docId,
          name: (doctor as any).user_id?.name ?? 'Bác sĩ',
          availableSlots: availableSlots.slice(0, 3),
          consultationFee: doctor.consultation_fee,
          experience: doctor.years_of_experience,
          rating: ratingMap.get(docId) ?? 0,
        });
      }

      console.info(`✅ findAvailableDoctors result: ${result.length} doctors with slots`);
      return result.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } catch (error) {
      console.error('Error finding available doctors:', error);
      return [];
    }
  }

  // ==================== APPOINTMENT EVALUATION ====================

  private async evaluateAppointmentNeed(
    userMessage: string,
    category: string,
    specialtyId?: string,
    isEmergency = false,
    userId?: string
  ): Promise<AppointmentSuggestion> {
    if (isEmergency) {
      return {
        shouldBook: false,
        urgencyLevel: 'high',
        symptoms: [],
        reason: 'Emergency — call 115/911 immediately',
      };
    }

    const language = this.detectLanguage(userMessage);
    const lowerMsg = userMessage.toLowerCase();
    const detectedSymptoms: string[] = [];
    let urgencyLevel: 'low' | 'medium' | 'high' = 'low';

    const highList =
      language === 'vi'
        ? APPOINTMENT_PATTERNS.high.vi
        : APPOINTMENT_PATTERNS.high.en;
    const mediumList =
      language === 'vi'
        ? APPOINTMENT_PATTERNS.medium.vi
        : APPOINTMENT_PATTERNS.medium.en;
    const lowList =
      language === 'vi'
        ? APPOINTMENT_PATTERNS.low.vi
        : APPOINTMENT_PATTERNS.low.en;

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
        }
      }
    }

    if (detectedSymptoms.length === 0) {
      return { shouldBook: false, urgencyLevel: 'low', symptoms: [] };
    }

    // ✅ FIX #17: Kiểm tra xem bệnh nhân đã có appointment sắp tới chưa
    if (userId) {
      try {
        const existingAppointment = await Appointment.findOne({
          user_id: userId,
          appointment_date: { $gte: new Date() },
          status: { $in: ['pending', 'confirmed'] },
        });

        if (existingAppointment) {
          return {
            shouldBook: false,
            urgencyLevel,
            symptoms: [...new Set(detectedSymptoms)],
            hasExistingAppointment: true,
            reason:
              language === 'vi'
                ? 'Bạn đã có lịch hẹn sắp tới. Hãy tham khảo bác sĩ của bạn về các triệu chứng này.'
                : 'You already have an upcoming appointment. Please discuss these symptoms with your doctor.',
          };
        }
      } catch (err) {
        console.error('Error checking existing appointments:', err);
      }
    }

    const timeframeMap = {
      high: { vi: 'Trong vòng 24 giờ', en: 'Within 24 hours' },
      medium: { vi: 'Trong vòng 2-3 ngày', en: 'Within 2-3 days' },
      low: { vi: 'Trong tuần này', en: 'Within this week' },
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

    let specialtyName = category;
    if (specialtyId) {
      const spec = await this.specialtyManager.getSpecialtyById(specialtyId);
      if (spec) specialtyName = spec.name;
    }

    // ✅ FIX LOADING SPINNER: Chỉ set suggestedDoctors khi có specialtyId
    // Nếu undefined → UI hiển thị "Xem thêm bác sĩ" thay vì spinner mãi không tắt
    let suggestedDoctors: AppointmentSuggestion['suggestedDoctors'] = undefined;
    if (urgencyLevel !== 'low' && specialtyId) {
      suggestedDoctors = await this.findAvailableDoctors(specialtyId);
    }

    return {
      shouldBook: true,
      urgencyLevel,
      suggestedSpecialty: specialtyName,
      suggestedSpecialtyId: specialtyId,
      recommendedTimeframe: timeframeMap[urgencyLevel][language],
      reason: reasonMap[urgencyLevel][language],
      symptoms: [...new Set(detectedSymptoms)],
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
🚨 ALWAYS guide to call 115/911 immediately for dangerous symptoms
❌ NEVER diagnose diseases or prescribe medications
❌ NEVER claim to replace a doctor

DISCLAIMER — MANDATORY:
Always end every response with:
EN: "⚕️ This information is for educational purposes only and does not replace professional medical advice."
VI: "⚕️ Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp."

RESPONSE FORMAT:
- Natural, warm, easy-to-understand language
- Use emojis selectively to improve readability
- Break into clear sections if response is long`;
  }

  // ==================== BOOKING CONTEXT BUILDER ====================

  private async buildBookingContextBlock(
    appointment: AppointmentSuggestion,
    language: Language
  ): Promise<string> {
    if (!appointment.shouldBook) return '';

    const hasDoctors =
      appointment.suggestedDoctors && appointment.suggestedDoctors.length > 0;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toLocaleDateString(
      language === 'vi' ? 'vi-VN' : 'en-US',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    );

    const urgencyLabel = {
      high: { vi: 'khẩn cấp', en: 'urgent' },
      medium: { vi: 'sớm', en: 'soon' },
      low: { vi: 'định kỳ', en: 'routine' },
    }[appointment.urgencyLevel][language];

    if (hasDoctors) {
      const doctor = appointment.suggestedDoctors![0];
      const slot = doctor.availableSlots[0];
      const feeText = doctor.consultationFee
        ? language === 'vi'
          ? `${doctor.consultationFee.toLocaleString('vi-VN')} VNĐ`
          : `$${doctor.consultationFee}`
        : language === 'vi'
        ? 'Liên hệ phòng khám'
        : 'Contact clinic';
      const expText = doctor.experience
        ? language === 'vi'
          ? `${doctor.experience}+ năm kinh nghiệm`
          : `${doctor.experience}+ years exp.`
        : '';
      const ratingText =
        doctor.rating && doctor.rating > 0
          ? `⭐ ${doctor.rating.toFixed(1)}`
          : '';

      if (language === 'vi') {
        return `
=== HƯỚNG DẪN QUAN TRỌNG CHO AI ===
Sau khi cung cấp thông tin y tế, bạn BẮT BUỘC phải thêm đúng đoạn sau vào CUỐI câu trả lời.

---
🗓️ **Gợi ý đặt lịch khám**

Dựa trên triệu chứng bạn mô tả, tôi nhận thấy bạn cần được khám **${urgencyLabel}** với bác sĩ chuyên khoa **${appointment.suggestedSpecialty}**.

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

---
🗓️ **Appointment Recommendation**

Based on the symptoms you've described, I recommend you see a **${appointment.suggestedSpecialty}** specialist **${urgencyLabel}ly**.

👨‍⚕️ **Dr. ${doctor.name}** ${expText ? `— ${expText}` : ''} ${ratingText}
🕐 Available time slot: **${slot}**
📅 Date: **${dateStr}**
💰 Consultation fee: **${feeText}**

**Would you like me to book an appointment with Dr. ${doctor.name} at ${slot} on ${dateStr}?** 📋
---`;
      }
    }

    // No doctors available
    return language === 'vi'
      ? `\n=== HƯỚNG DẪN CHO AI ===\nCuối câu trả lời, hãy thêm:\n---\n🗓️ Dựa trên triệu chứng của bạn, tôi khuyên bạn nên đặt lịch khám với bác sĩ chuyên khoa **${appointment.suggestedSpecialty}** **${urgencyLabel}** (${appointment.recommendedTimeframe}).\n**Bạn có muốn tôi giúp bạn đặt lịch khám không?** 📋\n---`
      : `\n=== INSTRUCTION FOR AI ===\nAt the end of your response, append:\n---\n🗓️ Based on your symptoms, I recommend scheduling an appointment with a **${appointment.suggestedSpecialty}** specialist **${urgencyLabel}** (${appointment.recommendedTimeframe}).\n**Would you like me to help you book an appointment?** 📋\n---`;
  }

  // ==================== PROMPT BUILDER ====================

  private async buildUserPrompt(
    userMessage: string,
    category: string,
    specialtyId: string | undefined,
    language: Language,
    appointmentSuggestion?: AppointmentSuggestion
  ): Promise<string> {
    const langInstruction =
      language === 'vi'
        ? '🇻🇳 QUAN TRỌNG: Người dùng đang dùng TIẾNG VIỆT. Bạn PHẢI trả lời 100% bằng TIẾNG VIỆT.'
        : '🇬🇧 IMPORTANT: User is writing in ENGLISH. You MUST respond 100% in ENGLISH.';

    const historyText = this.serializeHistory();
    const specialtyContext = await this.specialtyManager.getSpecialtyContext(
      specialtyId,
      language
    );

    const parts: string[] = [specialtyContext, langInstruction];

    if (historyText) {
      parts.push(
        language === 'vi'
          ? `LỊCH SỬ HỘI THOẠI GẦN ĐÂY:\n${historyText}`
          : `RECENT CONVERSATION HISTORY:\n${historyText}`
      );
    }

    parts.push(
      language === 'vi'
        ? `CÂU HỎI CỦA BỆNH NHÂN: ${userMessage}`
        : `PATIENT'S QUESTION: ${userMessage}`
    );

    if (appointmentSuggestion?.shouldBook) {
      const bookingBlock = await this.buildBookingContextBlock(
        appointmentSuggestion,
        language
      );
      if (bookingBlock) parts.push(bookingBlock);
    }

    parts.push(
      language === 'vi'
        ? 'Hãy trả lời bằng TIẾNG VIỆT, ngôn ngữ tự nhiên, có cấu trúc rõ ràng.'
        : 'Respond in ENGLISH, use natural language, clear structure.'
    );

    return parts.join('\n\n');
  }

  // ==================== GROQ API CALL ====================

  private async callGroqAPI(
    userPrompt: string,
    systemPrompt: string
  ): Promise<string> {
    this.recordRequest();
    try {
      const completion = await this.groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS,
        top_p: 0.95,
        stream: false,
      });

      const text = completion.choices[0]?.message?.content ?? '';
      if (!text.trim()) throw new Error('Empty response from Groq API');
      return text;
    } catch (error: unknown) {
      const err = error as {
        status?: number;
        message?: string;
        error?: { type?: string };
      };
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
    category: string,
    language: Language
  ): Promise<{ text: string; usedFallback: boolean }> {
    if (this.isQuotaExceeded() || this.isRateLimited()) {
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

  private getFallbackText(category: string, language: Language): string {
    let key: FallbackKey = 'general';
    const lowerCat = category.toLowerCase();
    if (lowerCat.includes('emergency') || lowerCat.includes('cấp cứu')) key = 'emergency';
    else if (lowerCat.includes('cardio') || lowerCat.includes('tim')) key = 'cardiology';
    else if (lowerCat.includes('medication') || lowerCat.includes('thuốc')) key = 'medications';
    return FALLBACK_RESPONSES[language][key];
  }

  // ==================== MAIN: PROCESS MESSAGE ====================

  public async processMessage(
    userMessage: string,
    userId?: string
  ): Promise<AIResponse> {
    try {
      if (!userMessage?.trim()) throw new EmptyMessageError();

      const language = this.detectLanguage(userMessage);

      // 1. Check emergency
      const emergencyCheck = this.detectEmergency(userMessage);
      if (emergencyCheck.isEmergency && emergencyCheck.protocol) {
        return this.buildEmergencyResponse(emergencyCheck.protocol, language);
      }

      // 2. Detect category + specialty from DB
      const { category, specialtyId } = await this.detectCategory(userMessage);

      // 3. Evaluate appointment need (✅ truyền userId để check existing)
      const appointmentRecommendation = await this.evaluateAppointmentNeed(
        userMessage,
        category,
        specialtyId,
        false,
        userId
      );

      // 4. Save to history
      this.addToHistory({
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
        category,
        language,
      });

      // 5. Build prompt
      const userPrompt = await this.buildUserPrompt(
        userMessage,
        category,
        specialtyId,
        language,
        appointmentRecommendation
      );

      // 6. Call Groq
      const { text: responseText, usedFallback } = await this.tryGenerate(
        userPrompt,
        category,
        language
      );

      this.addToHistory({
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        category,
        language,
      });

      const analysis = this.analyzeResponse(responseText, language);

      // 7. Get related specialties
      let relatedSpecialties: string[] = [];
      if (specialtyId) {
        relatedSpecialties = await this.specialtyManager.getRelatedSpecialties(specialtyId);
      }

      return {
        response: responseText,
        confidence: usedFallback ? 0.5 : analysis.confidence,
        suggestedActions: analysis.suggestedActions,
        emergencyAlert: false,
        category,
        relatedSpecialties,
        language,
        usedFallback,
        provider: 'groq',
        appointmentRecommendation,
      };
    } catch (error) {
      if (!(error instanceof EmptyMessageError)) {
        console.error('❌ Unexpected error in processMessage:', error);
      }
      return this.buildErrorResponse(this.detectLanguage(userMessage ?? ''));
    }
  }

  // ==================== RESPONSE BUILDERS ====================

  private buildEmergencyResponse(
    protocol: EmergencyProtocol,
    language: Language
  ): AIResponse {
    const responseText =
      EMERGENCY_PROTOCOLS[language][protocol] ??
      EMERGENCY_PROTOCOLS[language].cardiac_emergency;

    return {
      response: responseText,
      confidence: 0.98,
      suggestedActions:
        language === 'vi'
          ? ['Gọi cấp cứu 115', 'Đến bệnh viện gần nhất', 'Liên hệ người thân']
          : ['Call emergency 911/115', 'Go to nearest hospital', 'Contact family member'],
      emergencyAlert: true,
      category: 'emergency',
      relatedSpecialties: [],
      language,
      provider: 'local',
    };
  }

  private buildErrorResponse(language: Language): AIResponse {
    const response =
      language === 'vi'
        ? 'Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng:\n1. Liên hệ trực tiếp với nhà cung cấp dịch vụ y tế\n2. Gọi 115 nếu cần cấp cứu\n\n⚕️ Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp.'
        : 'I apologize for the technical difficulty. Please:\n1. Contact your healthcare provider directly\n2. Call 911/115 if this is an emergency\n\n⚕️ This information is for educational purposes only and does not replace professional medical advice.';

    return {
      response,
      confidence: 0.3,
      suggestedActions:
        language === 'vi'
          ? ['Liên hệ nhà cung cấp y tế', 'Gọi cấp cứu nếu cần']
          : ['Contact healthcare provider', 'Call emergency services if needed'],
      emergencyAlert: false,
      category: 'technical',
      language,
      usedFallback: true,
      provider: 'none',
    };
  }

  // ==================== RESPONSE ANALYSIS ====================

  private analyzeResponse(
    responseText: string,
    language: Language
  ): { confidence: number; suggestedActions: string[] } {
    const lower = responseText.toLowerCase();
    let confidence = 0.78;

    const highConfidenceTerms =
      language === 'vi'
        ? ['nghiên cứu cho thấy', 'dựa trên bằng chứng', 'hướng dẫn y khoa', 'theo khuyến cáo']
        : ['research shows', 'evidence-based', 'medical guidelines', 'clinical studies'];

    const cautionTerms =
      language === 'vi'
        ? ['có thể', 'đôi khi', 'trong một số trường hợp']
        : ['may be', 'could possibly', 'sometimes', 'in some cases'];

    if (highConfidenceTerms.some((t) => lower.includes(t))) confidence = 0.88;
    if (cautionTerms.some((t) => lower.includes(t))) confidence = Math.min(confidence, 0.65);

    const actionMap =
      language === 'vi'
        ? {
            doctor: { trigger: 'bác sĩ', label: 'Đặt lịch khám với bác sĩ' },
            pharmacist: { trigger: 'dược sĩ', label: 'Tham khảo dược sĩ về thuốc' },
            test: { trigger: 'xét nghiệm', label: 'Thực hiện xét nghiệm theo chỉ định' },
            emergency: { trigger: 'cấp cứu', label: 'Tìm kiếm chăm sóc y tế ngay lập tức' },
            specialist: { trigger: 'chuyên khoa', label: 'Tham khảo bác sĩ chuyên khoa' },
          }
        : {
            doctor: { trigger: 'doctor', label: 'Schedule an appointment with your doctor' },
            pharmacist: { trigger: 'pharmacist', label: 'Consult a pharmacist about medications' },
            test: { trigger: 'test', label: 'Get recommended tests done' },
            emergency: { trigger: 'emergency', label: 'Seek immediate medical attention' },
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
      .map((msg) => {
        const role =
          msg.role === 'user'
            ? msg.language === 'vi'
              ? 'Bệnh nhân'
              : 'Patient'
            : msg.language === 'vi'
            ? 'Trợ lý AI'
            : 'AI Assistant';
        return `${role}: ${msg.content}`;
      })
      .join('\n');
  }

  // ==================== ADDITIONAL SERVICES ====================

  public async getMedicationInfo(medicationName: string): Promise<MedicationInfo> {
    const prompt = `Cung cấp thông tin chi tiết về thuốc: "${medicationName}"\n\nBao gồm: tên thương mại, công dụng, liều dùng, tác dụng phụ, chống chỉ định, tương tác thuốc.\n\nTrả lời bằng TIẾNG VIỆT.\n\n⚕️ Kết thúc bằng: "Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp."`;
    const { text } = await this.tryGenerate(prompt, 'medications', 'vi');
    return { name: medicationName, information: text, confidence: 0.85, lastUpdated: new Date().toISOString() };
  }

  public async explainMedicalTerm(term: string): Promise<TermExplanation> {
    const prompt = `Giải thích thuật ngữ y khoa: "${term}"\n\nBao gồm: định nghĩa, giải thích y khoa, ví dụ lâm sàng.\n\nTrả lời bằng TIẾNG VIỆT, ngôn ngữ gần gũi và dễ hiểu.`;
    const { text } = await this.tryGenerate(prompt, 'general', 'vi');
    return { term, explanation: text, confidence: 0.9 };
  }

  public async getLifestyleAdvice(topic: string): Promise<LifestyleAdvice> {
    const prompt = `Cung cấp lời khuyên về lối sống cho chủ đề: "${topic}"\n\nBao gồm: chế độ ăn, tập luyện, thói quen sinh hoạt.\n\nTrả lời bằng TIẾNG VIỆT, thực tế và dựa trên bằng chứng.`;
    const { text } = await this.tryGenerate(prompt, 'general', 'vi');
    return { topic, advice: text, confidence: 0.82, category: 'lifestyle' };
  }

  // ==================== PUBLIC UTILITIES ====================

  public clearHistory(): void {
    this.conversationHistory = [];
    this.languageCache.clear();
  }

  public getHistory(): AIMessage[] {
    return [...this.conversationHistory];
  }

  public getLastDetectedLanguage(): Language | null {
    return this.conversationHistory.at(-1)?.language ?? null;
  }

  public getRateLimitStatus() {
    return {
      remaining: Math.max(0, MAX_REQUESTS_PER_MINUTE - this.requestCount),
      resetIn: Math.max(0, this.requestResetTime - Date.now()),
      quotaCircuitActive: this.isQuotaExceeded(),
      provider: 'groq',
      model: GROQ_MODEL,
    };
  }

  public async getAllSpecialties() {
    const specialties = await this.specialtyManager.getAllSpecialties();
    return specialties.map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      color: s.color,
      category: s.category,
    }));
  }

  public async getAllCategories(): Promise<string[]> {
    return this.specialtyManager.getAllCategories();
  }

  public async getSpecialtyById(id: string) {
    return this.specialtyManager.getSpecialtyById(id);
  }

  public async refreshSpecialties(): Promise<void> {
    await this.specialtyManager.loadSpecialties(true);
  }
}

// ==================== FIX #3: SESSION MANAGER ====================
// Quản lý 1 AIMedicalService instance riêng cho mỗi chat session

const serviceInstances = new Map<string, AIMedicalService>();
const SERVICE_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 phút không dùng thì cleanup
const serviceLastUsed = new Map<string, number>();

export function getServiceForSession(sessionId: string): AIMedicalService {
  if (!serviceInstances.has(sessionId)) {
    serviceInstances.set(sessionId, new AIMedicalService());
  }
  serviceLastUsed.set(sessionId, Date.now());
  return serviceInstances.get(sessionId)!;
}

export function cleanupServiceForSession(sessionId: string): void {
  serviceInstances.delete(sessionId);
  serviceLastUsed.delete(sessionId);
}

// Cleanup idle services mỗi 15 phút
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, lastUsed] of serviceLastUsed) {
    if (now - lastUsed > SERVICE_IDLE_TIMEOUT) {
      serviceInstances.delete(sessionId);
      serviceLastUsed.delete(sessionId);
    }
  }
}, 15 * 60 * 1000);