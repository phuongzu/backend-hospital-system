import Groq from 'groq-sdk';
import { config } from '../config/config';

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
const MAX_REQUESTS_PER_MINUTE = 25; // Groq free: 30 req/min → đặt 25 để an toàn
const LANGUAGE_CACHE_MAX_SIZE = 100;
const CATEGORY_CACHE_MAX_SIZE = 100;
const QUOTA_COOLDOWN_MS = 3 * 60 * 1000; // 3 phút cooldown

// Groq free tier: llama-3.3-70b-versatile — mạnh nhất, miễn phí hoàn toàn
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_OUTPUT_TOKENS = 512;

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
    'đánh trống ngực', 'shortness of breath', 'khó thở', 'tightness in chest',
    'tức ngực', 'heart attack', 'nhồi máu cơ tim',
  ],
  stroke_emergency: [
    'facial drooping', 'mặt xệ', 'méo miệng', 'arm weakness', 'tay yếu',
    'liệt tay', 'speech difficulty', 'nói khó', 'nói ngọng', 'sudden numbness',
    'tê liệt đột ngột', 'đột quỵ', 'stroke',
  ],
  respiratory_emergency: [
    'breathing difficulty', 'khó thở nặng', 'choking', 'ngạt thở',
    'nghẹt thở', 'blue lips', 'môi tím', 'severe asthma', 'hen nặng',
    'không thở được', 'cannot breathe',
  ],
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

💡 Đề xuất:
1. Đặt lịch khám với bác sĩ
2. Chuẩn bị danh sách triệu chứng chi tiết
3. Mang theo kết quả xét nghiệm (nếu có)

Hệ thống sẽ sớm hoạt động trở lại. Xin lỗi vì sự bất tiện này.`,

    cardiology: `Về vấn đề tim mạch của bạn:

⚠️ KHUYẾN CÁO:
- Hãy đặt lịch khám tim mạch ngay
- Theo dõi huyết áp thường xuyên
- Tránh stress và vận động quá sức
- Duy trì chế độ ăn ít muối, ít mỡ

🚨 GỌI CẤP CỨU 115 NẾU CÓ:
- Đau ngực dữ dội
- Khó thở nặng
- Chóng mặt, ngất xỉu
- Tim đập nhanh bất thường

Vui lòng gặp bác sĩ tim mạch để được tư vấn chi tiết.`,

    emergency: `🚨 CẢNH BÁO CẤP CỨU!

HÀNH ĐỘNG NGAY:
1. 🚑 GỌI CẤP CỨU 115 NGAY LẬP TỨC
2. 🏥 ĐẾN BỆNH VIỆN GẦN NHẤT
3. 📞 THÔNG BÁO CHO NGƯỜI THÂN

⚠️ ĐỪNG TỰ Ý LÁI XE - GỌI CẤP CỨU!
⚠️ ĐỪNG CHỜ ĐỢI - THỜI GIAN RẤT QUAN TRỌNG!`,

    medications: `Về thông tin thuốc bạn hỏi:

⚠️ QUAN TRỌNG:
- Tham khảo dược sĩ hoặc bác sĩ về liều lượng
- Đọc kỹ hướng dẫn sử dụng trước khi dùng
- Báo cáo tác dụng phụ cho bác sĩ nếu có
- Không tự ý thay đổi liều dùng

💊 LƯU Ý:
- Uống đúng giờ, đúng liều
- Bảo quản thuốc đúng cách, tránh ánh sáng và ẩm
- Kiểm tra hạn sử dụng trước khi uống

Vui lòng tham khảo dược sĩ để được tư vấn chi tiết.`,
  },

  en: {
    general: `I apologize, the AI service is temporarily unavailable due to high load.

⚠️ IMPORTANT NOTICE:
- Please consult a qualified doctor for accurate medical advice
- If experiencing severe symptoms, call emergency services (911/115) immediately
- Do not self-medicate without medical supervision

💡 Recommendations:
1. Schedule an appointment with your doctor
2. Prepare a detailed list of your symptoms
3. Bring any test results (if available)

The system will be back online soon. We apologize for the inconvenience.`,

    cardiology: `Regarding your cardiac concern:

⚠️ RECOMMENDATIONS:
- Schedule a cardiology appointment immediately
- Monitor your blood pressure regularly
- Avoid stress and excessive physical activity
- Maintain a low-salt, low-fat diet

🚨 CALL EMERGENCY (911/115) IF YOU HAVE:
- Severe chest pain
- Severe shortness of breath
- Dizziness or fainting
- Irregular rapid heartbeat

Please see a cardiologist for detailed consultation.`,

    emergency: `🚨 EMERGENCY ALERT!

