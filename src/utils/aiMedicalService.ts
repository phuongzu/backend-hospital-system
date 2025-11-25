import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/config';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  category?: string;
  language?: 'en' | 'vi';
}

export interface AIResponse {
  response: string;
  confidence: number;
  suggestedActions?: string[];
  emergencyAlert?: boolean;
  category?: string;
  relatedSpecialties?: string[];
  language?: 'en' | 'vi';
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

export class AIMedicalService {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private conversationHistory: AIMessage[] = [];
  private readonly maxHistoryLength = 10;

  // Cache for language detection
  private languageCache = new Map<string, 'en' | 'vi'>();
  private categoryCache = new Map<string, string>();

  constructor() {
    if (!config.geminiApiKey) {
      throw new Error('Gemini API key is required');
    }

    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
      systemInstruction: this.getSystemPrompt()
    });
  }

  // ==================== LANGUAGE DETECTION ====================

  private detectLanguage(message: string): 'en' | 'vi' {
    // Check cache first
    const cached = this.languageCache.get(message);
    if (cached) return cached;

    const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    
    const vietnameseKeywords = [
      'tôi', 'bạn', 'của', 'và', 'có', 'là', 'trong', 'cho', 'với', 'không',
      'bị', 'đau', 'thuốc', 'bệnh', 'khám', 'bác sĩ', 'bệnh viện', 'điều trị',
      'triệu chứng', 'làm sao', 'như thế nào', 'tại sao', 'khi nào', 'ở đâu'
    ];

    const englishKeywords = [
      'what', 'how', 'when', 'where', 'why', 'who', 'which', 'can', 'could',
      'would', 'should', 'pain', 'disease', 'treatment', 'symptom', 'doctor',
      'hospital', 'medicine', 'medication', 'test', 'diagnosis'
    ];

    const lowerMessage = message.toLowerCase();

    // Priority 1: Vietnamese characters
    if (vietnameseRegex.test(message)) {
      this.languageCache.set(message, 'vi');
      return 'vi';
    }

    // Priority 2: Keyword counting
    const vietnameseCount = vietnameseKeywords.filter(keyword => 
      lowerMessage.includes(keyword)
    ).length;

    const englishCount = englishKeywords.filter(keyword => 
      lowerMessage.includes(keyword)
    ).length;

    let detectedLanguage: 'en' | 'vi' = 'en';
    
    if (vietnameseCount > englishCount) {
      detectedLanguage = 'vi';
    } else if (englishCount > vietnameseCount) {
      detectedLanguage = 'en';
    }

    this.languageCache.set(message, detectedLanguage);
    return detectedLanguage;
  }

  // ==================== SYSTEM PROMPT ====================

  private getSystemPrompt(): string {
    return `Bạn là trợ lý AI y tế thông minh và đồng cảm với khả năng SONG NGỮ (Tiếng Anh và Tiếng Việt).

QUY TẮC NGÔN NGỮ QUAN TRỌNG:
🌐 LUÔN trả lời bằng ĐÚNG NGÔN NGỮ mà người dùng sử dụng
- Người dùng hỏi bằng tiếng Anh → Trả lời 100% bằng TIẾNG ANH
- Người dùng hỏi bằng tiếng Việt → Trả lời 100% bằng TIẾNG VIỆT
- KHÔNG trộn lẫn ngôn ngữ trừ khi được yêu cầu rõ ràng
- Duy trì tính nhất quán ngôn ngữ trong toàn bộ câu trả lời

VAI TRÒ VÀ PHẠM VI:
- Trợ lý y tế ảo cung cấp thông tin y tế toàn diện
- Hỗ trợ bệnh nhân hiểu về tình trạng sức khỏe trên tất cả các chuyên khoa
- Giải thích thuật ngữ y tế, thủ tục và kế hoạch điều trị
- Cung cấp lời khuyên sức khỏe dựa trên bằng chứng và khuyến nghị lối sống
- Hỗ trợ thông tin về thuốc và hiểu biết về thiết bị y tế

NGUYÊN TẮC AN TOÀN:
🚨 QUAN TRỌNG: LUÔN khuyên bệnh nhân tham khảo ý kiến bác sĩ trước khi áp dụng bất kỳ thay đổi nào
🚨 CẤP CỨU: Ngay lập tức hướng dẫn đến dịch vụ cấp cứu cho các triệu chứng nguy hiểm
❌ KHÔNG BAO GIỜ chẩn đoán bệnh hoặc kê đơn thuốc
❌ KHÔNG BAO GIỜ thay thế các chuyên gia y tế có trình độ
❌ KHÔNG BAO GIỜ đưa ra lời khuyên y tế dứt khoát mà không có tư vấn

GIAO THỨC CẤP CỨU:
Cho người nói tiếng Anh:
- "🚨 THIS IS A MEDICAL EMERGENCY! Please call emergency services (911/115) immediately."

Cho người nói tiếng Việt:
- "🚨 ĐÂY LÀ CẤP CỨU Y TẾ! Vui lòng gọi cấp cứu 115 ngay lập tức."

CHUYÊN MÔN:
Bạn được đào tạo về tất cả các chuyên khoa y tế bao gồm:
1. TIM MẠCH - Tim và hệ thống tim mạch
2. DA LIỄU - Tình trạng da
3. THẦN KINH - Não và hệ thần kinh
4. NHI KHOA - Sức khỏe trẻ em
5. CHỈNH HÌNH - Xương và khớp
6. NHÃN KHOA - Sức khỏe mắt
7. NHA KHOA - Sức khỏe răng miệng
8. TÂM THẦN - Sức khỏe tâm thần
9. PHẪU THUẬT - Thủ thuật phẫu thuật
10. PHỤ KHOA - Sức khỏe phụ nữ
11. NỘI TIẾT - Hormone
12. TIÊU HÓA - Hệ tiêu hóa

ĐỊNH DẠNG PHẢN HỒI:
- Sử dụng ngôn ngữ rõ ràng, đồng cảm phù hợp với ngôn ngữ của người dùng
- Cung cấp thông tin thực tế và lời khuyên có thể hành động
- Luôn bao gồm tuyên bố từ chối trách nhiệm an toàn bằng cùng ngôn ngữ
- Định dạng phản hồi để dễ đọc

Nhớ: Tính nhất quán ngôn ngữ là QUAN TRỌNG đối với trải nghiệm người dùng và sự tin tưởng.`;
  }

  // ==================== CATEGORY DETECTION ====================

  private detectCategory(message: string): string {
    // Check cache first
    const cached = this.categoryCache.get(message);
    if (cached) return cached;

    const categories = {
      cardiology: ['heart', 'cardio', 'huyết áp', 'tim mạch', 'chest pain', 'đau ngực', 'tim', 'mạch máu', 'blood pressure'],
      dermatology: ['skin', 'da', 'rash', 'phát ban', 'acne', 'mụn', 'da liễu', 'ngứa', 'eczema'],
      neurology: ['brain', 'não', 'headache', 'đau đầu', 'stroke', 'đột quỵ', 'thần kinh', 'chóng mặt', 'migraine'],
      pediatrics: ['child', 'trẻ em', 'baby', 'trẻ sơ sinh', 'pediatric', 'nhi', 'con', 'bé', 'infant'],
      orthopedics: ['bone', 'xương', 'joint', 'khớp', 'fracture', 'gãy xương', 'chỉnh hình', 'arthritis'],
      ophthalmology: ['eye', 'mắt', 'vision', 'thị lực', 'cataract', 'đục thủy tinh thể', 'nhãn khoa', 'glaucoma'],
      medications: ['medicine', 'thuốc', 'pill', 'viên thuốc', 'prescription', 'đơn thuốc', 'dược', 'medication'],
      emergency: ['emergency', 'cấp cứu', 'urgent', 'khẩn cấp', '911', '115', 'ambulance', 'xe cấp cứu']
    };

    const lowerMessage = message.toLowerCase();
    let detectedCategory = 'general';

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))) {
        detectedCategory = category;
        break;
      }
    }

    this.categoryCache.set(message, detectedCategory);
    return detectedCategory;
  }

  // ==================== EMERGENCY DETECTION ====================

  private detectEmergencyKeywords(message: string): { isEmergency: boolean; protocol?: string } {
    const emergencyPatterns = {
      cardiac_emergency: [
        'chest pain', 'đau ngực', 'heart pain', 'đau tim', 'palpitations', 'đánh trống ngực',
        'shortness of breath', 'khó thở', 'tightness in chest', 'tức ngực', 'heart attack'
      ],
      stroke_emergency: [
        'facial drooping', 'mặt xệ', 'méo miệng', 'arm weakness', 'tay yếu', 'liệt tay',
        'speech difficulty', 'nói khó', 'nói ngọng', 'sudden numbness', 'tê liệt đột ngột', 'đột quỵ'
      ],
      respiratory_emergency: [
        'breathing difficulty', 'khó thở nặng', 'choking', 'ngạt thở', 'nghẹt thở',
        'blue lips', 'môi tím', 'severe asthma', 'hen nặng', 'không thở được'
      ]
    };

    const lowerMessage = message.toLowerCase();
    
    for (const [protocol, keywords] of Object.entries(emergencyPatterns)) {
      if (keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))) {
        return { isEmergency: true, protocol };
      }
    }

    return { isEmergency: false };
  }

  private getEmergencyProtocols(language: 'en' | 'vi'): { [key: string]: string } {
    if (language === 'vi') {
      return {
        cardiac_emergency: `🚨 CẤP CỨU TIM MẠCH - HÀNH ĐỘNG NGAY LẬP TỨC!

Triệu chứng: Đau ngực, đánh trống ngực, khó thở, chóng mặt

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

Triệu chứng: Khó thở nặng, ngạt thở, môi tím tái

HÀNH ĐỘNG NGAY:
1. 🚑 GỌI CẤP CỨU 115 NGAY LẬP TỨC
2. 🏥 ĐƯA BỆNH NHÂN ĐẾN BỆNH VIỆN GẦN NHẤT
3. 💨 GIỮ ĐƯỜNG THỞ THÔNG THOÁNG
4. 🪑 ĐỂ BỆNH NHÂN NGỒI TƯ THẾ THOẢI MÁI

⚠️ ĐÂY LÀ CẤP CỨU - ĐỪNG CHỜ ĐỢI!`
      };
    } else {
      return {
        cardiac_emergency: `🚨 CARDIAC EMERGENCY - IMMEDIATE ACTION REQUIRED!

Symptoms: Chest pain, palpitations, shortness of breath, dizziness

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

Symptoms: Severe breathing difficulty, choking, blue lips

IMMEDIATE ACTIONS:
1. 🚑 CALL 911/115 IMMEDIATELY
2. 🏥 GET TO NEAREST HOSPITAL
3. 💨 KEEP AIRWAY CLEAR
4. 🪑 POSITION PATIENT COMFORTABLY

⚠️ THIS IS AN EMERGENCY - DON'T WAIT!`
      };
    }
  }

  // ==================== MAIN PROCESSING METHOD ====================

  public async processMessage(userMessage: string): Promise<AIResponse> {
    try {
      // Validate input
      if (!userMessage || userMessage.trim().length === 0) {
        throw new Error('Empty message provided');
      }

      // Detect language and check for emergency
      const detectedLanguage = this.detectLanguage(userMessage);
      const emergencyCheck = this.detectEmergencyKeywords(userMessage);

      if (emergencyCheck.isEmergency && emergencyCheck.protocol) {
        return this.handleEmergencySituation(emergencyCheck.protocol, userMessage, detectedLanguage);
      }

      // Add to conversation history
      const category = this.detectCategory(userMessage);
      this.addToHistory({
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
        category,
        language: detectedLanguage
      });

      // Generate AI response
      const responseText = await this.generateAIResponse(userMessage, category, detectedLanguage);

      // Add AI response to history
      this.addToHistory({
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        category,
        language: detectedLanguage
      });

      // Analyze response
      const analysis = this.analyzeResponse(responseText, category, detectedLanguage);

      return {
        response: responseText,
        confidence: analysis.confidence,
        suggestedActions: analysis.suggestedActions,
        emergencyAlert: false,
        category,
        relatedSpecialties: this.getRelatedSpecialties(category),
        language: detectedLanguage
      };

    } catch (error) {
      console.error('Error processing AI message:', error);
      const language = this.detectLanguage(userMessage);
      return this.getFallbackResponse(language);
    }
  }

  // ==================== AI RESPONSE GENERATION ====================

  private async generateAIResponse(userMessage: string, category: string, language: 'en' | 'vi'): Promise<string> {
    const languageInstruction = language === 'vi' 
      ? `\n\n🇻🇳 QUAN TRỌNG: Người dùng hỏi bằng TIẾNG VIỆT. Bạn PHẢI trả lời 100% bằng TIẾNG VIỆT.`
      : `\n\n🇬🇧 IMPORTANT: User is asking in ENGLISH. You MUST respond 100% in ENGLISH.`;

    const prompt = `${this.getCategoryPrompt(category, language)}

${languageInstruction}

LỊCH SỬ HỘI THOẠI:
${this.getConversationHistory()}

CÂU HỎI HIỆN TẠI: ${userMessage}

YÊU CẦU PHẢN HỒI:
- Trả lời CHỈ bằng ${language === 'vi' ? 'TIẾNG VIỆT' : 'ENGLISH'}
- Sử dụng ngôn ngữ tự nhiên, đồng cảm
- Cung cấp thông tin y tế chính xác
- Luôn nhắc nhở tham khảo chuyên gia y tế
- Định dạng rõ ràng để dễ đọc`;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }

  private getCategoryPrompt(category: string, language: 'en' | 'vi'): string {
    const prompts = {
      cardiology: language === 'vi' 
        ? `TIM MẠCH - SỨC KHỎE TIM VÀ MẠCH MÁU
Giải thích các bệnh tim, triệu chứng, xét nghiệm và lối sống tốt cho tim.`
        : `CARDIOLOGY - HEART AND CARDIOVASCULAR HEALTH
Explain heart conditions, symptoms, tests, and heart-healthy lifestyle.`,

      dermatology: language === 'vi'
        ? `DA LIỄU - SỨC KHỎE DA, TÓC VÀ MÓNG
Giải thích các bệnh da, chăm sóc da và điều trị.`
        : `DERMATOLOGY - SKIN, HAIR, AND NAIL HEALTH
Explain skin conditions, skincare, and treatments.`,

      neurology: language === 'vi'
        ? `THẦN KINH - BỘ NÃO VÀ HỆ THẦN KINH
Giải thích các triệu chứng thần kinh, chức năng não và sức khỏe nhận thức.`
        : `NEUROLOGY - BRAIN AND NERVOUS SYSTEM
Explain neurological symptoms, brain function, and cognitive health.`,

      general: language === 'vi'
        ? `TỔNG QUÁT - TƯ VẤN Y TẾ CHUNG
Cung cấp thông tin y tế tổng quát và hướng dẫn chăm sóc sức khỏe cơ bản.`
        : `GENERAL - COMPREHENSIVE HEALTH CONSULTATION
Provide general medical information and basic healthcare guidance.`
    };

    return prompts[category as keyof typeof prompts] || prompts.general;
  }

  // ==================== UTILITY METHODS ====================

  private handleEmergencySituation(protocol: string, userMessage: string, language: 'en' | 'vi'): AIResponse {
    const emergencyProtocols = this.getEmergencyProtocols(language);
    const emergencyResponse = emergencyProtocols[protocol] || emergencyProtocols.cardiac_emergency;

    const suggestedActions = language === 'vi' 
      ? ['Gọi cấp cứu 115', 'Đến bệnh viện gần nhất', 'Liên hệ người thân']
      : ['Call emergency 115', 'Go to nearest hospital', 'Contact family member'];

    return {
      response: emergencyResponse,
      confidence: 0.95,
      suggestedActions,
      emergencyAlert: true,
      category: 'emergency',
      relatedSpecialties: ['Emergency Medicine'],
      language
    };
  }

  private analyzeResponse(responseText: string, category: string, language: 'en' | 'vi'): { confidence: number; suggestedActions: string[] } {
    let confidence = 0.7;
    const suggestedActions: string[] = [];

    // Confidence analysis
    const highConfidenceIndicators = language === 'vi'
      ? ['nghiên cứu cho thấy', 'nghiên cứu lâm sàng', 'dựa trên bằng chứng', 'hướng dẫn y khoa']
      : ['research shows', 'clinical studies', 'evidence-based', 'medical guidelines'];
    
    const cautionIndicators = language === 'vi'
      ? ['có thể', 'đôi khi', 'trong một số trường hợp', 'thường']
      : ['may be', 'could possibly', 'sometimes', 'in some cases'];

    if (highConfidenceIndicators.some(indicator => responseText.toLowerCase().includes(indicator))) {
      confidence = 0.85;
    }
    if (cautionIndicators.some(indicator => responseText.toLowerCase().includes(indicator))) {
      confidence = Math.min(confidence, 0.6);
    }

    // Suggested actions
    const actionMap = {
      vi: {
        doctor: 'Đặt lịch khám với bác sĩ',
        pharmacist: 'Tham khảo dược sĩ về thuốc',
        test: 'Thảo luận các xét nghiệm với bác sĩ',
        emergency: 'Tìm kiếm chăm sóc y tế ngay lập tức'
      },
      en: {
        doctor: 'Schedule appointment with doctor',
        pharmacist: 'Consult pharmacist about medications',
        test: 'Discuss testing options with doctor',
        emergency: 'Seek immediate medical attention'
      }
    };

    const actions = actionMap[language];

    if (responseText.toLowerCase().includes(language === 'vi' ? 'bác sĩ' : 'doctor')) {
      suggestedActions.push(actions.doctor);
    }
    if (responseText.toLowerCase().includes(language === 'vi' ? 'thuốc' : 'medication')) {
      suggestedActions.push(actions.pharmacist);
    }
    if (responseText.toLowerCase().includes(language === 'vi' ? 'xét nghiệm' : 'test')) {
      suggestedActions.push(actions.test);
    }
    if (responseText.toLowerCase().includes(language === 'vi' ? 'cấp cứu' : 'emergency')) {
      suggestedActions.push(actions.emergency);
    }

    return { confidence, suggestedActions };
  }

  private getRelatedSpecialties(category: string): string[] {
    const specialtyMap: { [key: string]: string[] } = {
      cardiology: ['Cardiology'],
      dermatology: ['Dermatology'],
      neurology: ['Neurology'],
      pediatrics: ['Pediatrics'],
      orthopedics: ['Orthopedics'],
      ophthalmology: ['Ophthalmology'],
      medications: ['All Specialties'],
      emergency: ['Emergency Medicine'],
      general: ['General Practice']
    };

    return specialtyMap[category] || ['General Practice'];
  }

  // ==================== HISTORY MANAGEMENT ====================

  private addToHistory(message: AIMessage): void {
    this.conversationHistory.push(message);
    
    // Maintain history length limit
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }

    // Clear cache if it gets too large
    if (this.languageCache.size > 100) this.languageCache.clear();
    if (this.categoryCache.size > 100) this.categoryCache.clear();
  }

  private getConversationHistory(): string {
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
    const prompt = `
    Cung cấp thông tin chi tiết về thuốc: ${medicationName}
    
    Bao gồm:
    1. Tên thương mại và tên generic
    2. Công dụng và chỉ định
    3. Liều dùng thông thường
    4. Tác dụng phụ thường gặp
    5. Chống chỉ định
    6. Tương tác thuốc quan trọng
    7. Lưu ý đặc biệt
    
    Trả lời bằng tiếng Việt, định dạng rõ ràng, dễ hiểu.
    `;

    const response = await this.generateAIResponse(prompt, 'medications', 'vi');
    
    return {
      name: medicationName,
      information: response,
      confidence: 0.85,
      lastUpdated: new Date().toISOString()
    };
  }

  public async explainMedicalTerm(term: string): Promise<TermExplanation> {
    const prompt = `
    Giải thích thuật ngữ y khoa: "${term}"
    
    Bao gồm:
    1. Định nghĩa đơn giản, dễ hiểu
    2. Giải thích chi tiết
    3. Ví dụ thực tế (nếu có)
    4. Liên quan đến bệnh lý nào
    5. Cách phát âm (nếu cần)
    
    Trả lời bằng tiếng Việt, sử dụng ngôn ngữ thông thường.
    `;

    const response = await this.generateAIResponse(prompt, 'general', 'vi');
    
    return {
      term,
      explanation: response,
      confidence: 0.9
    };
  }

  public async getLifestyleAdvice(topic: string): Promise<LifestyleAdvice> {
    const prompt = `
    Cung cấp lời khuyên về lối sống cho: ${topic}
    
    Bao gồm:
    1. Khuyến nghị về chế độ ăn uống
    2. Hoạt động thể chất phù hợp
    3. Thói quen sinh hoạt lành mạnh
    4. Cần tránh những gì
    5. Mẹo thực tế để áp dụng
    
    Trả lời bằng tiếng Việt, thực tế và dễ áp dụng.
    `;

    const response = await this.generateAIResponse(prompt, 'general', 'vi');
    
    return {
      topic,
      advice: response,
      confidence: 0.8,
      category: 'lifestyle'
    };
  }

  // ==================== PUBLIC METHODS ====================

  public clearHistory(): void {
    this.conversationHistory = [];
    this.languageCache.clear();
    this.categoryCache.clear();
  }

  public getHistory(): AIMessage[] {
    return [...this.conversationHistory];
  }

  public getAvailableSpecialties(): string[] {
    return [
      'Cardiology', 'Dermatology', 'Neurology', 'Pediatrics',
      'Orthopedics', 'Ophthalmology', 'Dentistry', 'Psychiatry',
      'Surgery', 'Gynecology', 'Endocrinology', 'Gastroenterology'
    ];
  }

  public getLastDetectedLanguage(): 'en' | 'vi' | null {
    if (this.conversationHistory.length === 0) return null;
    const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
    return lastMessage.language || null;
  }

  // ==================== ERROR HANDLING ====================

  private getFallbackResponse(language: 'en' | 'vi' = 'en'): AIResponse {
    if (language === 'vi') {
      return {
        response: `Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng:

1. Liên hệ trực tiếp với nhà cung cấp dịch vụ y tế của bạn
2. Gọi dịch vụ cấp cứu 115 nếu cần thiết
3. Đến cơ sở y tế gần nhất cho các vấn đề khẩn cấp

Chúng tôi sẽ giải quyết vấn đề này càng sớm càng tốt.`,
        confidence: 0.3,
        suggestedActions: ['Liên hệ nhà cung cấp dịch vụ y tế', 'Sử dụng dịch vụ cấp cứu nếu cần'],
        emergencyAlert: false,
        category: 'technical',
        language: 'vi'
      };
    } else {
      return {
        response: `I apologize, I'm experiencing technical difficulties. Please:

1. Contact your healthcare provider directly
2. Call emergency services (911/115) if needed
3. Visit the nearest medical facility for urgent concerns

We will resolve this issue as soon as possible.`,
        confidence: 0.3,
        suggestedActions: ['Contact healthcare provider', 'Use emergency services if needed'],
        emergencyAlert: false,
        category: 'technical',
        language: 'en'
      };
    }
  }
}