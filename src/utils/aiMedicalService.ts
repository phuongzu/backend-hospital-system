import Groq from 'groq-sdk';
import { config } from '../config/config';
import Specialty from '../models/specialty';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Review from '../models/review';
import { PatientProfileService } from './PatientProfileService';
import { SymptomTrackerService } from '../data/Symptomtracker';
import { auditLogger } from '../middlewares/SecurityMiddleware';
import { Types } from 'mongoose';
import { fetchDBContext, getAIDecision, AIDecision, DBContext } from './AIDecisionEngine';

// ==================== CORE TYPES ====================

export type Language = 'en' | 'vi';
export type MessageRole = 'user' | 'assistant';
export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

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
  emergencyContact?: { name: string; phone: string; relation: string };
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
  clinicalAssessment?: ClinicalAssessment;
  triageScore?: number;
  urgencyLevel?: UrgencyLevel;
  shouldAskBookingConfirmation?: boolean;
}

// ==================== CLINICAL ASSESSMENT ====================

export interface ClinicalAssessment {
  collectedSymptoms: CollectedSymptom[];
  urgencyLevel: UrgencyLevel;
  triageScore: number;
  redFlagsDetected: string[];
  probableDifferentials: string[];
  recommendedAction: RecommendedAction;
  assessmentComplete: boolean;
  riskFactors: string[];
  painScore?: number;
  vitalsConcern?: string[];
  symptomProgression?: 'worsening' | 'improving' | 'stable' | 'unknown';
}

export interface CollectedSymptom {
  name: string;
  severity?: number;
  duration?: string;
  location?: string;
  character?: string;
  aggravatingFactors?: string[];
  relievingFactors?: string[];
  associatedSymptoms?: string[];
}

export type RecommendedAction =
  | 'call_emergency'
  | 'urgent_appointment'
  | 'soon_appointment'
  | 'routine_appointment'
  | 'self_care'
  | 'more_info_needed';

// ==================== ASSESSMENT STATE MACHINE ====================

export type AssessmentPhase =
  | 'idle'
  | 'collecting_main_symptom'
  | 'collecting_duration'
  | 'collecting_severity'
  | 'collecting_location'
  | 'collecting_associated'
  | 'collecting_history'
  | 'assessing'
  | 'complete';