IMMEDIATE ACTIONS:
1. 🚑 CALL EMERGENCY SERVICES (911/115) NOW
2. 🏥 GO TO NEAREST HOSPITAL
3. 📞 NOTIFY FAMILY MEMBERS

⚠️ DO NOT DRIVE YOURSELF - CALL EMERGENCY!
⚠️ DO NOT WAIT - TIME IS CRITICAL!`,

    medications: `Regarding the medication you asked about:

⚠️ IMPORTANT:
- Consult a pharmacist or doctor about proper dosage
- Read instructions carefully before taking
- Report any side effects to your doctor
- Do not change dosage without medical approval

💊 NOTES:
- Take on time and at the correct dose
- Store medication properly, away from light and moisture
- Check expiration date before taking

Please consult a pharmacist for detailed advice.`,
  },
};

// ==================== MAIN SERVICE CLASS ====================

export class AIMedicalService {
  private readonly groq: Groq;

  private conversationHistory: AIMessage[] = [];

  // Caches
  private readonly languageCache = new Map<string, Language>();
  private readonly categoryCache = new Map<string, MedicalCategory>();

  // Rate limiting
  private requestCount = 0;
  private requestResetTime: number = Date.now() + 60_000;

  // Circuit breaker
  private quotaExceededUntil: number | null = null;

  constructor() {
    if (!config.groqApiKey) {
      throw new Error(
        'Groq API key is required. Get yours free at: https://console.groq.com/keys'
      );
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
    const resetAt = new Date(this.quotaExceededUntil).toLocaleTimeString();
    console.warn(`⚠️ Groq API rate limit hit. Circuit breaker active until ${resetAt}`);
  }

  // ==================== LANGUAGE DETECTION ====================

  private detectLanguage(message: string): Language {
    const cached = this.languageCache.get(message);
    if (cached) return cached;

    // Priority 1: Vietnamese diacritic characters
    if (VIETNAMESE_CHAR_REGEX.test(message)) {
      return this.setCachedLanguage(message, 'vi');
    }

    // Priority 2: Keyword frequency scoring
    const lowerMsg = message.toLowerCase();
    const viScore = VIETNAMESE_KEYWORDS.filter(kw => lowerMsg.includes(kw)).length;
    const enScore = ENGLISH_KEYWORDS.filter(kw => lowerMsg.includes(kw)).length;

    const lang: Language = viScore > enScore ? 'vi' : 'en';
    return this.setCachedLanguage(message, lang);
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

  private detectEmergency(message: string): {
    isEmergency: boolean;
    protocol?: EmergencyProtocol;
  } {
    const lowerMsg = message.toLowerCase();

    for (const [protocol, keywords] of Object.entries(EMERGENCY_KEYWORDS) as [EmergencyProtocol, string[]][]) {
      if (keywords.some(kw => lowerMsg.includes(kw.toLowerCase()))) {
        return { isEmergency: true, protocol };
      }
    }

    return { isEmergency: false };
  }

  // ==================== SYSTEM PROMPT ====================

  private buildSystemPrompt(): string {
    return `Bạn là trợ lý AI y tế thông minh, đồng cảm và SONG NGỮ (Tiếng Anh & Tiếng Việt).

QUY TẮC NGÔN NGỮ — BẮT BUỘC:
- Người dùng hỏi bằng TIẾNG ANH → Trả lời 100% bằng TIẾNG ANH
- Người dùng hỏi bằng TIẾNG VIỆT → Trả lời 100% bằng TIẾNG VIỆT
- KHÔNG ĐƯỢC trộn lẫn hai ngôn ngữ trong cùng một câu trả lời

PHẠM VI HỖ TRỢ:
- Cung cấp thông tin y tế tổng quát trên mọi chuyên khoa
- Giải thích thuật ngữ y khoa, thủ thuật, phác đồ điều trị
- Tư vấn lối sống lành mạnh dựa trên bằng chứng khoa học
- Thông tin về thuốc và thiết bị y tế

NGUYÊN TẮC AN TOÀN — BẮT BUỘC:
✅ LUÔN khuyến nghị gặp bác sĩ để được tư vấn chính xác
✅ LUÔN thêm tuyên bố từ chối trách nhiệm ở cuối câu trả lời
🚨 LUÔN hướng dẫn gọi 115 / 911 ngay cho các triệu chứng nguy hiểm
❌ KHÔNG BAO GIỜ chẩn đoán bệnh hoặc kê đơn thuốc
❌ KHÔNG BAO GIỜ tự nhận mình thay thế được bác sĩ

CHUYÊN KHOA HỖ TRỢ:
Tim mạch | Da liễu | Thần kinh | Nhi khoa | Chỉnh hình
Nhãn khoa | Nha khoa | Tâm thần | Phụ khoa | Nội tiết | Tiêu hóa