export interface AssessmentSession {
  phase: AssessmentPhase;
  symptomType: string;
  collectedSymptoms: CollectedSymptom[];
  currentSymptom: Partial<CollectedSymptom>;
  questionsAsked: string[];
  language: Language;
  turnCount: number;
  startedAt: Date;
  previousSymptoms?: string[];
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
  contraindications?: string[];
  bookingMessage?: string;
  emergencyInstructions?: string;
  awaitingBookingConfirmation?: boolean;
  bookingQuestion?: string;
  existingAppointmentDetails?: {
    date: string;
    time: string;
    doctorName?: string;
    specialty?: string;
    // FIX: Add specialtyId to compare against current request
    specialtyId?: string;
  };
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
  warnings?: string[];
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

// ==================== AUDIT LOG ====================

export interface AuditLogEntry {
  userId?: string;
  sessionId?: string;
  action:
  | 'chat_message'
  | 'appointment_booked'
  | 'emergency_triggered'
  | 'handoff_requested'
  | 'booking_confirmation_asked'
  | 'booking_confirmed'
  | 'booking_declined';
  userMessage?: string;
  aiResponse?: string;
  category?: string;
  urgencyLevel?: UrgencyLevel;
  emergencyAlert?: boolean;
  appointmentBooked?: boolean;
  timestamp: Date;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

// ==================== CONSTANTS ====================

const MAX_HISTORY_LENGTH = 20;
const MAX_REQUESTS_PER_MINUTE = 25;
const LANGUAGE_CACHE_MAX_SIZE = 100;
const QUOTA_COOLDOWN_MS = 3 * 60 * 1000;
const SPECIALTY_CACHE_TTL = 5 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 1500;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_ASSESSMENT_TURNS = 5;

const ALL_TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
];

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

// ==================== BOOKING INTENT KEYWORDS ====================

const BOOKING_CONFIRM_VI = [
  'có', 'ok', 'oke', 'okay', 'được', 'đồng ý', 'vâng', 'ừ', 'ừm', 'ừh',
  'muốn', 'đặt lịch', 'đặt thôi', 'đặt đi', 'đặt ngay', 'muốn đặt',
  'muốn khám', 'cho tôi đặt', 'hãy đặt', 'ok đặt', 'đặt cho tôi',
  'giúp tôi đặt', 'bạn đặt giúp', 'đặt lịch hộ tôi', 'tôi muốn đặt',
  'đặt cho mình', 'mình muốn', 'tôi đồng ý', 'tôi ok', 'được rồi',
  'thôi được', 'chắc vậy', 'khám thôi', 'thử khám', 'đặt luôn',
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'please',
  'book', 'book it', 'book now', 'schedule', 'schedule it', 'confirm',
  'go ahead', 'go for it', 'i want', 'i\'d like', 'let\'s book',
];

const BOOKING_DECLINE_VI = [
  'không', 'thôi', 'không cần', 'chưa', 'để sau', 'không muốn',
  'hôm khác', 'từ từ', 'không cần thiết', 'tự khỏi', 'chờ thêm',
  'no', 'nope', 'not now', 'later', 'maybe later', 'not yet',
  'no thanks', 'i\'ll pass', 'skip', 'don\'t need', 'no need',
];

const BOOKING_INQUIRY_VI = [
  'lịch hẹn', 'xem lịch', 'kiểm tra lịch', 'lịch khám', 'lịch đã đặt',
  'appointment', 'my appointment', 'check appointment', 'view appointment',
  'khi nào tôi có lịch', 'lịch của tôi',
];

// ==================== TRIAGE RULES ====================

interface TriageRule {
  patterns: { vi: string[]; en: string[] };
  score: number;
  redFlag: boolean;
  specialty?: string;
  category?: string;
}

const TRIAGE_RULES: TriageRule[] = [
  {
    patterns: {
      vi: ['ngừng tim', 'tim ngừng đập', 'bất tỉnh đột ngột', 'không có mạch', 'ngừng thở'],
      en: ['cardiac arrest', 'no pulse', 'sudden loss of consciousness', 'not breathing', 'stopped breathing'],
    },
    score: 100, redFlag: true, specialty: 'cardiology',
  },
  {
    patterns: {
      vi: ['nôn ra máu nhiều', 'chảy máu không cầm', 'xuất huyết nặng', 'mất máu nhiều'],
      en: ['vomiting blood profusely', 'uncontrolled bleeding', 'severe hemorrhage', 'massive blood loss'],
    },
    score: 95, redFlag: true, specialty: 'emergency',
  },
  {
    patterns: {
      vi: ['đột quỵ', 'méo miệng đột ngột', 'liệt nửa người', 'mất ý thức', 'co giật mạnh'],
      en: ['stroke', 'sudden facial drooping', 'hemiplegia', 'loss of consciousness', 'seizure'],
    },
    score: 95, redFlag: true, specialty: 'neurology',
  },
  {
    patterns: {
      vi: ['không thở được', 'tím tái', 'ngạt thở', 'khó thở cực nặng'],
      en: ['cannot breathe', 'cyanosis', 'choking', 'severe respiratory distress'],
    },
    score: 95, redFlag: true, specialty: 'pulmonology',
  },
  {
    patterns: {
      vi: ['đau ngực dữ dội', 'đau ngực lan xuống tay trái', 'nhồi máu cơ tim'],
      en: ['severe chest pain', 'chest pain radiating to left arm', 'heart attack', 'myocardial infarction'],
    },
    score: 95, redFlag: true, specialty: 'cardiology',
  },
  {
    patterns: {
      vi: ['đau ngực', 'tức ngực', 'tim đập loạn', 'nhịp tim không đều'],
      en: ['chest pain', 'chest tightness', 'irregular heartbeat', 'palpitations with chest pain'],
    },
    score: 80, redFlag: false, specialty: 'cardiology',
  },
  {
    patterns: {
      vi: ['sốt cao trên 39', 'sốt 40 độ', 'sốt không hạ', 'sốt kéo dài hơn 3 ngày'],
      en: ['fever above 39', 'fever 40 degrees', 'persistent high fever', 'fever for more than 3 days'],
    },
    score: 75, redFlag: false, specialty: 'internal_medicine',
  },
  {
    patterns: {
      vi: ['đau đầu dữ dội đột ngột', 'đau đầu tệ nhất đời'],
      en: ['sudden severe headache', 'worst headache of life', 'thunderclap headache'],
    },
    score: 85, redFlag: true, specialty: 'neurology',
  },
  {
    patterns: {
      vi: ['khó thở tăng dần', 'thở khò khè nặng', 'hen cấp'],
      en: ['worsening shortness of breath', 'severe wheezing', 'acute asthma', 'difficulty breathing'],
    },
    score: 78, redFlag: false, specialty: 'pulmonology',
  },
  {
    patterns: {
      vi: ['sốt xuất huyết', 'đau cơ', 'phát ban', 'chấm xuất huyết', 'nôn ra máu'],
      en: ['dengue', 'muscle pain', 'rash', 'petechiae', 'vomiting blood'],
    },
    score: 70, redFlag: false, specialty: 'infectious_disease',
  },
  {
    patterns: {
      vi: ['tay chân miệng', 'loét miệng', 'phỏng nước', 'sốt', 'trẻ em'],
      en: ['hand foot mouth', 'mouth ulcers', 'blisters', 'fever', 'children'],
    },
    score: 60, redFlag: false, specialty: 'pediatrics',
  },
  {
    patterns: {
      vi: ['đau kéo dài nhiều ngày', 'đau không giảm', 'đau 3 ngày', 'đau 5 ngày'],
      en: ['pain for several days', 'persistent pain', 'pain for 3 days', 'pain for a week'],
    },
    score: 60, redFlag: false,
  },
  {
    patterns: {
      vi: ['đau bụng dữ dội', 'bụng cứng', 'đau bụng không thuyên giảm'],
      en: ['severe abdominal pain', 'rigid abdomen', 'abdominal pain not relieved'],
    },
    score: 68, redFlag: false, specialty: 'gastroenterology',
  },
  {
    patterns: {
      vi: ['huyết áp cao', 'huyết áp 160', 'tăng huyết áp'],
      en: ['high blood pressure', 'hypertension', 'blood pressure 160'],
    },
    score: 58, redFlag: false, specialty: 'cardiology',
  },
  {
    patterns: {
      vi: ['đường huyết cao', 'tiểu đường mất kiểm soát', 'hạ đường huyết'],
      en: ['high blood sugar', 'uncontrolled diabetes', 'hypoglycemia'],
    },
    score: 62, redFlag: false, specialty: 'endocrinology',
  },
  {
    patterns: {
      vi: ['mệt mỏi kéo dài', 'kiệt sức không rõ nguyên nhân'],
      en: ['prolonged fatigue', 'chronic exhaustion', 'weeks of fatigue'],
    },
    score: 45, redFlag: false, specialty: 'internal_medicine',
  },
  {
    patterns: {
      vi: ['ho ra máu', 'ho kéo dài hơn 2 tuần'],
      en: ['coughing blood', 'cough lasting over 2 weeks'],
    },
    score: 65, redFlag: false, specialty: 'pulmonology',
  },
  {
    patterns: {
      vi: ['sụt cân không rõ nguyên nhân', 'gầy nhanh'],
      en: ['unexplained weight loss', 'rapid weight loss'],
    },
    score: 58, redFlag: false, specialty: 'oncology',
  },
  {
    patterns: {
      vi: ['cảm cúm', 'ho', 'sổ mũi', 'hắt hơi', 'đau họng', 'mệt mỏi'],
      en: ['flu', 'cough', 'runny nose', 'sneezing', 'sore throat', 'fatigue'],
    },
    score: 25, redFlag: false, specialty: 'internal_medicine',
  },
  {
    patterns: {
      vi: ['đau đầu nhẹ', 'nhức đầu nhẹ', 'đau đầu thoáng qua'],
      en: ['mild headache', 'slight headache', 'brief headache'],
    },
    score: 20, redFlag: false, specialty: 'neurology',
  },
  {
    patterns: {
      vi: ['hỏi thông tin', 'tư vấn', 'kiểm tra sức khỏe', 'tiêm chủng', 'khám định kỳ'],
      en: ['information inquiry', 'health check', 'vaccination', 'routine checkup', 'general advice'],
    },
    score: 10, redFlag: false,
  },
];

// ==================== RED FLAG COMBOS ====================

interface RedFlagCombo {
  symptoms: { vi: string[]; en: string[] }[];
  reason: { vi: string; en: string };
  escalateTo: UrgencyLevel;
  specialty?: string;
}

const RED_FLAG_COMBOS: RedFlagCombo[] = [
  {
    symptoms: [
      { vi: ['đau đầu'], en: ['headache'] },
      { vi: ['cứng cổ', 'gáy cứng'], en: ['stiff neck', 'neck stiffness'] },
      { vi: ['sốt'], en: ['fever'] },
    ],
    reason: { vi: 'Nguy cơ viêm màng não', en: 'Possible meningitis' },
    escalateTo: 'critical', specialty: 'neurology',
  },
  {
    symptoms: [
      { vi: ['đau ngực'], en: ['chest pain'] },
      { vi: ['khó thở'], en: ['shortness of breath'] },
      { vi: ['đổ mồ hôi'], en: ['sweating'] },
    ],
    reason: { vi: 'Nguy cơ nhồi máu cơ tim', en: 'Possible myocardial infarction' },
    escalateTo: 'critical', specialty: 'cardiology',
  },
  {
    symptoms: [
      { vi: ['đau bụng dữ dội'], en: ['severe abdominal pain'] },
      { vi: ['bụng cứng'], en: ['rigid abdomen'] },
      { vi: ['sốt'], en: ['fever'] },
    ],
    reason: { vi: 'Nguy cơ viêm phúc mạc', en: 'Possible peritonitis' },
    escalateTo: 'critical', specialty: 'surgery',
  },
];

// ==================== COMORBIDITY MULTIPLIERS ====================

const COMORBIDITY_MULTIPLIERS: Array<{
  conditions: string[];
  multiplier: number;
  note: { vi: string; en: string };
}> = [
    {
      conditions: ['đái tháo đường', 'tiểu đường', 'diabetes'],
      multiplier: 1.2,
      note: { vi: 'Tiểu đường làm tăng nguy cơ biến chứng', en: 'Diabetes increases complication risk' },
    },
    {
      conditions: ['tim mạch', 'bệnh tim', 'heart disease'],
      multiplier: 1.3,
      note: { vi: 'Bệnh tim làm tăng nguy cơ đáng kể', en: 'Heart disease significantly increases risk' },
    },
    {
      conditions: ['cao huyết áp', 'tăng huyết áp', 'hypertension'],
      multiplier: 1.15,
      note: { vi: 'Huyết áp cao là yếu tố nguy cơ tim mạch', en: 'Hypertension is a cardiovascular risk factor' },
    },
    {
      conditions: ['ung thư', 'cancer', 'hóa trị'],
      multiplier: 1.4,
      note: { vi: 'Bệnh nhân ung thư cần theo dõi sát', en: 'Cancer patients require close monitoring' },
    },
    {
      conditions: ['suy thận', 'kidney failure'],
      multiplier: 1.35,
      note: { vi: 'Suy thận làm giảm khả năng thải độc', en: 'Kidney failure impairs toxin clearance' },
    },
    {
      conditions: ['hiv', 'aids', 'suy giảm miễn dịch', 'immunocompromised'],
      multiplier: 1.35,
      note: { vi: 'Suy giảm miễn dịch tăng nguy cơ nhiễm trùng', en: 'Immunocompromised state increases infection risk' },
    },
    {
      conditions: ['có thai', 'mang thai', 'pregnant', 'pregnancy'],
      multiplier: 1.25,
      note: { vi: 'Phụ nữ mang thai cần đánh giá đặc biệt', en: 'Pregnant patients require special evaluation' },
    },
  ];

const getAgeRiskMultiplier = (age?: number): number => {
  if (!age) return 1.0;
  if (age < 2) return 1.5;
  if (age < 12) return 1.2;
  if (age > 80) return 1.4;
  if (age > 65) return 1.25;
  return 1.0;
};

const PAIN_SCORE_REGEX =
  /(?:đau|pain|mức độ|intensity|score)\s*(?:khoảng|about|around)?\s*(\d{1,2})\s*(?:\/10|trên 10|out of 10)?/i;

const DURATION_PATTERNS = {
  vi: /(\d+)\s*(phút|giờ|ngày|tuần|tháng|năm)/i,
  en: /(\d+)\s*(minute|hour|day|week|month|year)/i,
};

const PROGRESSION_PATTERNS = {
  worsening: {
    vi: ['nặng hơn', 'tăng lên', 'dữ dội hơn', 'không đỡ', 'càng ngày càng'],
    en: ['worse', 'increasing', 'more severe', 'not better', 'getting worse'],
  },
  improving: {
    vi: ['đỡ hơn', 'nhẹ hơn', 'giảm', 'bớt', 'khá hơn'],
    en: ['better', 'improving', 'less', 'decreasing', 'relieved'],
  },
  stable: {
    vi: ['không đổi', 'vẫn vậy', 'như cũ', 'ổn định'],
    en: ['same', 'unchanged', 'stable', 'no change'],
  },
};

// ==================== URGENCY ROUTING ====================

const URGENCY_ROUTING: Record<
  UrgencyLevel,
  { vi: string; en: string; timeframe: { vi: string; en: string } }
> = {
  critical: {
    vi: '🚨 Tình trạng có thể nguy hiểm đến tính mạng. GỌI 115 NGAY!',
    en: '🚨 Condition may be life-threatening. CALL 911/115 NOW!',
    timeframe: { vi: 'Ngay lập tức', en: 'Immediately' },
  },
  high: {
    vi: '⚠️ Cần khám bác sĩ trong vòng **24 giờ**. Đừng trì hoãn.',
    en: '⚠️ See a doctor within **24 hours**. Do not delay.',
    timeframe: { vi: 'Trong 24 giờ', en: 'Within 24 hours' },
  },
  medium: {
    vi: '📋 Nên đặt lịch khám **trong 2–3 ngày** tới để được đánh giá chính xác.',
    en: '📋 Schedule an appointment **within 2–3 days** for proper evaluation.',
    timeframe: { vi: 'Trong 2-3 ngày', en: 'Within 2-3 days' },
  },
  low: {
    vi: '📅 Nên đặt lịch khám định kỳ **trong tuần này** để chắc chắn hơn.',
    en: '📅 Schedule a routine checkup **this week** for peace of mind.',
    timeframe: { vi: 'Trong tuần này', en: 'Within this week' },
  },
};

// ==================== ASSESSMENT QUESTIONS ====================

interface AssessmentQuestion {
  phase: AssessmentPhase;
  question: { vi: string; en: string };
}

const ASSESSMENT_QUESTIONS: Record<string, AssessmentQuestion[]> = {
  general: [
    {
      phase: 'collecting_duration',
      question: {
        vi: 'Triệu chứng này bắt đầu từ khi nào? (ví dụ: 2 giờ trước, 3 ngày, 1 tuần)',
        en: 'When did this symptom start? (e.g., 2 hours ago, 3 days ago, 1 week)',
      },
    },
    {
      phase: 'collecting_severity',
      question: {
        vi: 'Trên thang điểm 1–10, mức độ khó chịu là bao nhiêu? (1 = rất nhẹ, 10 = không chịu được)',
        en: 'On a scale of 1–10, how severe is your discomfort? (1 = very mild, 10 = unbearable)',
      },
    },
    {
      phase: 'collecting_associated',
      question: {
        vi: 'Có triệu chứng nào khác đi kèm không? (sốt, buồn nôn, chóng mặt, khó thở...)',
        en: 'Any other symptoms? (fever, nausea, dizziness, shortness of breath...)',
      },
    },
    {
      phase: 'collecting_history',
      question: {
        vi: 'Trước đây bạn có từng gặp triệu chứng tương tự không?',
        en: 'Have you experienced similar symptoms before?',
      },
    },
  ],
  headache: [
    {
      phase: 'collecting_location',
      question: {
        vi: 'Đau đầu ở vị trí nào? (trán, thái dương, sau gáy, toàn đầu, hay một bên?)',
        en: 'Where is the headache? (forehead, temples, back of head, whole head, or one side?)',
      },
    },
    {
      phase: 'collecting_severity',
      question: {
        vi: 'Mức độ đau 1–10? Khởi phát đột ngột hay từ từ? Có nhạy cảm ánh sáng/tiếng ồn không?',
        en: 'Pain score 1–10? Did it come on suddenly or gradually? Any light/noise sensitivity?',
      },
    },
  ],
  abdominal: [
    {
      phase: 'collecting_location',
      question: {
        vi: 'Đau ở vùng nào của bụng? (trên rốn, dưới rốn, hố chậu phải/trái?)',
        en: 'Where exactly? (upper, lower, right or left lower quadrant?)',
      },
    },
    {
      phase: 'collecting_associated',
      question: {
        vi: 'Có kèm sốt, nôn, tiêu chảy, táo bón, hoặc phân/nước tiểu bất thường không?',
        en: 'Any fever, vomiting, diarrhea, constipation, or abnormal stool/urine?',
      },
    },
  ],
  chest: [
    {
      phase: 'collecting_location',
      question: {
        vi: 'Đau ở vị trí nào trong ngực? Có lan ra tay trái, hàm, hoặc lưng không?',
        en: 'Where in the chest? Does it radiate to the left arm, jaw, or back?',
      },
    },
    {
      phase: 'collecting_associated',
      question: {
        vi: 'Có kèm khó thở, đổ mồ hôi, buồn nôn, hoặc hồi hộp không?',
        en: 'Any shortness of breath, sweating, nausea, or palpitations?',
      },
    },
  ],
  fever: [
    {
      phase: 'collecting_duration',
      question: {
        vi: 'Sốt được bao lâu rồi? Nhiệt độ cao nhất là bao nhiêu?',
        en: 'How long have you had the fever? What was the highest temperature?',
      },
    },
    {
      phase: 'collecting_associated',
      question: {
        vi: 'Có kèm theo ớn lạnh, đau người, phát ban, hoặc các triệu chứng khác không?',
        en: 'Any chills, body aches, rash, or other symptoms?',
      },
    },
  ],
};

// ==================== EMERGENCY KEYWORDS ====================

type EmergencyProtocol =
  | 'cardiac_emergency'
  | 'stroke_emergency'
  | 'respiratory_emergency'
  | 'psychiatric_emergency';

const EMERGENCY_KEYWORDS: Record<EmergencyProtocol, string[]> = {
  cardiac_emergency: [
    'chest pain', 'đau ngực', 'heart pain', 'đau tim',
    'heart attack', 'nhồi máu cơ tim', 'đau ngực dữ dội', 'cardiac arrest', 'ngừng tim',
  ],
  stroke_emergency: [
    'facial drooping', 'mặt xệ', 'méo miệng', 'arm weakness', 'tay yếu',
    'liệt tay', 'speech difficulty', 'nói khó', 'nói ngọng',
    'sudden numbness', 'tê liệt đột ngột', 'đột quỵ', 'stroke',
  ],
  respiratory_emergency: [
    'breathing difficulty', 'khó thở nặng', 'choking', 'ngạt thở',
    'không thở được', 'cannot breathe', 'tím tái',
  ],
  psychiatric_emergency: [
    'muốn tự tử', 'không muốn sống', 'tự làm đau', 'suicidal',
    'want to die', 'kill myself', 'end my life', 'self harm', 'ý định tự hại',
  ],
};

// ==================== EMERGENCY PROTOCOLS ====================

const EMERGENCY_PROTOCOLS: Record<Language, Record<EmergencyProtocol, string>> = {
  vi: {
    cardiac_emergency: `🚨 **CẤP CỨU TIM MẠCH — HÀNH ĐỘNG NGAY LẬP TỨC!**

1. 🚑 **GỌI CẤP CỨU 115 NGAY** — Đừng chờ đợi
2. 🏥 Đến bệnh viện có **Khoa Tim Mạch** gần nhất
3. 💊 **Nằm yên**, tránh mọi vận động mạnh
4. 📞 Thông báo cho người thân ngay lập tức
5. 🚫 **Tuyệt đối không tự lái xe**

⚠️ Nếu có Aspirin và không dị ứng, nhai 1 viên 325mg trong khi chờ.

⚕️ Đây là tình huống y tế khẩn cấp. Hành động ngay!`,
    stroke_emergency: `🚨 **CẤP CỨU ĐỘT QUỴ — THỜI GIAN LÀ BỘ NÃO!**

Nhớ quy tắc **FAST**:
- 🗣️ **F** — FACE: Miệng có bị lệch không?
- 💪 **A** — ARMS: Giơ cả hai tay — có tay nào yếu/rơi xuống không?
- 🗨️ **S** — SPEECH: Nói có ngọng không?
- ⏰ **T** — TIME: **GỌI 115 NGAY!**

⚠️ **Cửa sổ vàng là 4.5 giờ** — điều trị càng sớm càng tốt!`,
    respiratory_emergency: `🚨 **CẤP CỨU HÔ HẤP — NGUY CẤP!**

1. 🚑 **GỌI 115 NGAY**
2. 💨 Giữ đường thở thông thoáng — ngẩng đầu nhẹ
3. 🪑 Để ngồi tư thế thoải mái (không nằm)
4. 🌬️ Nếu có thuốc xịt hen → xịt ngay
5. 🚪 Mở cửa sổ, tạo không khí thông thoáng

⚠️ KHÔNG để một mình — ở cạnh đến khi cấp cứu đến!`,
    psychiatric_emergency: `🚨 **HỖ TRỢ SỨC KHỎE TÂM THẦN KHẨN CẤP**

Tôi rất lo lắng cho bạn. Bạn không phải một mình.

📞 **Gọi ngay:**
- Đường dây hỗ trợ tâm lý: **1800 599 920** (miễn phí)
- Cấp cứu: **115**
- Hoặc đến khoa Tâm Thần bệnh viện gần nhất

💙 Xin hãy nói chuyện với ai đó ngay bây giờ.`,
  },
  en: {
    cardiac_emergency: `🚨 **CARDIAC EMERGENCY — IMMEDIATE ACTION REQUIRED!**

1. 🚑 **CALL 911/115 NOW** — Do not wait
2. 🏥 Go to nearest hospital with **Cardiac Unit**
3. 💊 **Lie down**, avoid physical exertion
4. 📞 Notify family immediately
5. 🚫 **DO NOT drive yourself**

⚠️ If you have Aspirin and are not allergic, chew 1 tablet (325mg) while waiting.

⚕️ This is a medical emergency. Act now!`,
    stroke_emergency: `🚨 **STROKE EMERGENCY — TIME IS BRAIN!**

Remember **FAST**:
- 🗣️ **F** — FACE drooping?
- 💪 **A** — ARMS: can you raise both equally?
- 🗨️ **S** — SPEECH slurred?
- ⏰ **T** — TIME: **CALL 911/115 NOW!**

⚠️ **Golden window is 4.5 hours** — earlier treatment = better outcome!`,
    respiratory_emergency: `🚨 **RESPIRATORY EMERGENCY — CRITICAL!**

1. 🚑 **CALL 911/115 NOW**
2. 💨 Keep airway clear — tilt head slightly back
3. 🪑 Sit upright (do not lie flat)
4. 🌬️ Use inhaler if available
5. 🚪 Open windows for fresh air

⚠️ Stay with the person until help arrives!`,
    psychiatric_emergency: `🚨 **MENTAL HEALTH CRISIS SUPPORT**

I am very concerned about you. You are not alone.

📞 **Call now:**
- Crisis Lifeline: **988**
- Emergency: **911/115**

💙 Please talk to someone right now — you deserve support.`,
  },
};

// ==================== FALLBACK RESPONSES ====================

type FallbackKey = 'general' | 'cardiology' | 'emergency' | 'medications';

const FALLBACK_RESPONSES: Record<Language, Record<FallbackKey, string>> = {
  vi: {
    general: `Xin lỗi, dịch vụ AI tạm thời không khả dụng.\n\n⚠️ Vui lòng tham khảo bác sĩ chuyên khoa.\nNếu có triệu chứng nghiêm trọng, gọi 115 ngay.\n\n⚕️ Thông tin này chỉ mang tính giáo dục.`,
    cardiology: `Về vấn đề tim mạch:\n⚠️ Hãy đặt lịch khám tim mạch ngay.\n🚨 Gọi 115 nếu: Đau ngực dữ dội, Khó thở nặng.\n\n⚕️ Thông tin này chỉ mang tính giáo dục.`,
    emergency: `🚨 GỌI CẤP CỨU 115 NGAY LẬP TỨC!\n🏥 ĐẾN BỆNH VIỆN GẦN NHẤT`,
    medications: `⚠️ Tham khảo dược sĩ hoặc bác sĩ về thuốc.\n\n⚕️ Thông tin này chỉ mang tính giáo dục.`,
  },
  en: {
    general: `AI service is temporarily unavailable.\n\n⚠️ Please consult a qualified doctor.\nFor severe symptoms, call 911/115 immediately.\n\n⚕️ Educational purposes only.`,
    cardiology: `Regarding cardiac concern:\n⚠️ Schedule a cardiology appointment.\n🚨 Call 911/115 for severe chest pain.\n\n⚕️ Educational purposes only.`,
    emergency: `🚨 CALL 911/115 IMMEDIATELY!\n🏥 GO TO NEAREST HOSPITAL`,
    medications: `⚠️ Consult a pharmacist or doctor about medications.\n\n⚕️ Educational purposes only.`,
  },
};

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
    await this.loadSpecialties();
    const normalizedMsg = message.normalize('NFC').toLowerCase();
    let best = { category: 'general', specialtyId: undefined as string | undefined, score: 0 };