ĐỊNH DẠNG TRẢ LỜI:
- Ngôn ngữ tự nhiên, ấm áp, dễ hiểu
- Dùng emoji một cách có chọn lọc để tăng khả năng đọc
- Chia thành các mục rõ ràng nếu câu trả lời dài
- Kết thúc bằng tuyên bố từ chối trách nhiệm ngắn gọn`;
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
        ? `CÂU HỎI: ${userMessage}`
        : `QUESTION: ${userMessage}`,
    );

    parts.push(
      language === 'vi'
        ? 'Hãy trả lời bằng TIẾNG VIỆT, ngôn ngữ tự nhiên, có cấu trúc rõ ràng và tuyên bố từ chối trách nhiệm.'
        : 'Respond in ENGLISH, use natural language, clear structure, and include a safety disclaimer.',
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
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS,
        top_p: 0.95,
        stream: false,
      });

      const text = completion.choices[0]?.message?.content ?? '';

      if (!text.trim()) {
        throw new Error('Empty response from Groq API');
      }

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
    // Check circuit breaker
    if (this.isQuotaExceeded()) {
      console.info('ℹ️ Groq circuit breaker active — using fallback');
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }

    // Check local rate limit
    if (this.isRateLimited()) {
      console.warn('⚠️ Local rate limit reached — using fallback');
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }

    try {
      const systemPrompt = this.buildSystemPrompt();
      const text = await this.callGroqAPI(userPrompt, systemPrompt);
      return { text, usedFallback: false };
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return { text: this.getFallbackText(category, language), usedFallback: true };
      }

      console.error('❌ Unexpected Groq API error:', (error as Error)?.message);
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }
  }

  // ==================== FALLBACK TEXT ====================

  private getFallbackText(category: MedicalCategory, language: Language): string {
    const key: FallbackKey =
      category === 'emergency'
        ? 'emergency'
        : category === 'cardiology'
          ? 'cardiology'
          : category === 'medications'
            ? 'medications'
            : 'general';

    return FALLBACK_RESPONSES[language][key];
  }

  // ==================== MAIN: PROCESS MESSAGE ====================

  public async processMessage(userMessage: string): Promise<AIResponse> {
    try {
      if (!userMessage?.trim()) throw new EmptyMessageError();

      const language = this.detectLanguage(userMessage);
      const category = this.detectCategory(userMessage);

      // Emergency fast-path — no API call needed
      const emergencyCheck = this.detectEmergency(userMessage);
      if (emergencyCheck.isEmergency && emergencyCheck.protocol) {
        return this.buildEmergencyResponse(emergencyCheck.protocol, language);
      }

      this.addToHistory({
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
        category,
        language,
      });

      const userPrompt = this.buildUserPrompt(userMessage, category, language);
      const { text: responseText, usedFallback } = await this.tryGenerate(
        userPrompt,
        category,
        language,
      );

      this.addToHistory({
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        category,
        language,
      });

      const analysis = this.analyzeResponse(responseText, language);

      return {
        response: responseText,
        confidence: usedFallback ? 0.5 : analysis.confidence,
        suggestedActions: analysis.suggestedActions,
        emergencyAlert: false,
        category,
        relatedSpecialties: this.getRelatedSpecialties(category),
        language,
        usedFallback,
        provider: 'groq',
      };
    } catch (error) {
      if (!(error instanceof EmptyMessageError)) {
        console.error('❌ Unexpected error in processMessage:', error);
      }

      const language = this.detectLanguage(userMessage ?? '');
      return this.buildErrorResponse(language);
    }
  }

  // ==================== RESPONSE BUILDERS ====================

  private buildEmergencyResponse(protocol: EmergencyProtocol, language: Language): AIResponse {
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
      relatedSpecialties: ['Emergency Medicine'],
      language,
      provider: 'local',
    };
  }

  private buildErrorResponse(language: Language): AIResponse {
    const response =
      language === 'vi'
        ? `Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng:\n1. Liên hệ trực tiếp với nhà cung cấp dịch vụ y tế\n2. Gọi 115 nếu cần cấp cứu\n3. Đến cơ sở y tế gần nhất`
        : `I apologize for the technical difficulty. Please:\n1. Contact your healthcare provider directly\n2. Call 911/115 if this is an emergency\n3. Visit the nearest medical facility`;

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
    language: Language,
  ): { confidence: number; suggestedActions: string[] } {
    const lower = responseText.toLowerCase();
    let confidence = 0.78;

    const highConfidenceTerms =
      language === 'vi'
        ? ['nghiên cứu cho thấy', 'dựa trên bằng chứng', 'hướng dẫn y khoa', 'theo khuyến cáo']
        : ['research shows', 'evidence-based', 'medical guidelines', 'clinical studies'];

    const cautionTerms =
      language === 'vi'
        ? ['có thể', 'đôi khi', 'trong một số trường hợp', 'thường gặp']
        : ['may be', 'could possibly', 'sometimes', 'in some cases'];

    if (highConfidenceTerms.some(t => lower.includes(t))) confidence = 0.88;
    if (cautionTerms.some(t => lower.includes(t))) confidence = Math.min(confidence, 0.65);

    const actionMap =
      language === 'vi'
        ? {
            doctor:     { trigger: 'bác sĩ',    label: 'Đặt lịch khám với bác sĩ' },
            pharmacist: { trigger: 'dược sĩ',   label: 'Tham khảo dược sĩ về thuốc' },
            test:       { trigger: 'xét nghiệm', label: 'Thực hiện xét nghiệm theo chỉ định' },
            emergency:  { trigger: 'cấp cứu',   label: 'Tìm kiếm chăm sóc y tế ngay lập tức' },
            specialist: { trigger: 'chuyên khoa', label: 'Tham khảo bác sĩ chuyên khoa' },
          }
        : {
            doctor:     { trigger: 'doctor',     label: 'Schedule an appointment with your doctor' },
            pharmacist: { trigger: 'pharmacist', label: 'Consult a pharmacist about medications' },
            test:       { trigger: 'test',        label: 'Get recommended tests done' },
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
        const role =
          msg.role === 'user'
            ? msg.language === 'vi' ? 'Bệnh nhân' : 'Patient'
            : msg.language === 'vi' ? 'Trợ lý AI' : 'AI Assistant';
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

    return {
      name: medicationName,
      information: text,
      confidence: 0.85,
      lastUpdated: new Date().toISOString(),
    };
  }

  public async explainMedicalTerm(term: string): Promise<TermExplanation> {
    const prompt = `Giải thích thuật ngữ y khoa: "${term}"