    for (const [id, spec] of this.specialties) {
      let score = 0;
      for (const kw of spec.keywords) {
        try {
          const escapedKw = kw.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const rx = new RegExp(`(?<![\\p{L}\\p{N}])${escapedKw}(?![\\p{L}\\p{N}])`, 'iu');
          if (rx.test(normalizedMsg)) score += 2;
        } catch {
          if (normalizedMsg.includes(kw.normalize('NFC').toLowerCase())) score++;
        }
      }
      if (score > best.score)
        best = { category: spec.category, specialtyId: id, score };
    }

    return { category: best.category, specialtyId: best.specialtyId };
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
      return language === 'vi'
        ? 'Chuyên khoa: TỔNG QUÁT. Cung cấp tư vấn y tế toàn diện.'
        : 'Specialty: GENERAL MEDICINE. Provide comprehensive medical information.';
    }
    const spec = await this.getSpecialtyById(specialtyId);
    if (!spec)
      return language === 'vi' ? 'Chuyên khoa: Y HỌC TỔNG QUÁT' : 'Specialty: GENERAL MEDICINE';
    return language === 'vi'
      ? `Chuyên khoa: ${spec.name.toUpperCase()}. Tư vấn về ${spec.name.toLowerCase()}.`
      : `Specialty: ${spec.name.toUpperCase()}. Providing information about ${spec.name.toLowerCase()}.`;
  }
}

// ==================== CLINICAL TRIAGE ENGINE ====================

class ClinicalTriageEngine {
  static score(
    text: string,
    language: Language,
    patientProfile?: PatientProfile | null
  ): {
    score: number;
    redFlags: string[];
    matchedRules: TriageRule[];
    suggestedSpecialty?: string;
    riskFactors: string[];
    redFlagCombo?: RedFlagCombo;
    symptomProgression?: 'worsening' | 'improving' | 'stable' | 'unknown';
  } {
    const normalized = text.normalize('NFC').toLowerCase();
    const redFlags: string[] = [];
    const matchedRules: TriageRule[] = [];
    let baseScore = 0;
    let topSpecialty: string | undefined;
    let topScore = 0;

    let symptomProgression: 'worsening' | 'improving' | 'stable' | 'unknown' = 'unknown';
    if (PROGRESSION_PATTERNS.worsening.vi.some(p => normalized.includes(p)) ||
      PROGRESSION_PATTERNS.worsening.en.some(p => normalized.includes(p))) {
      symptomProgression = 'worsening';
      baseScore += 5;
    } else if (PROGRESSION_PATTERNS.improving.vi.some(p => normalized.includes(p)) ||
      PROGRESSION_PATTERNS.improving.en.some(p => normalized.includes(p))) {
      symptomProgression = 'improving';
    } else if (PROGRESSION_PATTERNS.stable.vi.some(p => normalized.includes(p)) ||
      PROGRESSION_PATTERNS.stable.en.some(p => normalized.includes(p))) {
      symptomProgression = 'stable';
    }

    for (const rule of TRIAGE_RULES) {
      const allPatterns = [...rule.patterns.vi, ...rule.patterns.en];
      const matched = allPatterns.some(p =>
        normalized.includes(p.normalize('NFC').toLowerCase())
      );

      if (matched) {
        matchedRules.push(rule);
        if (rule.score > baseScore) baseScore = rule.score;
        if (rule.redFlag) {
          const ruleKey = rule.specialty ?? 'emergency';
          if (!redFlags.includes(ruleKey)) redFlags.push(ruleKey);
        }
        if (rule.specialty && rule.score > topScore) {
          topScore = rule.score;
          topSpecialty = rule.specialty;
        }
      }
    }

    let redFlagCombo: RedFlagCombo | undefined;
    for (const combo of RED_FLAG_COMBOS) {
      const allMatch = combo.symptoms.every(sg =>
        [...sg.vi, ...sg.en].some(w => normalized.includes(w.normalize('NFC').toLowerCase()))
      );
      if (allMatch) {
        redFlagCombo = combo;
        const reason = language === 'vi' ? combo.reason.vi : combo.reason.en;
        if (!redFlags.includes(reason)) redFlags.push(reason);
        baseScore = Math.max(baseScore, combo.escalateTo === 'critical' ? 95 : 82);
        if (combo.specialty) topSpecialty = combo.specialty;
        break;
      }
    }

    const painMatch = PAIN_SCORE_REGEX.exec(text);
    if (painMatch) {
      const painScore = parseInt(painMatch[1], 10);
      if (painScore >= 8) baseScore = Math.max(baseScore, 75);
      else if (painScore >= 6) baseScore = Math.max(baseScore, 55);
    }

    const riskFactors: string[] = [];
    if (patientProfile) {
      const allConditions = [
        ...patientProfile.chronicConditions,
        ...patientProfile.recentDiagnoses,
        ...patientProfile.currentMedications,
      ].map(c => c.toLowerCase());

      for (const cm of COMORBIDITY_MULTIPLIERS) {
        if (cm.conditions.some(c => allConditions.some(pc => pc.includes(c)))) {
          baseScore = Math.min(100, Math.round(baseScore * cm.multiplier));
          const note = language === 'vi' ? cm.note.vi : cm.note.en;
          if (!riskFactors.includes(note)) riskFactors.push(note);
        }
      }

      const ageMult = getAgeRiskMultiplier(patientProfile.age);
      if (ageMult > 1.0) {
        baseScore = Math.min(100, Math.round(baseScore * ageMult));
        const ageNote =
          language === 'vi'
            ? `Tuổi ${patientProfile.age} là yếu tố nguy cơ`
            : `Age ${patientProfile.age} is a risk factor`;
        riskFactors.push(ageNote);
      }
    }

    return {
      score: Math.min(100, baseScore),
      redFlags,
      matchedRules,
      suggestedSpecialty: topSpecialty,
      riskFactors,
      redFlagCombo,
      symptomProgression,
    };
  }

  static scoreToUrgency(score: number): UrgencyLevel {
    if (score >= 90) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  static extractDifferentials(matchedRules: TriageRule[], language: Language): string[] {
    const specialties = [
      ...new Set(matchedRules.map(r => r.specialty).filter(Boolean) as string[]),
    ];
    const map: Record<string, { vi: string; en: string }> = {
      cardiology: { vi: 'Vấn đề tim mạch', en: 'Cardiac condition' },
      neurology: { vi: 'Vấn đề thần kinh', en: 'Neurological condition' },
      gastroenterology: { vi: 'Vấn đề tiêu hóa', en: 'Digestive condition' },
      pulmonology: { vi: 'Vấn đề hô hấp', en: 'Respiratory condition' },
      endocrinology: { vi: 'Vấn đề nội tiết', en: 'Endocrine condition' },
      orthopedics: { vi: 'Vấn đề cơ xương khớp', en: 'Musculoskeletal condition' },
      psychiatry: { vi: 'Vấn đề sức khỏe tâm thần', en: 'Mental health condition' },
      oncology: { vi: 'Cần loại trừ bệnh lý ác tính', en: 'Malignancy to be ruled out' },
      urology: { vi: 'Vấn đề tiết niệu', en: 'Urological condition' },
      surgery: { vi: 'Có thể cần can thiệp phẫu thuật', en: 'Possible surgical intervention' },
      internal_medicine: { vi: 'Bệnh lý nội khoa', en: 'Internal medicine condition' },
      infectious_disease: { vi: 'Bệnh truyền nhiễm', en: 'Infectious disease' },
      pediatrics: { vi: 'Vấn đề nhi khoa', en: 'Pediatric condition' },
    };
    return specialties.map(s =>
      map[s] ? (language === 'vi' ? map[s].vi : map[s].en) : s
    );
  }

  static extractPainScore(text: string): number | undefined {
    const m = PAIN_SCORE_REGEX.exec(text);
    if (!m) return undefined;
    const v = parseInt(m[1], 10);
    return v >= 1 && v <= 10 ? v : undefined;
  }

  static extractDuration(text: string, language: Language): string | undefined {
    const rx = language === 'vi' ? DURATION_PATTERNS.vi : DURATION_PATTERNS.en;
    const m = rx.exec(text);
    return m ? `${m[1]} ${m[2]}` : undefined;
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
    const cached = this.languageCache.get(message);
    if (cached) return cached;
    if (VIETNAMESE_CHAR_REGEX.test(message)) return this.setCachedLang(message, 'vi');
    const lower = message.normalize('NFC').toLowerCase();
    const vi = VIETNAMESE_KEYWORDS.filter(kw => lower.includes(kw)).length;
    const en = ENGLISH_KEYWORDS.filter(kw => lower.includes(kw)).length;
    return this.setCachedLang(message, vi > en ? 'vi' : 'en');
  }

  private setCachedLang(msg: string, lang: Language): Language {
    if (this.languageCache.size >= LANGUAGE_CACHE_MAX_SIZE) this.languageCache.clear();
    this.languageCache.set(msg, lang);
    return lang;
  }

  // ==================== BOOKING INTENT DETECTION ====================

  private detectBookingIntent(message: string): 'confirm' | 'decline' | 'inquiry' | 'neutral' {
    const lower = message.normalize('NFC').toLowerCase().trim();

    const isInquiry = BOOKING_INQUIRY_VI.some(kw => lower.includes(kw));
    if (isInquiry) return 'inquiry';

    const isDecline = BOOKING_DECLINE_VI.some(kw => lower === kw || lower.includes(kw));
    if (isDecline) return 'decline';

    const isConfirm = BOOKING_CONFIRM_VI.some(kw =>
      lower === kw ||
      lower.startsWith(kw + ' ') ||
      lower.endsWith(' ' + kw) ||
      lower.includes(' ' + kw + ' ')
    );
    if (isConfirm) return 'confirm';

    return 'neutral';
  }

  // ==================== HANDLE BOOKING INQUIRY ====================

  private async handleBookingInquiry(userId?: string, language: Language = 'vi'): Promise<AIResponse | null> {
    if (!userId) return null;

    try {
      const upcomingAppointments = await Appointment.find({
        user_id: userId,
        appointment_date: { $gte: new Date() },
        status: { $in: ['pending', 'confirmed'] },
      })
        .populate('doctor_id', 'name')
        .populate('specialty_id', 'name')
        .sort({ appointment_date: 1 })
        .limit(5);

      if (upcomingAppointments.length === 0) {
        return {
          response: language === 'vi'
            ? 'Bạn hiện không có lịch hẹn nào sắp tới. Bạn có muốn tôi giúp bạn đặt lịch khám không?'
            : 'You don\'t have any upcoming appointments. Would you like me to help you book one?',
          confidence: 0.95,
          category: 'booking_inquiry',
          language,
          shouldAskBookingConfirmation: true,
          appointmentRecommendation: {
            shouldBook: false,
            urgencyLevel: 'low',
            symptoms: [],
            awaitingBookingConfirmation: true,
            bookingQuestion: language === 'vi'
              ? 'Bạn có muốn đặt lịch khám không?'
              : 'Would you like to book an appointment?',
          },
        };
      }

      const appointmentList = upcomingAppointments.map((apt, index) => {
        const doctorName = (apt as any).doctor_id?.name || 'Bác sĩ';
        const specialtyName = (apt as any).specialty_id?.name || 'Chuyên khoa';
        const date = new Date(apt.appointment_date).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-US');
        return `${index + 1}. 📅 ${date} lúc ${apt.time_slot} - ${specialtyName} (Bs. ${doctorName})`;
      }).join('\n');

      return {
        response: language === 'vi'
          ? `Bạn có ${upcomingAppointments.length} lịch hẹn sắp tới:\n\n${appointmentList}\n\nBạn cần hỗ trợ gì thêm không?`
          : `You have ${upcomingAppointments.length} upcoming appointments:\n\n${appointmentList}\n\nDo you need any other assistance?`,
        confidence: 0.95,
        category: 'booking_inquiry',
        language,
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

  // ==================== ASSESSMENT STATE MACHINE ====================

  private detectSymptomType(message: string): string | null {
    const lower = message.normalize('NFC').toLowerCase();
    const typeMap: Array<{ type: string; vi: string[]; en: string[] }> = [
      {
        type: 'chest',
        vi: ['đau ngực', 'tức ngực', 'nặng ngực', 'tim đau'],
        en: ['chest pain', 'chest tightness', 'heart pain'],
      },
      {
        type: 'headache',
        vi: ['đau đầu', 'nhức đầu', 'đau nửa đầu'],
        en: ['headache', 'head pain', 'migraine'],
      },
      {
        type: 'abdominal',
        vi: ['đau bụng', 'bụng đau', 'đau dạ dày'],
        en: ['stomach ache', 'abdominal pain', 'belly pain', 'stomach pain'],
      },
      {
        type: 'fever',
        vi: ['sốt', 'nóng', 'cảm'],
        en: ['fever', 'temperature', 'hot'],
      },
      {
        type: 'general',
        vi: ['mệt mỏi', 'mệt', 'chóng mặt', 'buồn nôn'],
        en: ['tired', 'fatigue', 'dizzy', 'nausea'],
      },
    ];
    for (const entry of typeMap) {
      if (
        [...entry.vi, ...entry.en].some(k =>
          lower.includes(k.normalize('NFC').toLowerCase())
        )
      ) {
        return entry.type;
      }
    }
    return null;
  }

  private startAssessmentSession(symptomType: string, language: Language): void {
    this.assessmentSession = {
      phase: 'collecting_main_symptom',
      symptomType,
      collectedSymptoms: [],
      currentSymptom: { name: symptomType },
      questionsAsked: [],
      language,
      turnCount: 0,
      startedAt: new Date(),
      previousSymptoms: this.collectPreviousSymptoms(),
    };
  }

  private collectPreviousSymptoms(): string[] {
    return this.conversationHistory
      .filter(m => m.role === 'user')
      .slice(-4)
      .map(m => m.content);
  }

  private advanceAssessment(userMessage: string): void {
    if (!this.assessmentSession) return;
    const sess = this.assessmentSession;
    sess.turnCount++;
    this.accumulatedSymptomText += ' ' + userMessage;

    sess.previousSymptoms = this.collectPreviousSymptoms();

    const duration = ClinicalTriageEngine.extractDuration(userMessage, sess.language);
    if (duration) sess.currentSymptom.duration = duration;

    const painScore = ClinicalTriageEngine.extractPainScore(userMessage);
    if (painScore) sess.currentSymptom.severity = painScore;

    const locationPatterns = {
      vi: ['đầu', 'ngực', 'bụng', 'lưng', 'tay', 'chân', 'cổ', 'vai'],
      en: ['head', 'chest', 'stomach', 'back', 'arm', 'leg', 'neck', 'shoulder'],
    };
    const allLocations = [...locationPatterns.vi, ...locationPatterns.en];
    const detectedLocation = allLocations.find(loc =>
      userMessage.toLowerCase().includes(loc)
    );
    if (detectedLocation) {
      sess.currentSymptom.location = detectedLocation;
    }

    const phaseOrder: AssessmentPhase[] = [
      'collecting_main_symptom',
      'collecting_duration',
      'collecting_severity',
      'collecting_location',
      'collecting_associated',
      'collecting_history',
      'assessing',
    ];
    const currentIdx = phaseOrder.indexOf(sess.phase);
    if (currentIdx >= 0 && currentIdx < phaseOrder.length - 1) {
      sess.phase = phaseOrder[currentIdx + 1];
    }

    if (sess.turnCount >= MAX_ASSESSMENT_TURNS) {
      sess.phase = 'assessing';
    }
  }

  private getNextAssessmentQuestion(language: Language): string | null {
    if (!this.assessmentSession) return null;
    const sess = this.assessmentSession;
    if (sess.phase === 'assessing' || sess.phase === 'complete') return null;

    const questions =
      ASSESSMENT_QUESTIONS[sess.symptomType] || ASSESSMENT_QUESTIONS.general;
    const targetQuestion = questions.find(q => q.phase === sess.phase);
    if (!targetQuestion) return null;

    const q = language === 'vi' ? targetQuestion.question.vi : targetQuestion.question.en;
    if (sess.questionsAsked.includes(q)) return null;
    sess.questionsAsked.push(q);
    return q;
  }

  private isAssessmentReadyToComplete(): boolean {
    if (!this.assessmentSession) return false;
    return (
      this.assessmentSession.phase === 'assessing' ||
      this.assessmentSession.turnCount >= MAX_ASSESSMENT_TURNS
    );
  }

  // ==================== CLINICAL ASSESSMENT BUILDER ====================

  private buildClinicalAssessment(language: Language): ClinicalAssessment {
    const fullText =
      this.accumulatedSymptomText ||
      this.conversationHistory
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join(' ');

    const triage = ClinicalTriageEngine.score(fullText, language, this.patientProfile);
    let urgencyLevel = ClinicalTriageEngine.scoreToUrgency(triage.score);
    const differentials = ClinicalTriageEngine.extractDifferentials(triage.matchedRules, language);
    const painScore = ClinicalTriageEngine.extractPainScore(fullText);

    let symptomProgression: 'worsening' | 'improving' | 'stable' | 'unknown' = triage.symptomProgression || 'unknown';

    if (symptomProgression === 'unknown' && this.assessmentSession?.previousSymptoms) {
      const lastSymptoms = this.assessmentSession.previousSymptoms.join(' ').toLowerCase();
      if (PROGRESSION_PATTERNS.worsening.vi.some(p => lastSymptoms.includes(p)) ||
        PROGRESSION_PATTERNS.worsening.en.some(p => lastSymptoms.includes(p))) {
        symptomProgression = 'worsening';
      }
    }

    const collectedSymptoms: CollectedSymptom[] =
      this.assessmentSession?.collectedSymptoms.length
        ? this.assessmentSession.collectedSymptoms
        : [{ name: this.assessmentSession?.symptomType ?? 'unknown' }];

    let recommendedAction: RecommendedAction;
    if (urgencyLevel === 'critical') recommendedAction = 'call_emergency';
    else if (urgencyLevel === 'high') recommendedAction = 'urgent_appointment';
    else if (urgencyLevel === 'medium') recommendedAction = 'soon_appointment';
    else if (triage.score < 15) recommendedAction = 'self_care';
    else recommendedAction = 'routine_appointment';

    if (symptomProgression === 'worsening' && urgencyLevel !== 'critical') {
      if (urgencyLevel === 'low') {
        urgencyLevel = 'medium';
        recommendedAction = 'soon_appointment';
      } else if (urgencyLevel === 'medium') {
        urgencyLevel = 'high';
        recommendedAction = 'urgent_appointment';
      }
    }

    const vitalsConcern: string[] = [];
    const vitalsPatterns: Array<{ pattern: RegExp; label: { vi: string; en: string } }> = [
      {
        pattern: /huyết áp|blood pressure|BP \d/i,
        label: { vi: 'Huyết áp bất thường', en: 'Abnormal blood pressure' },
      },
      {
        pattern: /tim đập nhanh|nhịp tim nhanh|rapid heart|tachycardia/i,
        label: { vi: 'Nhịp tim nhanh', en: 'Rapid heart rate' },
      },
      {
        pattern: /sốt cao|high fever|fever [34][0-9]/i,
        label: { vi: 'Sốt cao', en: 'High fever' },
      },
      {
        pattern: /khó thở|shortness of breath|breathing difficulty/i,
        label: { vi: 'Khó thở', en: 'Breathing difficulty' },
      },
    ];
    for (const vp of vitalsPatterns) {
      if (vp.pattern.test(fullText)) {
        vitalsConcern.push(language === 'vi' ? vp.label.vi : vp.label.en);
      }
    }

    return {
      collectedSymptoms,
      urgencyLevel,
      triageScore: triage.score,
      redFlagsDetected: triage.redFlags,
      probableDifferentials: differentials,
      recommendedAction,
      assessmentComplete: true,
      riskFactors: triage.riskFactors,
      painScore,
      vitalsConcern: vitalsConcern.length ? vitalsConcern : undefined,
      symptomProgression,
    };
  }

  // ==================== EMERGENCY DETECTION ====================

  private detectEmergency(
    message: string
  ): { isEmergency: boolean; protocol?: EmergencyProtocol } {
    const lower = message.normalize('NFC').toLowerCase();
    for (const [protocol, keywords] of Object.entries(EMERGENCY_KEYWORDS) as [
      EmergencyProtocol,
      string[]
    ][]) {
      if (keywords.some(kw => lower.includes(kw.normalize('NFC').toLowerCase()))) {
        return { isEmergency: true, protocol };
      }
    }
    const triage = ClinicalTriageEngine.score(
      message,
      this.detectLanguage(message),
      this.patientProfile
    );
    if (triage.score >= 90 || triage.redFlagCombo?.escalateTo === 'critical') {
      return { isEmergency: true, protocol: 'cardiac_emergency' };
    }
    return { isEmergency: false };
  }

  // ==================== CATEGORY DETECTION ====================

  private static readonly SYMPTOM_SPECIALTY_MAP: Array<{
    keywords: string[];
    specialtyNames: string[];
  }> = [
      {
        keywords: [
          'tê bì', 'tê tay', 'tê chân', 'mất ngủ', 'đau đầu', 'chóng mặt',
          'hoa mắt', 'đau nửa đầu', 'run tay', 'co giật', 'ngất',
          'numbness', 'headache', 'dizziness', 'migraine', 'insomnia', 'tremor', 'seizure',
        ],
        specialtyNames: ['neurology', 'thần kinh', 'nội thần kinh'],
      },
      {
        keywords: [
          'đau khớp', 'đau lưng', 'đau xương', 'đau cổ', 'đau vai',
          'joint pain', 'back pain', 'arthritis', 'gout', 'gút', 'viêm khớp',
          'thoát vị', 'cột sống', 'bone pain',
        ],
        specialtyNames: ['orthopedic', 'orthopedics', 'cơ xương khớp', 'xương khớp'],
      },
      {
        keywords: [
          'ho', 'khó thở', 'hen', 'viêm phổi', 'viêm phế quản',
          'cough', 'asthma', 'pneumonia', 'bronchitis', 'shortness of breath', 'wheezing', 'khò khè',
        ],
        specialtyNames: ['pulmonology', 'respiratory', 'hô hấp', 'phổi'],
      },
      {
        keywords: [
          'mẩn ngứa', 'nổi mề đay', 'mụn', 'vảy nến', 'eczema',
          'skin rash', 'acne', 'psoriasis', 'dermatitis', 'ngứa da', 'nám da',
        ],
        specialtyNames: ['dermatology', 'da liễu'],
      },
      {
        keywords: [
          'đau bụng', 'tiêu chảy', 'táo bón', 'buồn nôn', 'nôn', 'trào ngược',
          'viêm dạ dày', 'stomach pain', 'diarrhea', 'constipation', 'nausea',
          'gastritis', 'reflux', 'bloating', 'đầy hơi',
        ],
        specialtyNames: ['gastroenterology', 'tiêu hóa'],
      },
      {
        keywords: [
          'đái tháo đường', 'tiểu đường', 'béo phì', 'tuyến giáp', 'hormone',
          'diabetes', 'obesity', 'thyroid', 'nội tiết', 'insulin',
        ],
        specialtyNames: ['endocrinology', 'nội tiết'],
      },
      {
        keywords: [
          'đau mắt', 'mờ mắt', 'đỏ mắt', 'khô mắt', 'cận thị', 'glaucoma',
          'eye pain', 'blurry vision', 'red eye', 'dry eye', 'nhìn mờ',
        ],
        specialtyNames: ['ophthalmology', 'mắt', 'nhãn khoa'],
      },
      {
        keywords: [
          'đau tai', 'ù tai', 'viêm tai', 'nghe kém', 'viêm mũi', 'viêm xoang',
          'ear pain', 'tinnitus', 'sinusitis', 'tai mũi họng', 'sore throat', 'đau họng',
        ],
        specialtyNames: ['ent', 'otolaryngology', 'tai mũi họng'],
      },
      {
        keywords: [
          'đau ngực', 'huyết áp', 'tim đập', 'nhịp tim', 'suy tim',
          'chest pain', 'blood pressure', 'heart', 'cardiac', 'tim mạch',
          'arrhythmia', 'loạn nhịp',
        ],
        specialtyNames: ['cardiology', 'tim mạch'],
      },
      {
        keywords: [
          'ung thư', 'cancer', 'khối u', 'u bướu', 'tumor', 'lymphoma',
          'chemotherapy', 'hóa trị',
        ],
        specialtyNames: ['oncology', 'ung bướu'],
      },
      {
        keywords: [
          'lo âu', 'trầm cảm', 'stress', 'rối loạn tâm lý',
          'anxiety', 'depression', 'mental health', 'tâm thần', 'tâm lý', 'panic', 'hoảng loạn',
        ],
        specialtyNames: ['psychiatry', 'psychology', 'tâm thần', 'tâm lý'],
      },
      {
        keywords: [
          'tiểu rắt', 'tiểu buốt', 'tiểu ra máu', 'sỏi thận',
          'kidney stone', 'urinary', 'bladder', 'bàng quang', 'prostate', 'tuyến tiền liệt',
        ],
        specialtyNames: ['urology', 'tiết niệu'],
      },
      {
        keywords: [
          'kinh nguyệt', 'đau bụng kinh', 'có thai', 'mang thai', 'phụ khoa',
          'menstrual', 'pregnancy', 'gynecology', 'ovarian', 'buồng trứng',
        ],
        specialtyNames: ['gynecology', 'phụ khoa', 'sản phụ khoa'],
      },
      {
        keywords: [
          'sốt xuất huyết', 'đau cơ', 'phát ban', 'sốt',
          'dengue', 'muscle pain', 'rash',
        ],
        specialtyNames: ['infectious_disease', 'bệnh nhiệt đới', 'truyền nhiễm'],
      },
    ];

  private async detectCategory(
    message: string
  ): Promise<{ category: string; specialtyId?: string }> {
    const dbResult = await this.specialtyManager.detectCategory(message);
    if (dbResult.specialtyId && dbResult.category !== 'general') return dbResult;

    const normalizedMsg = message.normalize('NFC').toLowerCase();

    for (const entry of AIMedicalService.SYMPTOM_SPECIALTY_MAP) {
      if (
        !entry.keywords.some(kw =>
          normalizedMsg.includes(kw.normalize('NFC').toLowerCase())
        )
      )
        continue;

      for (const name of entry.specialtyNames) {
        try {
          const spec = await Specialty.findOne({
            name: { $regex: new RegExp(name.normalize('NFC'), 'iu') },
            isActive: true,
          })
            .select('_id name category')
            .lean();

          if (spec) {
            return {
              category: (spec as any).category || name,
              specialtyId: (spec as any)._id.toString(),
            };
          }
        } catch {
          continue;
        }
      }
      return { category: entry.specialtyNames[0], specialtyId: undefined };
    }

    const triage = ClinicalTriageEngine.score(
      message,
      this.detectLanguage(message),
      this.patientProfile
    );
    if (triage.suggestedSpecialty) {
      const spec = await this.specialtyManager.findByName(triage.suggestedSpecialty);
      if (spec) return { category: spec.category, specialtyId: spec.id };
      return { category: triage.suggestedSpecialty };
    }

    return { category: 'general', specialtyId: undefined };
  }

  // ==================== DOCTOR AVAILABILITY ====================

  private async findAvailableDoctors(
    specialtyId: string,
    preferredDate?: Date,
    limit = 3
  ): Promise<AppointmentSuggestion['suggestedDoctors']> {
    try {
      const doctors = await Doctor.find({
        specialty_id: specialtyId,
        $or: [
          { isAvailable: true },
          { status: 'working' },
          { status: { $exists: false } },
        ],
      })
        .populate('user_id', 'name email avatar')
        .limit(limit);

      if (!doctors.length) return [];

      const targetDate = preferredDate ? new Date(preferredDate) : new Date();
      const now = new Date();
      if (targetDate.toDateString() === now.toDateString() || targetDate < now) {
        targetDate.setDate(now.getDate() + 1);
        targetDate.setHours(0, 0, 0, 0);
      }

      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayOfWeek = DAYS[targetDate.getDay()];
      const doctorIds = doctors.map(d => d._id);

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

      const allRatings = await Review.aggregate([
        { $match: { doctor_id: { $in: doctorIds } } },
        { $group: { _id: '$doctor_id', avgRating: { $avg: '$rating' } } },
      ]);
      const ratingMap = new Map(allRatings.map(r => [r._id.toString(), r.avgRating]));

      const result: AppointmentSuggestion['suggestedDoctors'] = [];

      for (const doctor of doctors) {
        const docId = (doctor._id as Types.ObjectId).toString();
        const bookedSlots = bookedByDoctor.get(docId) || new Set();
        let slotsForDay = ALL_TIME_SLOTS;

        const daySchedule = (doctor.available_hours as any)?.[dayOfWeek];
        if (daySchedule) {
          if (daySchedule.isAvailable === false) continue;
          if (daySchedule.start && daySchedule.end) {
            slotsForDay = ALL_TIME_SLOTS.filter(
              s => s >= daySchedule.start && s <= daySchedule.end
            );
          }
        }

        const availableSlots = slotsForDay.filter(s => !bookedSlots.has(s));

        result.push({
          id: docId,
          name: (doctor as any).user_id?.name ?? 'Bác sĩ',
          availableSlots: availableSlots.slice(0, 3),
          consultationFee: doctor.consultation_fee,
          experience: doctor.years_of_experience,
          rating: ratingMap.get(docId) ?? 0,
        });
      }

      return result.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } catch (error) {
      console.error('Error finding available doctors:', error);
      return [];
    }
  }

  // ==================== DOCTOR AVAILABILITY FOR SPECIFIC DATE ====================
  public async findAvailableDoctorsForDate(
    specialtyId: string,
    targetDate: Date,
    limit = 3
  ): Promise<AppointmentSuggestion['suggestedDoctors']> {
    return this.findAvailableDoctors(specialtyId, targetDate, limit);
  }

  // ==================== APPOINTMENT EVALUATION ====================
  // FIX: Key fix — only show "existing appointment" if it's for the SAME specialty

  private async evaluateAppointmentNeed(
    assessment: ClinicalAssessment,
    category: string,
    specialtyId: string | undefined,
    language: Language,
    userId?: string,
    bookingConfirmed = false
  ): Promise<AppointmentSuggestion> {
    const { urgencyLevel } = assessment;
    const symptoms = assessment.collectedSymptoms.map(s => s.name);

    if (urgencyLevel === 'critical') {
      return {
        shouldBook: false,
        urgencyLevel: 'critical',
        symptoms,
        reason:
          language === 'vi'
            ? '🚨 Tình trạng nguy cấp — GỌI 115 NGAY, không đặt lịch trực tuyến!'
            : '🚨 Critical condition — CALL 911/115 NOW, do not book online!',
        emergencyInstructions:
          language === 'vi'
            ? 'Gọi 115 ngay hoặc đến phòng cấp cứu bệnh viện gần nhất.'
            : 'Call 911/115 immediately or go to the nearest emergency room.',
      };
    }

    // ── FIX: Only block booking if there's an existing appointment for the SAME specialty ──
    if (userId) {
      try {
        // Build query: match by user + upcoming + status
        const existingQuery: any = {
          user_id: userId,
          appointment_date: { $gte: new Date() },
          status: { $in: ['pending', 'confirmed'] },
        };

        // Only filter by specialty if we have one — prevents showing wrong specialty appointment
        if (specialtyId) {
          existingQuery.specialty_id = specialtyId;
        }

        const existing = await Appointment.findOne(existingQuery)
          .populate('doctor_id', 'name')
          .populate('specialty_id', 'name _id');

        if (existing) {
          const appointmentDate = new Date(existing.appointment_date).toLocaleDateString('vi-VN');
          const existingSpecialtyId = (existing as any).specialty_id?._id?.toString();
          const existingSpecialtyName = (existing as any).specialty_id?.name;
          const existingDoctorName = (existing as any).doctor_id?.name;

          return {
            shouldBook: false,
            urgencyLevel,
            symptoms,
            hasExistingAppointment: true,
            reason: language === 'vi'
              ? `Bạn đã có lịch hẹn khám ${existingSpecialtyName ? `chuyên khoa **${existingSpecialtyName}**` : ''} vào ngày ${appointmentDate}. Hãy tham khảo bác sĩ về các triệu chứng này trong lần khám tới.`
              : `You have an appointment${existingSpecialtyName ? ` for **${existingSpecialtyName}**` : ''} scheduled for ${appointmentDate}. Please discuss these symptoms with your doctor during your visit.`,
            existingAppointmentDetails: {
              date: appointmentDate,
              time: existing.time_slot,
              doctorName: existingDoctorName,
              specialty: existingSpecialtyName,
              specialtyId: existingSpecialtyId,
            },
          };
        }
      } catch (err) {
        console.error('Error checking existing appointments:', err);
      }
    }

    let specialtyName = category;
    if (specialtyId) {
      const spec = await this.specialtyManager.getSpecialtyById(specialtyId);
      if (spec) specialtyName = spec.name;
    }

    const routing = URGENCY_ROUTING[urgencyLevel];

    let contraindications: string[] = [];
    if (this.patientProfile?.allergies.length) {
      contraindications = this.patientProfile.allergies.map(a =>
        language === 'vi' ? `Dị ứng đã biết: ${a}` : `Known allergy: ${a}`
      );
    }

    if (urgencyLevel === 'high') {
      const suggestedDoctors = specialtyId
        ? await this.findAvailableDoctors(specialtyId)
        : undefined;

      return {
        shouldBook: true,
        urgencyLevel: 'high',
        suggestedSpecialty: specialtyName,
        suggestedSpecialtyId: specialtyId,
        recommendedTimeframe:
          language === 'vi' ? routing.timeframe.vi : routing.timeframe.en,
        reason:
          language === 'vi'
            ? '⚠️ Triệu chứng nghiêm trọng — cần khám bác sĩ trong vòng 24 giờ!'
            : '⚠️ Serious symptoms — see a doctor within 24 hours!',
        symptoms,
        contraindications: contraindications.length ? contraindications : undefined,
        suggestedDoctors,
        bookingMessage: language === 'vi' ? routing.vi : routing.en,
      };
    }

    const bookingQuestion = language === 'vi'
      ? urgencyLevel === 'medium'
        ? '💡 Dựa vào triệu chứng của bạn, tôi khuyên bạn nên khám bác sĩ trong 2-3 ngày tới. Bạn có muốn tôi đặt lịch hẹn không? (Trả lời "có" hoặc "đồng ý")'
        : '💡 Để chắc chắn hơn, bạn có muốn tôi đặt lịch khám định kỳ không? (Trả lời "có" hoặc "đồng ý")'
      : urgencyLevel === 'medium'
        ? '💡 Based on your symptoms, I recommend seeing a doctor within 2-3 days. Would you like me to book an appointment? (Just say "yes" or "ok")'
        : '💡 Would you like me to schedule a routine checkup? (Just say "yes" or "ok")';

    if (!bookingConfirmed) {
      return {
        shouldBook: false,
        urgencyLevel,
        suggestedSpecialty: specialtyName,
        suggestedSpecialtyId: specialtyId,
        recommendedTimeframe:
          language === 'vi' ? routing.timeframe.vi : routing.timeframe.en,
        reason:
          language === 'vi'
            ? urgencyLevel === 'medium'
              ? 'Triệu chứng cần được đánh giá y tế trong 2–3 ngày.'
              : 'Nên khám định kỳ để chắc chắn sức khỏe ổn.'
            : urgencyLevel === 'medium'
              ? 'Symptoms need medical evaluation within 2–3 days.'
              : 'A routine checkup is recommended for peace of mind.',
        symptoms,
        contraindications: contraindications.length ? contraindications : undefined,
        bookingMessage: language === 'vi' ? routing.vi : routing.en,
        awaitingBookingConfirmation: true,
        bookingQuestion,
      };
    }

    const suggestedDoctors = specialtyId
      ? await this.findAvailableDoctors(specialtyId)
      : undefined;

    return {
      shouldBook: true,
      urgencyLevel,
      suggestedSpecialty: specialtyName,
      suggestedSpecialtyId: specialtyId,
      recommendedTimeframe:
        language === 'vi' ? routing.timeframe.vi : routing.timeframe.en,
      reason:
        language === 'vi'
          ? 'Bạn có 1 lịch hẹn đang chờ xác nhận.'
          : 'You have a pending appointment confirmation.',
      symptoms,
      contraindications: contraindications.length ? contraindications : undefined,
      suggestedDoctors,
      bookingMessage: language === 'vi' ? routing.vi : routing.en,
    };
  }

  // ==================== SYSTEM PROMPT ====================

  private buildSystemPrompt(): string {
    return `You are an intelligent, empathetic medical AI assistant for a Vietnamese hospital system.
You are FULLY BILINGUAL in English and Vietnamese.

══════════════════════════════════════════
LANGUAGE RULES — HIGHEST PRIORITY, NON-NEGOTIABLE:
══════════════════════════════════════════
• User writes in VIETNAMESE → respond 100% in VIETNAMESE. NOT one word in English.
• User writes in ENGLISH → respond 100% in ENGLISH.
• NEVER mix languages in the same response.
• Vietnamese disclaimer: "⚕️ Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp."
• English disclaimer: "⚕️ This information is for educational purposes only and does not replace professional medical advice."

══════════════════════════════════════════
CLINICAL ASSESSMENT & URGENCY ROUTING:
══════════════════════════════════════════
🔴 CRITICAL (score ≥ 90): Emergency ONLY. NEVER mention booking online.
🟠 HIGH (score 70–89): Express urgency. System shows doctors automatically.
🟡 MEDIUM (score 40–69): Provide info, then ask booking question at END.
🟢 LOW (score < 40): Provide info + self-care tips, then ask booking at END.

══════════════════════════════════════════
BOOKING CONFIRMATION FLOW:
══════════════════════════════════════════
When user CONFIRMED booking:
  → [VI]: "Tuyệt vời! Vui lòng chọn ngày và bác sĩ bên dưới. 📅"
  → [EN]: "Great! Please select a date and doctor below. 📅"

When user DECLINED booking:
  → [VI]: "Không sao cả. Bạn có thể đặt lịch bất cứ lúc nào! 😊"
  → [EN]: "No problem. You can book anytime! 😊"

══════════════════════════════════════════
SAFETY — MANDATORY:
══════════════════════════════════════════
✅ Always recommend consulting a real doctor for diagnosis
🚨 Always guide to call 115 for dangerous symptoms
❌ Never diagnose diseases or prescribe medications
⚠️ Mental health crisis: provide 1800 599 920 (VN) / 988 (US)

FORMAT: Warm, empathetic tone. Max 600 words. End with disclaimer.`;
  }

  // ==================== PROMPT BUILDER ====================

  private async buildUserPrompt(
    userMessage: string,
    category: string,
    specialtyId: string | undefined,
    language: Language,
    assessment?: ClinicalAssessment,
    appointmentSuggestion?: AppointmentSuggestion,
    symptomHistory?: string,
    bookingIntent?: 'confirm' | 'decline' | 'inquiry' | 'neutral'
  ): Promise<string> {
    const langInstruction =
      language === 'vi'
        ? '🇻🇳 QUAN TRỌNG: Trả lời 100% bằng TIẾNG VIỆT.'
        : '🇬🇧 IMPORTANT: Respond 100% in ENGLISH.';

    const specialtyContext = await this.specialtyManager.getSpecialtyContext(
      specialtyId,
      language
    );
    const historyText = this.serializeHistory();
    const parts: string[] = [specialtyContext, langInstruction];

    if (this.patientProfile) {
      parts.push(PatientProfileService.buildContextBlock(this.patientProfile, language));
    }

    if (symptomHistory) parts.push(symptomHistory);

    if (bookingIntent === 'confirm') {
      parts.push(
        language === 'vi'
          ? '⚡ NGƯỜI DÙNG ĐÃ XÁC NHẬN MUỐN ĐẶT LỊCH. Phản hồi ngắn gọn, hướng dẫn chọn ngày và bác sĩ bên dưới.'
          : '⚡ USER CONFIRMED BOOKING. Respond briefly, guide them to select date and doctor below.'
      );
    } else if (bookingIntent === 'decline') {
      parts.push(
        language === 'vi'
          ? '⚡ NGƯỜI DÙNG TỪ CHỐI ĐẶT LỊCH. Phản hồi thân thiện, nhắc họ có thể đặt sau.'
          : '⚡ USER DECLINED BOOKING. Respond warmly, remind they can book later.'
      );
    } else if (bookingIntent === 'inquiry') {
      parts.push(
        language === 'vi'
          ? '⚡ NGƯỜI DÙNG HỎI VỀ LỊCH HẸN. Cung cấp thông tin lịch hẹn sắp tới.'
          : '⚡ USER ASKING ABOUT APPOINTMENTS. Provide upcoming appointment info.'
      );
    }

    if (assessment) {
      const progressionNote = assessment.symptomProgression && assessment.symptomProgression !== 'unknown'
        ? language === 'vi'
          ? `\n- Tiến triển: ${assessment.symptomProgression === 'worsening' ? 'Đang nặng hơn ⚠️' : assessment.symptomProgression === 'improving' ? 'Đang đỡ hơn' : 'Ổn định'}`
          : `\n- Progression: ${assessment.symptomProgression === 'worsening' ? 'Worsening ⚠️' : assessment.symptomProgression === 'improving' ? 'Improving' : 'Stable'}`
        : '';

      const triageBlock =
        language === 'vi'
          ? `ĐÁNH GIÁ LÂM SÀNG HỆ THỐNG:
- Điểm triage: ${assessment.triageScore}/100
- Mức độ khẩn cấp: ${assessment.urgencyLevel.toUpperCase()}
- Hành động khuyến nghị: ${assessment.recommendedAction}
- Triệu chứng: ${assessment.collectedSymptoms.map(s => s.name).join(', ')}${progressionNote}
${assessment.painScore ? `- Điểm đau: ${assessment.painScore}/10` : ''}
${assessment.redFlagsDetected.length ? `- Dấu hiệu cảnh báo: ${assessment.redFlagsDetected.join('; ')}` : ''}
${assessment.riskFactors.length ? `- Yếu tố nguy cơ: ${assessment.riskFactors.join('; ')}` : ''}
${assessment.probableDifferentials.length ? `- Có thể liên quan: ${assessment.probableDifferentials.join(', ')}` : ''}`
          : `SYSTEM CLINICAL ASSESSMENT:
- Triage score: ${assessment.triageScore}/100
- Urgency level: ${assessment.urgencyLevel.toUpperCase()}
- Recommended action: ${assessment.recommendedAction}
- Symptoms: ${assessment.collectedSymptoms.map(s => s.name).join(', ')}${progressionNote}
${assessment.painScore ? `- Pain score: ${assessment.painScore}/10` : ''}
${assessment.redFlagsDetected.length ? `- Red flags: ${assessment.redFlagsDetected.join('; ')}` : ''}
${assessment.riskFactors.length ? `- Risk factors: ${assessment.riskFactors.join('; ')}` : ''}
${assessment.probableDifferentials.length ? `- Likely conditions: ${assessment.probableDifferentials.join(', ')}` : ''}`;
      parts.push(triageBlock);
    }

    if (historyText) {
      parts.push(
        language === 'vi'
          ? `LỊCH SỬ HỘI THOẠI:\n${historyText}`
          : `CONVERSATION HISTORY:\n${historyText}`
      );
    }

    parts.push(
      language === 'vi'
        ? `CÂU HỎI / THÔNG TIN BỆNH NHÂN: ${userMessage}`
        : `PATIENT MESSAGE: ${userMessage}`
    );

    if (appointmentSuggestion?.shouldBook && appointmentSuggestion.suggestedDoctors?.length) {
      const doc = appointmentSuggestion.suggestedDoctors[0];
      const slot = doc.availableSlots[0];
      parts.push(
        language === 'vi'
          ? `THÔNG TIN ĐẶT LỊCH: Đã tìm thấy bác sĩ cho chuyên khoa ${appointmentSuggestion.suggestedSpecialty}. Bác sĩ ${doc.name} có lịch trống lúc ${slot}.`
          : `BOOKING INFO: Found doctors for ${appointmentSuggestion.suggestedSpecialty}. Dr. ${doc.name} has slots at ${slot}.`
      );
    }

    if (appointmentSuggestion?.contraindications?.length) {
      parts.push(
        language === 'vi'
          ? `⚠️ CẢNH BÁO DỊ ỨNG: ${appointmentSuggestion.contraindications.join('; ')}`
          : `⚠️ ALLERGY WARNING: ${appointmentSuggestion.contraindications.join('; ')}`
      );
    }

    parts.push(
      language === 'vi'
        ? 'Trả lời bằng TIẾNG VIỆT, ngôn ngữ tự nhiên, rõ ràng, đồng cảm.'
        : 'Respond in ENGLISH, natural language, clear and empathetic.'
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
      if (!text.trim()) throw new Error('Empty response from Groq');
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
      if (error instanceof QuotaExceededError)
        return { text: this.getFallbackText(category, language), usedFallback: true };
      console.error('❌ Groq error:', (error as Error)?.message);
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }
  }

  private getFallbackText(category: string, language: Language): string {
    let key: FallbackKey = 'general';
    const lower = category.toLowerCase();
    if (lower.includes('emergency') || lower.includes('cấp cứu')) key = 'emergency';
    else if (lower.includes('cardio') || lower.includes('tim')) key = 'cardiology';
    else if (lower.includes('medication') || lower.includes('thuốc')) key = 'medications';
    return FALLBACK_RESPONSES[language][key];
  }

  // ==================== MAIN PROCESS MESSAGE ====================

  // Thay thế toàn bộ processMessage và các helper mới

  public async processMessage(userMessage: string, userId?: string): Promise<AIResponse> {
    try {
      if (!userMessage?.trim()) throw new EmptyMessageError();

      const language = this.detectLanguage(userMessage);

      if (userId && !this.patientProfile) {
        await this.loadPatientProfile(userId);
      }

      // ── Bước 1: Tích lũy text và lưu history ──────────────────
      this.accumulatedSymptomText += ' ' + userMessage;
      this.addToHistory({ role: 'user', content: userMessage, timestamp: new Date(), language });

      // ── Bước 2: Fetch DB context ───────────────────────────────
      const dbContext = await fetchDBContext(userId);

      // ── Bước 3: Kiểm tra booking inquiry trước ────────────────
      const bookingIntent = this.detectBookingIntent(userMessage);
      if (bookingIntent === 'inquiry') {
        const inquiryResponse = await this.handleBookingInquiry(userId, language);
        if (inquiryResponse) {
          this.addToHistory({
            role: 'assistant',
            content: inquiryResponse.response,
            timestamp: new Date(),
            language,
          });
          return inquiryResponse;
        }
      }

      // ── Bước 4: Gọi AI 1 lần duy nhất — quyết định + viết response ──
      const conversationText = this.serializeHistory();

      const combinedPrompt = this.buildCombinedPrompt(
        userMessage,
        conversationText,
        dbContext,
        language,
        bookingIntent
      );

      const { text: rawResponse, usedFallback } = await this.tryGenerate(
        combinedPrompt,
        'medical',
        language
      );

      // ── Bước 5: Parse JSON quyết định từ response AI ──────────
      const { aiDecision, responseText } = this.parseAIOutput(rawResponse, dbContext, language);

      // ── Bước 6: Emergency check ───────────────────────────────
      if (aiDecision.requiresEmergency) {
        const protocol = this.mapToEmergencyProtocol(aiDecision.redFlags);
        auditLogger.log({
          userId, action: 'emergency_triggered',
          userMessage, category: 'emergency',
          urgencyLevel: 'critical', emergencyAlert: true,
          timestamp: new Date(),
        });
        return this.buildEmergencyResponse(protocol, language);
      }

      // ── Bước 7: Build AppointmentSuggestion ──────────────────
      const appointmentRecommendation = this.buildSuggestionFromAIDecision(
        aiDecision, dbContext, bookingIntent, language
      );

      // ── Bước 8: Lưu history và audit ─────────────────────────
      this.addToHistory({
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        language,
        category: aiDecision.recommendedSpecialtyName,
      });

      auditLogger.log({
        userId, action: 'chat_message',
        userMessage,
        aiResponse: responseText.substring(0, 500),
        category: aiDecision.recommendedSpecialtyName,
        urgencyLevel: aiDecision.urgencyLevel,
        emergencyAlert: false,
        timestamp: new Date(),
      });

      // ── Bước 9: Symptom tracking ──────────────────────────────
      if (userId && appointmentRecommendation.symptoms?.length) {
        const sessionId = this.conversationHistory[0]?.timestamp.toISOString() || 'unknown';
        SymptomTrackerService.logSymptoms(
          userId, sessionId,
          appointmentRecommendation.symptoms,
          userMessage,
          aiDecision.recommendedSpecialtyName ?? 'general'
        ).catch(console.error);
      }

      return {
        response: responseText,
        confidence: usedFallback ? 0.5 : 0.88,
        emergencyAlert: false,
        category: aiDecision.recommendedSpecialtyName,
        language,
        usedFallback,
        provider: 'groq',
        appointmentRecommendation,
        patientContextUsed: !!this.patientProfile,
        urgencyLevel: aiDecision.urgencyLevel,
        triageScore: aiDecision.triageScore,
        shouldAskBookingConfirmation: appointmentRecommendation.awaitingBookingConfirmation,
        requiresMoreInfo: appointmentRecommendation.awaitingBookingConfirmation,
        followUpQuestions: appointmentRecommendation.awaitingBookingConfirmation
          ? [appointmentRecommendation.bookingQuestion || '']
          : undefined,
      };

    } catch (error) {
      if (!(error instanceof EmptyMessageError)) {
        console.error('❌ processMessage error:', error);
      }
      return this.buildErrorResponse(this.detectLanguage(userMessage ?? ''));
    }
  }

  // ── Build 1 prompt duy nhất: AI quyết định + viết text ────────────
  private buildCombinedPrompt(
    userMessage: string,
    conversationText: string,
    dbContext: DBContext,
    language: Language,
    bookingIntent: string
  ): string {
    const langInstruction = language === 'vi'
      ? '🇻🇳 Phản hồi 100% bằng TIẾNG VIỆT. TUYỆT ĐỐI không dùng tiếng Anh.'
      : '🇬🇧 Respond 100% in ENGLISH. Do NOT mix Vietnamese.';

    // FIX: Giới hạn doctor list để không vượt token limit
    const doctorsList = dbContext.availableDoctors
      .slice(0, 10) // tối đa 10 bác sĩ thay vì toàn bộ
      .map(d =>
        `- ID:${d.id} | ${d.name} | ${d.specialtyName}(${d.specialtyId}) | ` +
        `⭐${d.rating.toFixed(1)} | ${d.experience}yr | ` +
        `Slots ${d.nextAvailableDate}: ${d.availableSlots.slice(0, 3).join(',')}`
      )
      .join('\n');

    const specialtiesList = dbContext.availableSpecialties
      .map(s => `- ID:${s.id} | ${s.name}`)
      .join('\n');

    const existingAppts = dbContext.patientExistingAppointments.length
      ? dbContext.patientExistingAppointments
        .map(a => `- ${a.date} ${a.timeSlot} với ${a.doctorName}(${a.specialtyName})[${a.status}]`)
        .join('\n')
      : 'Không có';

    // FIX: Thêm profile block đầy đủ
    const profileBlock = this.patientProfile
      ? `HỒ SƠ BỆNH NHÂN:
- Tuổi: ${this.patientProfile.age ?? 'không rõ'} | Giới: ${this.patientProfile.gender ?? 'không rõ'}
- Dị ứng: ${this.patientProfile.allergies.join(', ') || 'không có'}
- Bệnh nền: ${this.patientProfile.chronicConditions.join(', ') || 'không có'}
- Thuốc đang dùng: ${this.patientProfile.currentMedications.join(', ') || 'không có'}`
      : '';

    const bookingCtx = bookingIntent === 'confirm'
      ? (language === 'vi' ? '⚡ Bệnh nhân ĐÃ XÁC NHẬN muốn đặt lịch → shouldBook=true nếu có bác sĩ phù hợp.' : '⚡ Patient CONFIRMED booking → shouldBook=true if doctor available.')
      : bookingIntent === 'decline'
        ? (language === 'vi' ? '⚡ Bệnh nhân TỪ CHỐI → shouldBook=false.' : '⚡ Patient DECLINED → shouldBook=false.')
        : '';

    // FIX: Tách rõ ràng JSON schema và response section
    return `${langInstruction}
Bạn là bác sĩ AI. Nhiệm vụ kép: (1) phân tích lâm sàng → JSON quyết định, (2) viết phản hồi tự nhiên.

${profileBlock}
${bookingCtx}

─── LỊCH SỬ HỘI THOẠI (tóm tắt) ───
${conversationText.slice(-2000)}

─── TIN NHẮN MỚI NHẤT ───
${userMessage}

─── DỮ LIỆU BỆNH VIỆN THỰC TẾ ───
CHUYÊN KHOA:
${specialtiesList}

BÁC SĨ CÓ LỊCH TRỐNG:
${doctorsList}

LỊCH HẸN HIỆN TẠI CỦA BỆNH NHÂN:
${existingAppts}

─── YÊU CẦU ĐẦU RA ─── 
PHẦN 1: JSON (không xuống dòng, 1 dòng duy nhất):
{"urgencyLevel":"low|medium|high|critical","triageScore":0-100,"requiresEmergency":false,"shouldBook":false,"reasoning":"ngắn gọn","recommendedSpecialtyId":"ID hoặc null","recommendedSpecialtyName":"tên hoặc null","recommendedDoctorId":"ID từ danh sách hoặc null","recommendedDoctorName":"tên hoặc null","recommendedTimeSlot":"slot từ danh sách hoặc null","recommendedDate":"YYYY-MM-DD hoặc null","redFlags":[],"selfCareAdvice":[],"followUpNeeded":true,"estimatedWaitDays":3,"emergencyReason":null}

---RESPONSE---
PHẦN 2: [Viết phản hồi bằng ${language === 'vi' ? 'TIẾNG VIỆT' : 'ENGLISH'}, tối đa 300 từ, đồng cảm, kết bằng disclaimer]

QUY TẮC TUYỆT ĐỐI:
- Chỉ chọn bác sĩ/slot CÓ TRONG danh sách trên
- Nếu BN đã có lịch cùng chuyên khoa → shouldBook=false, giải thích trong reasoning
- Critical/emergency → requiresEmergency=true, shouldBook=false
- Disclaimer VI: "⚕️ Thông tin chỉ mang tính giáo dục, không thay thế tư vấn bác sĩ."
- Disclaimer EN: "⚕️ For educational purposes only."`;
  }


  // ── Parse output AI: tách JSON quyết định và text phản hồi ────────
  private parseAIOutput(
    rawOutput: string,
    dbContext: DBContext,
    language: Language
  ): { aiDecision: AIDecision; responseText: string } {
    const SEPARATOR = '---RESPONSE---';
    const parts = rawOutput.split(SEPARATOR);

    let aiDecision: AIDecision;
    let responseText: string;

    if (parts.length >= 2) {
      try {
        // Tìm JSON trong phần đầu
        const jsonMatch = parts[0].match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          aiDecision = this.sanitizeAIDecision(parsed, dbContext);
        } else {
          throw new Error('No JSON found');
        }
        responseText = parts[1].trim();
      } catch {
        aiDecision = this.getDefaultDecision(language);
        responseText = parts[1]?.trim() || rawOutput;
      }
    } else {
      // AI không tuân thủ format — parse cả raw output
      try {
        const jsonMatch = rawOutput.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          aiDecision = this.sanitizeAIDecision(parsed, dbContext);
          // Lấy text còn lại sau JSON
          responseText = rawOutput.slice(rawOutput.indexOf(jsonMatch[0]) + jsonMatch[0].length).trim()
            || rawOutput;
        } else {
          throw new Error('No JSON');
        }
      } catch {
        aiDecision = this.getDefaultDecision(language);
        responseText = rawOutput;
      }
    }

    // Đảm bảo responseText không rỗng
    if (!responseText.trim()) {
      responseText = language === 'vi'
        ? `Cảm ơn bạn đã chia sẻ. Tôi đã ghi nhận thông tin của bạn.\n\n⚕️ Thông tin chỉ mang tính giáo dục.`
        : `Thank you for sharing. I've noted your information.\n\n⚕️ For educational purposes only.`;
    }

    return { aiDecision, responseText };
  }

  // ── Validate và sanitize quyết định AI ───────────────────────────
  private sanitizeAIDecision(decision: any, dbContext: DBContext): AIDecision {
    const validUrgencies: UrgencyLevel[] = ['low', 'medium', 'high', 'critical'];
    const urgencyLevel = validUrgencies.includes(decision.urgencyLevel)
      ? decision.urgencyLevel as UrgencyLevel
      : 'medium';

    // Xác minh bác sĩ có trong DB thật
    const doctorExists = dbContext.availableDoctors.find(
      d => d.id === decision.recommendedDoctorId
    );
    // Xác minh slot có thật
    const slotValid = doctorExists?.availableSlots.includes(decision.recommendedTimeSlot ?? '');
    // Xác minh specialty có trong DB
    const specialtyExists = dbContext.availableSpecialties.find(
      s => s.id === decision.recommendedSpecialtyId
    );

    return {
      urgencyLevel,
      triageScore: Math.min(100, Math.max(0, Number(decision.triageScore) || 50)),
      shouldBook: Boolean(decision.shouldBook),
      reasoning: String(decision.reasoning || ''),
      recommendedSpecialtyId: specialtyExists?.id,
      recommendedSpecialtyName: specialtyExists?.name ?? decision.recommendedSpecialtyName,
      recommendedDoctorId: doctorExists?.id,
      recommendedDoctorName: doctorExists?.name,
      recommendedTimeSlot: slotValid ? decision.recommendedTimeSlot : doctorExists?.availableSlots[0],
      recommendedDate: doctorExists?.nextAvailableDate ?? decision.recommendedDate,
      redFlags: Array.isArray(decision.redFlags) ? decision.redFlags : [],
      selfCareAdvice: Array.isArray(decision.selfCareAdvice) ? decision.selfCareAdvice : [],
      requiresEmergency: Boolean(decision.requiresEmergency),
      emergencyReason: decision.emergencyReason ?? undefined,
      followUpNeeded: Boolean(decision.followUpNeeded ?? true),
      estimatedWaitDays: Number(decision.estimatedWaitDays) || 3,
    };
  }



  // ── Map red flags → emergency protocol ────────────────────────────
  private mapToEmergencyProtocol(redFlags: string[]): EmergencyProtocol {
    const combined = redFlags.join(' ').toLowerCase();
    if (combined.includes('tim') || combined.includes('cardiac') || combined.includes('ngực'))
      return 'cardiac_emergency';
    if (combined.includes('đột quỵ') || combined.includes('stroke') || combined.includes('não'))
      return 'stroke_emergency';
    if (combined.includes('thở') || combined.includes('respiratory'))
      return 'respiratory_emergency';
    if (combined.includes('tự tử') || combined.includes('suicidal') || combined.includes('tâm thần'))
      return 'psychiatric_emergency';
    return 'cardiac_emergency';
  }

  // ── Chuyển AIDecision → AppointmentSuggestion ─────────────────────
  private buildSuggestionFromAIDecision(
    decision: AIDecision,
    dbContext: DBContext,
    bookingIntent: string,
    language: Language
  ): AppointmentSuggestion {

    // Critical — không cho đặt lịch online
    if (decision.requiresEmergency || decision.urgencyLevel === 'critical') {
      return {
        shouldBook: false,
        urgencyLevel: 'critical',
        symptoms: [],
        reason: decision.emergencyReason ?? decision.reasoning,
        emergencyInstructions: language === 'vi'
          ? 'Gọi 115 ngay hoặc đến phòng cấp cứu bệnh viện gần nhất.'
          : 'Call 911/115 immediately or go to the nearest emergency room.',
      };
    }

    // Bệnh nhân đã có lịch hẹn cùng chuyên khoa
    if (dbContext.patientExistingAppointments.length > 0 && decision.recommendedSpecialtyId) {
      const existingForSameSpecialty = dbContext.patientExistingAppointments.find(
        a => a.specialtyName === decision.recommendedSpecialtyName
      );
      if (existingForSameSpecialty) {
        return {
          shouldBook: false,
          urgencyLevel: decision.urgencyLevel,
          suggestedSpecialty: decision.recommendedSpecialtyName,
          suggestedSpecialtyId: decision.recommendedSpecialtyId,
          symptoms: [],
          hasExistingAppointment: true,
          reason: language === 'vi'
            ? `Bạn đã có lịch hẹn khám **${existingForSameSpecialty.specialtyName}** vào ${existingForSameSpecialty.date} lúc ${existingForSameSpecialty.timeSlot}.`
            : `You already have a **${existingForSameSpecialty.specialtyName}** appointment on ${existingForSameSpecialty.date} at ${existingForSameSpecialty.timeSlot}.`,
          existingAppointmentDetails: {
            date: existingForSameSpecialty.date,
            time: existingForSameSpecialty.timeSlot,
            doctorName: existingForSameSpecialty.doctorName,
            specialty: existingForSameSpecialty.specialtyName,
          },
        };
      }
    }

    // AI quyết định nên đặt lịch + đã chọn được bác sĩ cụ thể
    if (decision.shouldBook && decision.recommendedDoctorId) {
      const doctor = dbContext.availableDoctors.find(
        d => d.id === decision.recommendedDoctorId
      );

      return {
        shouldBook: true,
        urgencyLevel: decision.urgencyLevel,
        suggestedSpecialty: decision.recommendedSpecialtyName,
        suggestedSpecialtyId: decision.recommendedSpecialtyId,
        recommendedTimeframe: language === 'vi'
          ? `Trong ${decision.estimatedWaitDays} ngày`
          : `Within ${decision.estimatedWaitDays} days`,
        reason: decision.reasoning,
        symptoms: [],
        suggestedDoctors: doctor ? [{
          id: doctor.id,
          name: doctor.name,
          availableSlots: doctor.availableSlots,
          consultationFee: doctor.consultationFee,
          experience: doctor.experience,
          rating: doctor.rating,
        }] : [],
        bookingMessage: language === 'vi'
          ? `💡 AI đã chọn bác sĩ phù hợp nhất dựa trên triệu chứng và lịch trống thực tế.`
          : `💡 AI selected the best available doctor based on your symptoms and real-time availability.`,
      };
    }

    // AI nói nên đặt nhưng chưa chọn được bác sĩ (chờ người dùng xác nhận)
    if (decision.shouldBook && !decision.recommendedDoctorId) {
      return {
        shouldBook: false,
        urgencyLevel: decision.urgencyLevel,
        suggestedSpecialty: decision.recommendedSpecialtyName,
        suggestedSpecialtyId: decision.recommendedSpecialtyId,
        symptoms: [],
        reason: decision.reasoning,
        awaitingBookingConfirmation: true,
        bookingQuestion: language === 'vi'
          ? `💡 ${decision.reasoning} Bạn có muốn đặt lịch khám không?`
          : `💡 ${decision.reasoning} Would you like to book an appointment?`,
      };
    }

    // AI chưa thấy cần đặt ngay (medium/low, chờ người dùng xác nhận)
    const bookingQuestion = language === 'vi'
      ? decision.urgencyLevel === 'medium'
        ? `💡 ${decision.reasoning} Bạn có muốn tôi đặt lịch hẹn trong 2-3 ngày tới không?`
        : `💡 ${decision.reasoning} Bạn có muốn đặt lịch khám định kỳ không?`
      : decision.urgencyLevel === 'medium'
        ? `💡 ${decision.reasoning} Would you like me to book an appointment within 2-3 days?`
        : `💡 ${decision.reasoning} Would you like to schedule a routine checkup?`;

    return {
      shouldBook: false,
      urgencyLevel: decision.urgencyLevel,
      suggestedSpecialty: decision.recommendedSpecialtyName,
      suggestedSpecialtyId: decision.recommendedSpecialtyId,
      symptoms: [],
      reason: decision.reasoning,
      awaitingBookingConfirmation: bookingIntent === 'neutral',
      bookingQuestion: bookingIntent === 'neutral' ? bookingQuestion : undefined,
      bookingMessage: language === 'vi'
        ? `📋 Nên khám trong ${decision.estimatedWaitDays} ngày tới.`
        : `📋 Recommended within ${decision.estimatedWaitDays} days.`,
    };
  }

  private getDefaultDecision(language: Language): AIDecision {
    return {
      urgencyLevel: 'medium',
      triageScore: 50,
      shouldBook: false,
      reasoning: language === 'vi'
        ? 'Cần thêm thông tin để đánh giá chính xác.'
        : 'Need more information for accurate assessment.',
      redFlags: [],
      requiresEmergency: false,
      followUpNeeded: true,
      estimatedWaitDays: 3,
    };
  }

  private async buildUserPromptWithAIDecision(
    userMessage: string,
    language: Language,
    decision: AIDecision,
    suggestion: AppointmentSuggestion,
    bookingIntent: string
  ): Promise<string> {
    const langInstruction = language === 'vi'
      ? '🇻🇳 Trả lời 100% bằng TIẾNG VIỆT.'
      : '🇬🇧 Respond 100% in ENGLISH.';

    const decisionBlock = language === 'vi'
      ? `QUYẾT ĐỊNH AI (đã được xác minh với DB):
- Mức độ khẩn cấp: ${decision.urgencyLevel.toUpperCase()} (${decision.triageScore}/100)
- Cần đặt lịch: ${decision.shouldBook ? 'CÓ' : 'CHƯA'}
- Lý do: ${decision.reasoning}
${decision.recommendedDoctorName ? `- Bác sĩ được chọn: ${decision.recommendedDoctorName} (${decision.recommendedSpecialtyName})` : ''}
${decision.recommendedTimeSlot ? `- Slot gợi ý: ${decision.recommendedDate} lúc ${decision.recommendedTimeSlot}` : ''}
${decision.redFlags.length ? `- Dấu hiệu cảnh báo: ${decision.redFlags.join('; ')}` : ''}
${decision.selfCareAdvice?.length ? `- Lời khuyên tự chăm sóc: ${decision.selfCareAdvice.join('; ')}` : ''}`
      : `AI DECISION (verified against DB):
- Urgency: ${decision.urgencyLevel.toUpperCase()} (${decision.triageScore}/100)
- Should book: ${decision.shouldBook ? 'YES' : 'NOT YET'}
- Reasoning: ${decision.reasoning}
${decision.recommendedDoctorName ? `- Selected doctor: ${decision.recommendedDoctorName} (${decision.recommendedSpecialtyName})` : ''}
${decision.recommendedTimeSlot ? `- Suggested slot: ${decision.recommendedDate} at ${decision.recommendedTimeSlot}` : ''}
${decision.redFlags.length ? `- Red flags: ${decision.redFlags.join('; ')}` : ''}`;

    const bookingCtx = bookingIntent === 'confirm'
      ? (language === 'vi'
        ? '⚡ Người dùng xác nhận đặt lịch. Thông báo ngắn gọn về bác sĩ và slot đã chọn.'
        : '⚡ User confirmed booking. Briefly confirm the doctor and slot selected.')
      : bookingIntent === 'decline'
        ? (language === 'vi'
          ? '⚡ Người dùng từ chối. Phản hồi thân thiện, nhắc có thể đặt sau.'
          : '⚡ User declined. Respond warmly, remind they can book later.')
        : '';

    return [
      langInstruction,
      decisionBlock,
      bookingCtx,
      `CONVERSATION HISTORY:\n${this.serializeHistory()}`,
      language === 'vi'
        ? `CÂU HỎI BỆNH NHÂN: ${userMessage}\n\nTrả lời tự nhiên, đồng cảm, dựa vào quyết định AI ở trên. Tối đa 400 từ.`
        : `PATIENT MESSAGE: ${userMessage}\n\nRespond naturally and empathetically based on the AI decision above. Max 400 words.`,
    ].filter(Boolean).join('\n\n');
  }

  // ==================== BOOKING STATE RESET ====================

  private resetBookingState(): void {
    this.bookingSuggested = false;
    this.bookingConfirmed = false;
    this.bookingDeclined = false;
    this.bookingInquiryDetected = false;
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
      relatedSpecialties: [],
      language,
      provider: 'local',
      urgencyLevel: 'critical',
      triageScore: 100,
    };
  }

  private buildErrorResponse(language: Language): AIResponse {
    const response =
      language === 'vi'
        ? 'Xin lỗi, đang gặp sự cố kỹ thuật.\n1. Liên hệ trực tiếp nhà cung cấp y tế\n2. Gọi 115 nếu cần cấp cứu\n\n⚕️ Thông tin này chỉ mang tính giáo dục.'
        : 'Technical difficulty encountered.\n1. Contact your healthcare provider directly\n2. Call 911/115 for emergencies\n\n⚕️ Educational purposes only.';
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

    const highTerms =
      language === 'vi'
        ? ['nghiên cứu cho thấy', 'dựa trên bằng chứng', 'hướng dẫn y khoa']
        : ['research shows', 'evidence-based', 'medical guidelines', 'clinical studies'];
    const cautionTerms =
      language === 'vi'
        ? ['có thể', 'đôi khi', 'trong một số trường hợp']
        : ['may be', 'could possibly', 'sometimes', 'in some cases'];

    if (highTerms.some(t => lower.includes(t))) confidence = 0.88;
    if (cautionTerms.some(t => lower.includes(t))) confidence = Math.min(confidence, 0.65);

    const actionMap =
      language === 'vi'
        ? {
          doctor: { trigger: 'bác sĩ', label: 'Đặt lịch khám với bác sĩ' },
          pharmacist: { trigger: 'dược sĩ', label: 'Tham khảo dược sĩ về thuốc' },
          test: { trigger: 'xét nghiệm', label: 'Thực hiện xét nghiệm theo chỉ định' },
          emergency: { trigger: 'cấp cứu', label: 'Tìm kiếm chăm sóc y tế ngay' },
          specialist: { trigger: 'chuyên khoa', label: 'Tham khảo bác sĩ chuyên khoa' },
        }
        : {
          doctor: { trigger: 'doctor', label: 'Schedule an appointment with your doctor' },
          pharmacist: { trigger: 'pharmacist', label: 'Consult a pharmacist about medications' },
          test: { trigger: 'test', label: 'Get recommended tests done' },
          emergency: { trigger: 'emergency', label: 'Seek immediate medical attention' },
          specialist: { trigger: 'specialist', label: 'See a specialist for evaluation' },
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
      this.conversationHistory = [
        this.conversationHistory[0],
        ...this.conversationHistory.slice(-(MAX_HISTORY_LENGTH - 1)),
      ];
    }
  }

  private serializeHistory(): string {
    return this.conversationHistory
      .map(msg => {
        const role =
          msg.role === 'user'
            ? msg.language === 'vi' ? 'Bệnh nhân' : 'Patient'
            : msg.language === 'vi' ? 'Trợ lý AI' : 'AI Assistant';
        return `${role}: ${msg.content.substring(0, 300)}`;
      })
      .join('\n');
  }

  // ==================== ADDITIONAL SERVICES ====================

  public async getMedicationInfo(medicationName: string, userId?: string): Promise<MedicationInfo> {
    let allergies: string[] = [];
    if (userId) {
      const profile = await PatientProfileService.getProfile(userId);
      if (profile) allergies = profile.allergies;
    }

    const allergyWarning = allergies.some(
      a =>
        medicationName.toLowerCase().includes(a.toLowerCase()) ||
        a.toLowerCase().includes(medicationName.toLowerCase())
    );

    const allergyNote = allergyWarning
      ? `⚠️ CẢNH BÁO DỊ ỨNG: Bệnh nhân có thể dị ứng với ${medicationName}. Tham khảo bác sĩ ngay!\n\n`
      : '';

    const prompt = `Cung cấp thông tin chi tiết về thuốc: "${medicationName}"\n\nBao gồm:\n1. Tên thương mại phổ biến\n2. Công dụng điều trị\n3. Liều dùng thông thường\n4. Tác dụng phụ thường gặp và nghiêm trọng\n5. Chống chỉ định\n6. Tương tác thuốc quan trọng\n7. Lưu ý đặc biệt\n\nTrả lời bằng TIẾNG VIỆT.\n\n⚕️ Kết thúc bằng: "Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp."`;
    const { text } = await this.tryGenerate(prompt, 'medications', 'vi');
    const warnings = allergyWarning ? [`⚠️ Potential allergy conflict: ${medicationName}`] : [];

    return {
      name: medicationName,
      information: allergyNote + text,
      confidence: 0.85,
      lastUpdated: new Date().toISOString(),
      warnings,
    };
  }

  public async explainMedicalTerm(term: string): Promise<TermExplanation> {
    const language = this.detectLanguage(term);
    const prompt =
      language === 'vi'
        ? `Giải thích thuật ngữ y khoa: "${term}"\n\nBao gồm:\n1. Định nghĩa y khoa chính xác\n2. Giải thích bằng ngôn ngữ đơn giản\n3. Ví dụ lâm sàng thực tế\n4. Khi nào cần gặp bác sĩ\n\nTrả lời bằng TIẾNG VIỆT, gần gũi và dễ hiểu.`
        : `Explain the medical term: "${term}"\n\nInclude:\n1. Precise medical definition\n2. Plain language explanation\n3. Real clinical examples\n4. When to see a doctor\n\nRespond in ENGLISH, friendly and easy to understand.`;
    const { text } = await this.tryGenerate(prompt, 'general', language);
    return { term, explanation: text, confidence: 0.9 };
  }

  public async getLifestyleAdvice(topic: string): Promise<LifestyleAdvice> {
    const language = this.detectLanguage(topic);
    const prompt =
      language === 'vi'
        ? `Cung cấp lời khuyên chi tiết về lối sống cho chủ đề: "${topic}"\n\nYêu cầu:\n1. Giải thích tầm quan trọng\n2. Đưa ra 3–5 lời khuyên cụ thể\n3. Những điều nên tránh\n4. Kết thúc bằng lưu ý quan trọng\n\n⚕️ Thông tin này chỉ mang tính giáo dục.`
        : `Provide detailed lifestyle advice for: "${topic}"\n\nRequirements:\n1. Why this topic matters\n2. 3–5 actionable tips\n3. What to avoid\n4. Important closing notes\n\n⚕️ Educational purposes only.`;

    const { text, usedFallback } = await this.tryGenerate(prompt, 'lifestyle', language);
    return { topic, advice: text, confidence: usedFallback ? 0.5 : 0.85, category: 'lifestyle' };
  }

  // ==================== PUBLIC UTILITIES ====================

  public clearHistory(): void {
    this.conversationHistory = [];
    this.languageCache.clear();
    this.assessmentSession = null;
    this.accumulatedSymptomText = '';
    this.patientProfile = null;
    this.resetBookingState();
    this.lastAssessedUrgency = 'low';
  }

  public getHistory(): AIMessage[] {
    return [...this.conversationHistory];
  }

  public getLastDetectedLanguage(): Language | null {
    return this.conversationHistory.at(-1)?.language ?? null;
  }

  public getAssessmentState() {
    const quickTriage = ClinicalTriageEngine.score(
      this.accumulatedSymptomText,
      this.assessmentSession?.language ?? 'vi',
      this.patientProfile
    );
    return {
      active: !!this.assessmentSession,
      phase: this.assessmentSession?.phase ?? 'idle',
      turnCount: this.assessmentSession?.turnCount ?? 0,
      urgencyPreview: ClinicalTriageEngine.scoreToUrgency(quickTriage.score),
      bookingSuggested: this.bookingSuggested,
      bookingConfirmed: this.bookingConfirmed,
      bookingDeclined: this.bookingDeclined,
    };
  }

  public forceCompleteAssessment(language?: Language): ClinicalAssessment {
    const lang = language ?? this.getLastDetectedLanguage() ?? 'vi';
    if (this.assessmentSession) this.assessmentSession.phase = 'assessing';
    return this.buildClinicalAssessment(lang);
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
    const s = await this.specialtyManager.getAllSpecialties();
    return s.map(sp => ({ id: sp.id, name: sp.name, icon: sp.icon, color: sp.color, category: sp.category }));
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

// ==================== SESSION MANAGER ====================

const serviceInstances = new Map<string, AIMedicalService>();
const serviceLastUsed = new Map<string, number>();
const SERVICE_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 phút
const MAX_SESSIONS = 500; // FIX: giới hạn tổng số session

export function getServiceForSession(sessionId: string): AIMedicalService {
  if (!serviceInstances.has(sessionId)) {
    // FIX: Cleanup nếu vượt giới hạn trước khi tạo mới
    if (serviceInstances.size >= MAX_SESSIONS) {
      // Xóa session cũ nhất
      let oldestId = '';
      let oldestTime = Infinity;
      for (const [id, time] of serviceLastUsed) {
        if (time < oldestTime) { oldestTime = time; oldestId = id; }
      }
      if (oldestId) {
        serviceInstances.delete(oldestId);
        serviceLastUsed.delete(oldestId);
      }
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

// FIX: Cleanup interval đúng cách với clearInterval khi cần
const cleanupIntervalRef = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, lastUsed] of serviceLastUsed) {
    if (now - lastUsed > SERVICE_IDLE_TIMEOUT) {
      serviceInstances.delete(id);
      serviceLastUsed.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[SessionManager] Cleaned up ${cleaned} idle sessions`);
}, 15 * 60 * 1000);

// Export để có thể stop khi test
export function stopSessionCleanup(): void {
  clearInterval(cleanupIntervalRef);
}