Bao gồm:
1. Định nghĩa đơn giản, dễ hiểu cho người không chuyên
2. Giải thích chi tiết hơn về mặt y khoa
3. Ví dụ thực tế trong lâm sàng
4. Liên quan đến bệnh lý hoặc tình trạng nào
5. Cách phát âm (nếu là từ tiếng Latin/Hy Lạp)

Trả lời bằng TIẾNG VIỆT, ngôn ngữ gần gũi và dễ hiểu.`;

    const { text } = await this.tryGenerate(prompt, 'general', 'vi');

    return {
      term,
      explanation: text,
      confidence: 0.9,
    };
  }

  public async getLifestyleAdvice(topic: string): Promise<LifestyleAdvice> {
    const prompt = `Cung cấp lời khuyên về lối sống cho chủ đề: "${topic}"

Bao gồm:
1. Khuyến nghị chế độ ăn uống phù hợp
2. Hoạt động thể chất và tập luyện thích hợp
3. Thói quen sinh hoạt hàng ngày tốt cho sức khỏe
4. Những điều cần tránh
5. Mẹo thực tế để áp dụng trong cuộc sống

Trả lời bằng TIẾNG VIỆT, thực tế, có thể áp dụng ngay và dựa trên bằng chứng khoa học.`;

    const { text } = await this.tryGenerate(prompt, 'general', 'vi');

    return {
      topic,
      advice: text,
      confidence: 0.82,
      category: 'lifestyle',
    };
  }

  // ==================== PUBLIC UTILITIES ====================

  public clearHistory(): void {
    this.conversationHistory = [];
    this.languageCache.clear();
    this.categoryCache.clear();
    console.info('🗑️ Conversation history and caches cleared');
  }

  public getHistory(): AIMessage[] {
    return [...this.conversationHistory];
  }

  public getLastDetectedLanguage(): Language | null {
    return this.conversationHistory.at(-1)?.language ?? null;
  }

  public getRateLimitStatus(): {
    remaining: number;
    resetIn: number;
    quotaCircuitActive: boolean;
    provider: string;
    model: string;
  } {
    const now = Date.now();
    return {
      remaining: Math.max(0, MAX_REQUESTS_PER_MINUTE - this.requestCount),
      resetIn: Math.max(0, this.requestResetTime - now),
      quotaCircuitActive: this.isQuotaExceeded(),
      provider: 'groq',
      model: GROQ_MODEL,
    };
  }

  public getAvailableSpecialties(): string[] {
    return [
      'Cardiology',
      'Dermatology',
      'Neurology',
      'Pediatrics',
      'Orthopedics',
      'Ophthalmology',
      'Dentistry',
      'Psychiatry',
      'Surgery',
      'Gynecology',
      'Endocrinology',
      'Gastroenterology',
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