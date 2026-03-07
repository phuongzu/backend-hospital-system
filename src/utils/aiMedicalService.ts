import Groq from 'groq-sdk';
import { config } from '../config/config';
import Specialty from '../models/specialty';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Review from '../models/review';
import { PatientProfileService } from './PatientProfileService';
import { SymptomTrackerService } from '../data/Symptomtracker';
import { auditLogger } from '../middlewares/SecurityMiddleware';

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
  // NEW: clinical assessment fields
  clinicalAssessment?: ClinicalAssessment;
  triageScore?: number;
  urgencyLevel?: UrgencyLevel;
}

// ==================== NEW: CLINICAL ASSESSMENT ====================

export interface ClinicalAssessment {
  collectedSymptoms: CollectedSymptom[];
  urgencyLevel: UrgencyLevel;
  triageScore: number;           // 0–100, higher = more urgent
  redFlagsDetected: string[];
  probableDifferentials: string[]; // likely conditions (not a diagnosis)
  recommendedAction: RecommendedAction;
  assessmentComplete: boolean;
  riskFactors: string[];         // from patient profile
  painScore?: number;            // 0–10 if reported
  vitalsConcern?: string[];      // HR, BP, breathing concerns mentioned
}

export interface CollectedSymptom {
  name: string;
  severity?: number;             // 1–10
  duration?: string;
  location?: string;
  character?: string;            // sharp, dull, burning, etc.
  aggravatingFactors?: string[];
  relievingFactors?: string[];
  associatedSymptoms?: string[];
}

export type RecommendedAction =
  | 'call_emergency'             // critical/high → 115/911
  | 'urgent_appointment'         // high → within 24h
  | 'soon_appointment'           // medium → within 2-3 days
  | 'routine_appointment'        // low → within a week
  | 'self_care'                  // very low → home management
  | 'more_info_needed';          // still gathering

// ==================== SYMPTOM COLLECTION STATE MACHINE ====================
// Tracks multi-turn conversation to collect structured symptom info

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
  bookingMessage?: string;       // NEW: UI display message
  emergencyInstructions?: string; // NEW: for high urgency
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
  userId?: string;
  sessionId?: string;
  action: 'chat_message' | 'appointment_booked' | 'emergency_triggered' | 'handoff_requested';
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

// ==================== CONSTANTS ====================

const MAX_HISTORY_LENGTH = 16;
const MAX_REQUESTS_PER_MINUTE = 25;
const LANGUAGE_CACHE_MAX_SIZE = 100;
const QUOTA_COOLDOWN_MS = 3 * 60 * 1000;
const SPECIALTY_CACHE_TTL = 5 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 1200;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_ASSESSMENT_TURNS = 5; // max turns before forcing assessment

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

// ==================== TRIAGE SCORING ENGINE ====================
// Each entry: { pattern, score, redFlag, specialty }
// score 0-100: higher = more urgent
// redFlag: true = always escalate to high/critical

interface TriageRule {
  patterns: { vi: string[]; en: string[] };
  score: number;        // urgency score contribution
  redFlag: boolean;     // immediate escalation
  specialty?: string;   // suggested specialty
  category?: string;
}

const TRIAGE_RULES: TriageRule[] = [
  // ─── CRITICAL (score ≥ 90) ───
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
  // ─── HIGH (score 70–89) ───
  {
    patterns: {
      vi: ['đau ngực', 'tức ngực', 'tim đập loạn', 'hồi hộp kèm đau', 'nhịp tim không đều'],
      en: ['chest pain', 'chest tightness', 'irregular heartbeat with pain', 'palpitations with chest pain'],
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
      vi: ['đau đầu dữ dội đột ngột', 'đau đầu tệ nhất đời', 'thunderclap headache'],
      en: ['sudden severe headache', 'worst headache of life', 'thunderclap headache'],
    },
    score: 85, redFlag: true, specialty: 'neurology',
  },
  {
    patterns: {
      vi: ['khó thở tăng dần', 'thở khò khè nặng', 'hen cấp', 'không thở được bình thường'],
      en: ['worsening shortness of breath', 'severe wheezing', 'acute asthma', 'difficulty breathing'],
    },
    score: 78, redFlag: false, specialty: 'pulmonology',
  },
  {
    patterns: {
      vi: ['sụt cân không rõ nguyên nhân', 'gầy nhanh', 'sụt 5kg không rõ lý do'],
      en: ['unexplained weight loss', 'rapid weight loss', 'losing weight without reason'],
    },
    score: 72, redFlag: false, specialty: 'oncology',
  },
  {
    patterns: {
      vi: ['nôn ra máu', 'đi ngoài phân đen', 'phân có máu', 'tiểu ra máu'],
      en: ['vomiting blood', 'black tarry stool', 'blood in stool', 'blood in urine'],
    },
    score: 82, redFlag: true, specialty: 'gastroenterology',
  },
  {
    patterns: {
      vi: ['mặt xệ', 'nói ngọng đột ngột', 'tay yếu đột ngột', 'tê liệt đột ngột'],
      en: ['facial droop', 'sudden slurred speech', 'sudden arm weakness', 'sudden numbness'],
    },
    score: 90, redFlag: true, specialty: 'neurology',
  },
  // ─── MEDIUM (score 40–69) ───
  {
    patterns: {
      vi: ['đau kéo dài nhiều ngày', 'đau không giảm', 'đau mấy ngày rồi', 'đau 3 ngày', 'đau 5 ngày'],
      en: ['pain for several days', 'persistent pain', 'pain not improving', 'pain for 3 days', 'pain for a week'],
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
      vi: ['huyết áp cao', 'huyết áp 160', 'huyết áp 180', 'tăng huyết áp'],
      en: ['high blood pressure', 'hypertension', 'blood pressure 160', 'blood pressure 180'],
    },
    score: 58, redFlag: false, specialty: 'cardiology',
  },
  {
    patterns: {
      vi: ['đường huyết cao', 'đường huyết thấp', 'tiểu đường mất kiểm soát', 'hạ đường huyết'],
      en: ['high blood sugar', 'low blood sugar', 'uncontrolled diabetes', 'hypoglycemia'],
    },
    score: 62, redFlag: false, specialty: 'endocrinology',
  },
  {
    patterns: {
      vi: ['mệt mỏi kéo dài', 'kiệt sức không rõ nguyên nhân', 'mệt mỏi hàng tuần'],
      en: ['prolonged fatigue', 'chronic exhaustion', 'weeks of fatigue'],
    },
    score: 45, redFlag: false, specialty: 'internal_medicine',
  },
  {
    patterns: {
      vi: ['ho ra máu', 'ho kéo dài hơn 2 tuần', 'ho ra đờm màu lạ'],
      en: ['coughing blood', 'cough lasting over 2 weeks', 'coughing colored sputum'],
    },
    score: 65, redFlag: false, specialty: 'pulmonology',
  },
  {
    patterns: {
      vi: ['đau khớp nhiều khớp', 'sưng khớp', 'cứng khớp buổi sáng kéo dài'],
      en: ['multiple joint pain', 'swollen joints', 'prolonged morning stiffness'],
    },
    score: 48, redFlag: false, specialty: 'orthopedics',
  },
  {
    patterns: {
      vi: ['lo âu nặng', 'trầm cảm', 'không muốn sống', 'có ý định tự hại'],
      en: ['severe anxiety', 'depression', 'suicidal thoughts', 'self-harm thoughts'],
    },
    score: 75, redFlag: true, specialty: 'psychiatry',
  },
  // ─── LOW (score 10–39) ───
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
  {
    patterns: {
      vi: ['cảm cúm nhẹ', 'sổ mũi', 'hắt hơi', 'ho nhẹ', 'đau họng nhẹ'],
      en: ['mild cold', 'runny nose', 'sneezing', 'mild cough', 'sore throat'],
    },
    score: 15, redFlag: false, specialty: 'ent',
  },
];

// ─── RED FLAG COMBINATIONS ───
// When these symptom combos occur together → always escalate

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
      { vi: ['bụng cứng', 'căng cứng'], en: ['rigid abdomen', 'board-like abdomen'] },
      { vi: ['sốt'], en: ['fever'] },
    ],
    reason: { vi: 'Nguy cơ viêm phúc mạc', en: 'Possible peritonitis' },
    escalateTo: 'critical', specialty: 'surgery',
  },
  {
    symptoms: [
      { vi: ['đau lưng dữ dội'], en: ['severe back pain'] },
      { vi: ['tiểu ra máu', 'nước tiểu màu đỏ'], en: ['blood in urine', 'red urine'] },
    ],
    reason: { vi: 'Nguy cơ sỏi thận / tắc niệu quản', en: 'Possible kidney stone / ureteral obstruction' },
    escalateTo: 'high', specialty: 'urology',
  },
  {
    symptoms: [
      { vi: ['đau đầu'], en: ['headache'] },
      { vi: ['mờ mắt', 'nhìn mờ'], en: ['blurred vision', 'vision changes'] },
      { vi: ['buồn nôn'], en: ['nausea'] },
    ],
    reason: { vi: 'Nguy cơ tăng áp lực nội sọ hoặc đột quỵ', en: 'Possible increased intracranial pressure or stroke' },
    escalateTo: 'critical', specialty: 'neurology',
  },
];

// ─── COMORBIDITY RISK MULTIPLIERS ───
// Patient conditions that increase urgency score

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
    conditions: ['tim mạch', 'bệnh tim', 'heart disease', 'coronary artery disease'],
    multiplier: 1.3,
    note: { vi: 'Bệnh tim làm tăng nguy cơ đáng kể', en: 'Heart disease significantly increases risk' },
  },
  {
    conditions: ['cao huyết áp', 'tăng huyết áp', 'hypertension', 'blood pressure'],
    multiplier: 1.15,
    note: { vi: 'Huyết áp cao là yếu tố nguy cơ tim mạch', en: 'Hypertension is a cardiovascular risk factor' },
  },
  {
    conditions: ['ung thư', 'cancer', 'hóa trị', 'xạ trị', 'chemotherapy'],
    multiplier: 1.4,
    note: { vi: 'Bệnh nhân ung thư cần theo dõi sát', en: 'Cancer patients require close monitoring' },
  },
  {
    conditions: ['suy thận', 'kidney failure', 'dialysis', 'lọc thận'],
    multiplier: 1.35,
    note: { vi: 'Suy thận làm giảm khả năng thải độc', en: 'Kidney failure impairs toxin clearance' },
  },
  {
    conditions: ['suy gan', 'liver failure', 'xơ gan', 'cirrhosis'],
    multiplier: 1.3,
    note: { vi: 'Bệnh gan ảnh hưởng chuyển hóa thuốc', en: 'Liver disease affects drug metabolism' },
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

// ─── AGE RISK ───
const getAgeRiskMultiplier = (age?: number): number => {
  if (!age) return 1.0;
  if (age < 2) return 1.5;
  if (age < 12) return 1.2;
  if (age > 65) return 1.25;
  if (age > 80) return 1.4;
  return 1.0;
};

// ─── PAIN SCORE EXTRACTION ───
const PAIN_SCORE_REGEX =
  /(?:đau|pain|mức độ|intensity|score)\s*(?:khoảng|khoảng chừng|about|around)?\s*(\d{1,2})\s*(?:\/10|trên 10|out of 10)?/i;

// ─── DURATION PATTERNS ───
const DURATION_PATTERNS = {
  vi: /(\d+)\s*(phút|giờ|ngày|tuần|tháng|năm)/i,
  en: /(\d+)\s*(minute|hour|day|week|month|year)/i,
};

// ─── STRUCTURED ASSESSMENT QUESTIONS ───

interface AssessmentQuestion {
  phase: AssessmentPhase;
  question: { vi: string; en: string };
  followIf?: string; // phase to follow after answer
}

const ASSESSMENT_QUESTIONS: Record<string, AssessmentQuestion[]> = {
  // After main symptom identified, ask these in order
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
        vi: 'Trên thang điểm 1–10, mức độ đau/khó chịu của bạn là bao nhiêu? (1 = rất nhẹ, 10 = không chịu được)',
        en: 'On a scale of 1–10, how severe is your pain/discomfort? (1 = very mild, 10 = unbearable)',
      },
    },
    {
      phase: 'collecting_associated',
      question: {
        vi: 'Có triệu chứng nào khác đi kèm không? (ví dụ: sốt, buồn nôn, chóng mặt, khó thở)',
        en: 'Are there any other symptoms? (e.g., fever, nausea, dizziness, shortness of breath)',
      },
    },
    {
      phase: 'collecting_history',
      question: {
        vi: 'Bạn có bệnh nền nào không? (ví dụ: tiểu đường, huyết áp, tim mạch)',
        en: 'Do you have any underlying conditions? (e.g., diabetes, hypertension, heart disease)',
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
      phase: 'collecting_duration',
      question: {
        vi: 'Cơn đau đầu kéo dài bao lâu và bắt đầu đột ngột hay từ từ?',
        en: 'How long has it lasted, and did it come on suddenly or gradually?',
      },
    },
    {
      phase: 'collecting_severity',
      question: {
        vi: 'Mức độ đau từ 1–10? Có kèm buồn nôn, nhạy cảm ánh sáng, mờ mắt không?',
        en: 'Pain score 1–10? Any nausea, light sensitivity, or vision changes?',
      },
    },
  ],
  abdominal: [
    {
      phase: 'collecting_location',
      question: {
        vi: 'Đau ở vùng nào của bụng? (trên rốn, dưới rốn, hố chậu phải, hố chậu trái?)',
        en: 'Where exactly is the abdominal pain? (upper, lower, right lower quadrant, left lower quadrant?)',
      },
    },
    {
      phase: 'collecting_duration',
      question: {
        vi: 'Đau kéo dài bao lâu? Đau liên tục hay từng cơn? Có liên quan đến ăn uống không?',
        en: 'How long has it lasted? Constant or colicky? Related to eating?',
      },
    },
    {
      phase: 'collecting_associated',
      question: {
        vi: 'Có kèm sốt, nôn, tiêu chảy, táo bón, hoặc phân/nước tiểu có màu bất thường không?',
        en: 'Any fever, vomiting, diarrhea, constipation, or changes in stool/urine color?',
      },
    },
  ],
  chest: [
    {
      phase: 'collecting_location',
      question: {
        vi: 'Đau ở vị trí nào trong ngực? Có lan ra tay trái, hàm, lưng không?',
        en: 'Where in the chest? Does it radiate to the left arm, jaw, or back?',
      },
    },
    {
      phase: 'collecting_duration',
      question: {
        vi: 'Cơn đau ngực bắt đầu khi nào? Đau liên tục hay từng lúc?',
        en: 'When did chest pain start? Constant or intermittent?',
      },
    },
    {
      phase: 'collecting_associated',
      question: {
        vi: 'Có kèm khó thở, đổ mồ hôi, buồn nôn, hồi hộp, hoặc chóng mặt không?',
        en: 'Any shortness of breath, sweating, nausea, palpitations, or dizziness?',
      },
    },
  ],
};

// ==================== EMERGENCY TYPES ====================

type EmergencyProtocol = 'cardiac_emergency' | 'stroke_emergency' | 'respiratory_emergency' | 'psychiatric_emergency';

const EMERGENCY_KEYWORDS: Record<EmergencyProtocol, string[]> = {
  cardiac_emergency: [
    'chest pain', 'đau ngực', 'heart pain', 'đau tim', 'palpitations',
    'đánh trống ngực', 'tightness in chest', 'tức ngực',
    'heart attack', 'nhồi máu cơ tim', 'đau ngực dữ dội', 'cardiac arrest',
    'ngừng tim',
  ],
  stroke_emergency: [
    'facial drooping', 'mặt xệ', 'méo miệng', 'arm weakness', 'tay yếu',
    'liệt tay', 'speech difficulty', 'nói khó', 'nói ngọng',
    'sudden numbness', 'tê liệt đột ngột', 'đột quỵ', 'stroke',
    'mất ý thức đột ngột', 'sudden loss of consciousness',
  ],
  respiratory_emergency: [
    'breathing difficulty', 'khó thở nặng', 'choking', 'ngạt thở',
    'nghẹt thở', 'blue lips', 'môi tím', 'severe asthma', 'hen nặng',
    'không thở được', 'cannot breathe', 'tím tái',
  ],
  psychiatric_emergency: [
    'muốn tự tử', 'không muốn sống', 'tự làm đau', 'suicidal',
    'want to die', 'kill myself', 'end my life', 'self harm',
    'ý định tự hại',
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

⚠️ Nếu có Aspirin và không bị dị ứng, nhai 1 viên 325mg trong khi chờ cấp cứu.

⚕️ Đây là tình huống y tế khẩn cấp. Hành động ngay!`,
    stroke_emergency: `🚨 **CẤP CỨU ĐỘT QUỴ — THỜI GIAN LÀ BỘ NÃO!**

Nhớ quy tắc **FAST**:
- 🗣️ **F** — FACE (Mặt): Miệng có bị lệch không?
- 💪 **A** — ARMS (Tay): Giơ cả hai tay lên — có tay nào yếu/rơi xuống không?
- 🗨️ **S** — SPEECH (Nói): Nói có ngọng/khó nghe không?
- ⏰ **T** — TIME: **GỌI 115 NGAY!**

⚠️ **CỬA SỔ VÀNG là 4.5 giờ** — điều trị càng sớm càng ít di chứng!
🚫 Không cho ăn uống, không để nằm đầu thấp`,
    respiratory_emergency: `🚨 **CẤP CỨU HÔ HẤP — NGUY CẤP!**

1. 🚑 **GỌI 115 NGAY**
2. 💨 Giữ đường thở thông thoáng — ngẩng đầu nhẹ
3. 🪑 Để bệnh nhân ngồi tư thế thoải mái (không nằm)
4. 🌬️ Nếu có thuốc xịt hen → xịt ngay theo chỉ định
5. 🚪 Mở cửa sổ, tạo không khí thông thoáng

⚠️ KHÔNG để một mình — ở cạnh đến khi cấp cứu đến!`,
    psychiatric_emergency: `🚨 **HỖ TRỢ SỨC KHỎE TÂM THẦN KHẨN CẤP**

Tôi rất lo lắng cho bạn. Bạn không phải một mình.

📞 **Gọi ngay:**
- Đường dây hỗ trợ tâm lý: **1800 599 920** (miễn phí)
- Cấp cứu: **115**
- Hoặc đến khoa Tâm Thần bệnh viện gần nhất

💙 Xin hãy nói chuyện với ai đó ngay bây giờ — bạn xứng đáng được giúp đỡ.`,
  },
  en: {
    cardiac_emergency: `🚨 **CARDIAC EMERGENCY — IMMEDIATE ACTION REQUIRED!**

1. 🚑 **CALL 911/115 NOW** — Do not wait
2. 🏥 Go to nearest hospital with **Cardiac Unit**
3. 💊 **Lie down**, avoid any physical exertion
4. 📞 Notify family/someone nearby immediately
5. 🚫 **DO NOT drive yourself**

⚠️ If you have Aspirin and are not allergic, chew 1 tablet (325mg) while waiting.

⚕️ This is a medical emergency. Act now!`,
    stroke_emergency: `🚨 **STROKE EMERGENCY — TIME IS BRAIN!**

Remember **FAST**:
- 🗣️ **F** — FACE: Is the face drooping on one side?
- 💪 **A** — ARMS: Can both arms be raised equally?
- 🗨️ **S** — SPEECH: Is speech slurred or strange?
- ⏰ **T** — TIME: **CALL 911/115 NOW!**

⚠️ **Golden window is 4.5 hours** — earlier treatment = better outcome!
🚫 No food or drink, do not lower the head`,
    respiratory_emergency: `🚨 **RESPIRATORY EMERGENCY — CRITICAL!**

1. 🚑 **CALL 911/115 NOW**
2. 💨 Keep airway clear — tilt head slightly back
3. 🪑 Sit patient upright (do not lie flat)
4. 🌬️ Use inhaler if prescribed and available
5. 🚪 Open windows for fresh air

⚠️ Stay with the person until help arrives!`,
    psychiatric_emergency: `🚨 **MENTAL HEALTH CRISIS SUPPORT**

I'm very concerned about you. You are not alone.

📞 **Call now:**
- Crisis hotline: **988** (Suicide & Crisis Lifeline)
- Emergency: **911/115**
- Or go to the nearest psychiatric emergency

💙 Please talk to someone right now — you deserve support.`,
  },
};

// ─── URGENCY ROUTING MESSAGES ───

const URGENCY_ROUTING: Record<UrgencyLevel, { vi: string; en: string; timeframe: { vi: string; en: string } }> = {
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
    vi: '📋 Nên đặt lịch khám **trong 2–3 ngày** tới.',
    en: '📋 Schedule an appointment **within 2–3 days**.',
    timeframe: { vi: 'Trong 2-3 ngày', en: 'Within 2-3 days' },
  },
  low: {
    vi: '📅 Có thể đặt lịch khám định kỳ **trong tuần này**.',
    en: '📅 Schedule a routine checkup **this week**.',
    timeframe: { vi: 'Trong tuần này', en: 'Within this week' },
  },
};

// ─── FALLBACK RESPONSES ───

type FallbackKey = 'general' | 'cardiology' | 'emergency' | 'medications';

const FALLBACK_RESPONSES: Record<Language, Record<FallbackKey, string>> = {
  vi: {
    general: `Xin lỗi, dịch vụ AI tạm thời không khả dụng.\n\n⚠️ Vui lòng tham khảo bác sĩ chuyên khoa.\nNếu có triệu chứng nghiêm trọng, gọi 115 ngay.\n\n⚕️ Thông tin này chỉ mang tính giáo dục.`,
    cardiology: `Về vấn đề tim mạch:\n⚠️ Hãy đặt lịch khám tim mạch ngay.\n🚨 Gọi 115 nếu: Đau ngực dữ dội, Khó thở nặng.\n\n⚕️ Thông tin này chỉ mang tính giáo dục.`,
    emergency: `🚨 GỌI CẤP CỨU 115 NGAY LẬP TỨC!\n🏥 ĐẾN BỆNH VIỆN GẦN NHẤT`,
    medications: `⚠️ Tham khảo dược sĩ hoặc bác sĩ về thuốc.\n\n⚕️ Thông tin này chỉ mang tính giáo dục.`,
  },
  en: {
    general: `I apologize, the AI service is temporarily unavailable.\n\n⚠️ Please consult a qualified doctor.\nFor severe symptoms, call 911/115 immediately.\n\n⚕️ Educational purposes only.`,
    cardiology: `Regarding cardiac concern:\n⚠️ Schedule a cardiology appointment.\n🚨 Call 911/115 for severe chest pain or shortness of breath.\n\n⚕️ Educational purposes only.`,
    emergency: `🚨 CALL 911/115 IMMEDIATELY!\n🏥 GO TO NEAREST HOSPITAL`,
    medications: `⚠️ Consult a pharmacist or doctor about medications.\n\n⚕️ Educational purposes only.`,
  },
};

// ==================== CUSTOM ERRORS ====================

class QuotaExceededError extends Error {
  constructor() { super('QUOTA_EXCEEDED'); this.name = 'QuotaExceededError'; }
}
class EmptyMessageError extends Error {
  constructor() { super('Empty message'); this.name = 'EmptyMessageError'; }
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
    try { await this.fetchPromise; } finally { this.fetchPromise = null; }
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
      if (score > best.score) best = { category: spec.category, specialtyId: id, score };
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
      if (spec.name.normalize('NFC').toLowerCase().includes(normalizedName) ||
          normalizedName.includes(spec.name.normalize('NFC').toLowerCase())) {
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
    if (!spec) return language === 'vi' ? 'Chuyên khoa: Y HỌC TỔNG QUÁT' : 'Specialty: GENERAL MEDICINE';
    return language === 'vi'
      ? `Chuyên khoa: ${spec.name.toUpperCase()}. Tư vấn về ${spec.name.toLowerCase()}.`
      : `Specialty: ${spec.name.toUpperCase()}. Providing information about ${spec.name.toLowerCase()}.`;
  }
}

// ==================== CLINICAL TRIAGE ENGINE ====================

class ClinicalTriageEngine {
  /**
   * Score the conversation text using the triage rules.
   * Returns: score 0–100, matched rules, red flags, recommended specialty
   */
  static score(
    text: string,
    language: Language,
    patientProfile?: PatientProfile | null,
  ): {
    score: number;
    redFlags: string[];
    matchedRules: TriageRule[];
    suggestedSpecialty?: string;
    riskFactors: string[];
    redFlagCombo?: RedFlagCombo;
  } {
    const normalized = text.normalize('NFC').toLowerCase();
    const redFlags: string[] = [];
    const matchedRules: TriageRule[] = [];
    let baseScore = 0;
    let topSpecialty: string | undefined;
    let topScore = 0;

    // 1. Apply triage rules
    for (const rule of TRIAGE_RULES) {
      const patterns = language === 'vi' ? rule.patterns.vi : rule.patterns.en;
      // Also check the opposite language for bilingual users
      const altPatterns = language === 'vi' ? rule.patterns.en : rule.patterns.vi;
      const allPatterns = [...patterns, ...altPatterns];

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

    // 2. Check red flag combinations
    let redFlagCombo: RedFlagCombo | undefined;
    for (const combo of RED_FLAG_COMBOS) {
      // combo requires ALL symptom groups to match
      const allMatch = combo.symptoms.every(symptomGroup => {
        const viWords = symptomGroup.vi;
        const enWords = symptomGroup.en;
        return [...viWords, ...enWords].some(w =>
          normalized.includes(w.normalize('NFC').toLowerCase())
        );
      });
      if (allMatch) {
        redFlagCombo = combo;
        const reason = language === 'vi' ? combo.reason.vi : combo.reason.en;
        if (!redFlags.includes(reason)) redFlags.push(reason);
        // Combo always escalates score significantly
        baseScore = Math.max(baseScore, combo.escalateTo === 'critical' ? 95 : 82);
        if (combo.specialty) topSpecialty = combo.specialty;
        break;
      }
    }

    // 3. Extract pain score from text
    const painMatch = PAIN_SCORE_REGEX.exec(text);
    if (painMatch) {
      const painScore = parseInt(painMatch[1], 10);
      if (painScore >= 8) baseScore = Math.max(baseScore, 75);
      else if (painScore >= 6) baseScore = Math.max(baseScore, 55);
    }

    // 4. Apply comorbidity multipliers from patient profile
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

      // Age risk
      const ageMult = getAgeRiskMultiplier(patientProfile.age);
      if (ageMult > 1.0) {
        baseScore = Math.min(100, Math.round(baseScore * ageMult));
        const ageNote = language === 'vi'
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
    };
  }

  static scoreToUrgency(score: number): UrgencyLevel {
    if (score >= 90) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  /**
   * Extract probable differentials from matched rules (not a diagnosis!)
   */
  static extractDifferentials(matchedRules: TriageRule[], language: Language): string[] {
    const specialties = [...new Set(matchedRules.map(r => r.specialty).filter(Boolean) as string[])];
    // Map specialty names to layman differential hints
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
      surgery: { vi: 'Có thể cần can thiệp phẫu thuật', en: 'Possible surgical intervention needed' },
      internal_medicine: { vi: 'Bệnh lý nội khoa', en: 'Internal medicine condition' },
    };
    return specialties.map(s => (map[s] ? (language === 'vi' ? map[s].vi : map[s].en) : s));
  }

  /**
   * Extract pain score from free text
   */
  static extractPainScore(text: string): number | undefined {
    const m = PAIN_SCORE_REGEX.exec(text);
    if (!m) return undefined;
    const v = parseInt(m[1], 10);
    return v >= 1 && v <= 10 ? v : undefined;
  }

  /**
   * Extract duration string from message
   */
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

  // Assessment state machine
  private assessmentSession: AssessmentSession | null = null;
  // Accumulated full-conversation text for triage (grows with each turn)
  private accumulatedSymptomText = '';

  constructor() {
    if (!config.groqApiKey) throw new Error('Groq API key is required.');
    this.groq = new Groq({ apiKey: config.groqApiKey });
    this.specialtyManager = new SpecialtyManager();
  }

  // ==================== PUBLIC: HISTORY ====================

  public loadHistoryFromDB(messages: Array<{
    role: MessageRole; content: string; timestamp: Date; category?: string; language?: string;
  }>): void {
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

  // ==================== LOAD PATIENT PROFILE ====================

  public async loadPatientProfile(userId: string): Promise<void> {
    this.patientProfile = await PatientProfileService.getProfile(userId);
  }

  // ==================== RATE LIMITING ====================

  private isRateLimited(): boolean {
    const now = Date.now();
    if (now > this.requestResetTime) { this.requestCount = 0; this.requestResetTime = now + 60_000; }
    return this.requestCount >= MAX_REQUESTS_PER_MINUTE;
  }

  private recordRequest(): void { this.requestCount++; }

  // ==================== CIRCUIT BREAKER ====================

  private isQuotaExceeded(): boolean {
    if (!this.quotaExceededUntil) return false;
    if (Date.now() > this.quotaExceededUntil) { this.quotaExceededUntil = null; return false; }
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

  // ==================== ASSESSMENT STATE MACHINE ====================

  /**
   * Detect what type of symptom the user is reporting, to start structured collection
   */
  private detectSymptomType(message: string): string | null {
    const lower = message.normalize('NFC').toLowerCase();
    const typeMap: Array<{ type: string; vi: string[]; en: string[] }> = [
      { type: 'chest', vi: ['đau ngực', 'tức ngực', 'nặng ngực', 'tim đau'], en: ['chest pain', 'chest tightness', 'heart pain'] },
      { type: 'headache', vi: ['đau đầu', 'nhức đầu', 'đau nửa đầu'], en: ['headache', 'head pain', 'migraine'] },
      { type: 'abdominal', vi: ['đau bụng', 'bụng đau', 'đau dạ dày'], en: ['stomach ache', 'abdominal pain', 'belly pain', 'stomach pain'] },
      { type: 'general', vi: ['mệt mỏi', 'mệt', 'sốt', 'chóng mặt', 'buồn nôn'], en: ['tired', 'fatigue', 'fever', 'dizzy', 'nausea'] },
    ];
    for (const entry of typeMap) {
      if ([...entry.vi, ...entry.en].some(k => lower.includes(k.normalize('NFC').toLowerCase()))) {
        return entry.type;
      }
    }
    return null;
  }

  /**
   * Start or continue a structured symptom assessment session
   */
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
    };
  }

  /**
   * Advance the session: parse the user's answer and move to next question
   */
  private advanceAssessment(userMessage: string): void {
    if (!this.assessmentSession) return;
    const sess = this.assessmentSession;
    sess.turnCount++;
    this.accumulatedSymptomText += ' ' + userMessage;

    // Try to extract structured data from the answer
    const duration = ClinicalTriageEngine.extractDuration(userMessage, sess.language);
    if (duration) sess.currentSymptom.duration = duration;

    const painScore = ClinicalTriageEngine.extractPainScore(userMessage);
    if (painScore) sess.currentSymptom.severity = painScore;

    // Advance phase
    const phaseOrder: AssessmentPhase[] = [
      'collecting_main_symptom', 'collecting_duration', 'collecting_severity',
      'collecting_location', 'collecting_associated', 'collecting_history', 'assessing',
    ];
    const currentIdx = phaseOrder.indexOf(sess.phase);
    if (currentIdx >= 0 && currentIdx < phaseOrder.length - 1) {
      sess.phase = phaseOrder[currentIdx + 1];
    }

    // Force completion after max turns to avoid infinite loop
    if (sess.turnCount >= MAX_ASSESSMENT_TURNS) {
      sess.phase = 'assessing';
    }
  }

  /**
   * Get the next question to ask in the assessment flow
   */
  private getNextAssessmentQuestion(language: Language): string | null {
    if (!this.assessmentSession) return null;
    const sess = this.assessmentSession;
    if (sess.phase === 'assessing' || sess.phase === 'complete') return null;

    const questions = ASSESSMENT_QUESTIONS[sess.symptomType] || ASSESSMENT_QUESTIONS.general;
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
    const fullText = this.accumulatedSymptomText ||
      this.conversationHistory.filter(m => m.role === 'user').map(m => m.content).join(' ');

    const triage = ClinicalTriageEngine.score(fullText, language, this.patientProfile);
    const urgencyLevel = ClinicalTriageEngine.scoreToUrgency(triage.score);
    const differentials = ClinicalTriageEngine.extractDifferentials(triage.matchedRules, language);
    const painScore = ClinicalTriageEngine.extractPainScore(fullText);

    // Collect symptoms from assessment session
    const collectedSymptoms: CollectedSymptom[] =
      this.assessmentSession?.collectedSymptoms.length
        ? this.assessmentSession.collectedSymptoms
        : [{ name: this.assessmentSession?.symptomType ?? 'unknown' }];

    // Determine recommended action
    let recommendedAction: RecommendedAction;
    if (urgencyLevel === 'critical') recommendedAction = 'call_emergency';
    else if (urgencyLevel === 'high') recommendedAction = 'urgent_appointment';
    else if (urgencyLevel === 'medium') recommendedAction = 'soon_appointment';
    else if (triage.score < 15) recommendedAction = 'self_care';
    else recommendedAction = 'routine_appointment';

    // Vital signs concerns from text
    const vitalsConcern: string[] = [];
    const vitalsPatterns: Array<{ pattern: RegExp; label: { vi: string; en: string } }> = [
      { pattern: /huyết áp|blood pressure|BP \d/i, label: { vi: 'Huyết áp bất thường', en: 'Abnormal blood pressure' } },
      { pattern: /tim đập nhanh|nhịp tim nhanh|rapid heart|tachycardia/i, label: { vi: 'Nhịp tim nhanh', en: 'Rapid heart rate' } },
      { pattern: /sốt cao|high fever|fever [34][0-9]/i, label: { vi: 'Sốt cao', en: 'High fever' } },
      { pattern: /khó thở|shortness of breath|breathing difficulty/i, label: { vi: 'Khó thở', en: 'Breathing difficulty' } },
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
    };
  }

  // ==================== EMERGENCY DETECTION ====================

  private detectEmergency(message: string): { isEmergency: boolean; protocol?: EmergencyProtocol } {
    const lower = message.normalize('NFC').toLowerCase();
    for (const [protocol, keywords] of Object.entries(EMERGENCY_KEYWORDS) as [EmergencyProtocol, string[]][]) {
      if (keywords.some(kw => lower.includes(kw.normalize('NFC').toLowerCase()))) {
        return { isEmergency: true, protocol };
      }
    }
    // Also check triage score for critical
    const triage = ClinicalTriageEngine.score(message, this.detectLanguage(message), this.patientProfile);
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
      keywords: ['tê bì', 'tê tay', 'tê chân', 'mất ngủ', 'đau đầu', 'chóng mặt', 'hoa mắt', 'đau nửa đầu', 'run tay', 'co giật', 'ngất', 'numbness', 'headache', 'dizziness', 'migraine', 'insomnia', 'tremor', 'seizure'],
      specialtyNames: ['neurology', 'thần kinh', 'nội thần kinh'],
    },
    {
      keywords: ['đau khớp', 'đau lưng', 'đau xương', 'đau cổ', 'đau vai', 'joint pain', 'back pain', 'arthritis', 'gout', 'gút', 'viêm khớp', 'thoát vị', 'cột sống', 'bone pain'],
      specialtyNames: ['orthopedic', 'orthopedics', 'cơ xương khớp', 'xương khớp'],
    },
    {
      keywords: ['ho', 'khó thở', 'hen', 'viêm phổi', 'viêm phế quản', 'cough', 'asthma', 'pneumonia', 'bronchitis', 'shortness of breath', 'wheezing', 'khò khè'],
      specialtyNames: ['pulmonology', 'respiratory', 'hô hấp', 'phổi'],
    },
    {
      keywords: ['mẩn ngứa', 'nổi mề đay', 'mụn', 'vảy nến', 'eczema', 'skin rash', 'acne', 'psoriasis', 'dermatitis', 'ngứa da', 'nám da', 'rosacea'],
      specialtyNames: ['dermatology', 'da liễu'],
    },
    {
      keywords: ['đau bụng', 'tiêu chảy', 'táo bón', 'buồn nôn', 'nôn', 'trào ngược', 'viêm dạ dày', 'stomach pain', 'diarrhea', 'constipation', 'nausea', 'gastritis', 'reflux', 'bloating', 'đầy hơi'],
      specialtyNames: ['gastroenterology', 'tiêu hóa'],
    },
    {
      keywords: ['đái tháo đường', 'tiểu đường', 'béo phì', 'tuyến giáp', 'hormone', 'diabetes', 'obesity', 'thyroid', 'nội tiết', 'insulin'],
      specialtyNames: ['endocrinology', 'nội tiết'],
    },
    {
      keywords: ['đau mắt', 'mờ mắt', 'đỏ mắt', 'khô mắt', 'cận thị', 'glaucoma', 'eye pain', 'blurry vision', 'red eye', 'dry eye', 'nhìn mờ'],
      specialtyNames: ['ophthalmology', 'mắt', 'nhãn khoa'],
    },
    {
      keywords: ['đau tai', 'ù tai', 'viêm tai', 'nghe kém', 'viêm mũi', 'viêm xoang', 'ear pain', 'tinnitus', 'sinusitis', 'tai mũi họng', 'sore throat', 'đau họng'],
      specialtyNames: ['ent', 'otolaryngology', 'tai mũi họng'],
    },
    {
      keywords: ['đau ngực', 'huyết áp', 'tim đập', 'nhịp tim', 'suy tim', 'chest pain', 'blood pressure', 'heart', 'cardiac', 'tim mạch', 'arrhythmia', 'loạn nhịp'],
      specialtyNames: ['cardiology', 'tim mạch'],
    },
    {
      keywords: ['ung thư', 'cancer', 'khối u', 'u bướu', 'tumor', 'lymphoma', 'chemotherapy', 'hóa trị'],
      specialtyNames: ['oncology', 'ung bướu'],
    },
    {
      keywords: ['lo âu', 'trầm cảm', 'stress', 'rối loạn tâm lý', 'anxiety', 'depression', 'mental health', 'tâm thần', 'tâm lý', 'panic', 'hoảng loạn'],
      specialtyNames: ['psychiatry', 'psychology', 'tâm thần', 'tâm lý'],
    },
    {
      keywords: ['tiểu rắt', 'tiểu buốt', 'tiểu ra máu', 'sỏi thận', 'kidney stone', 'urinary', 'bladder', 'bàng quang', 'prostate', 'tuyến tiền liệt'],
      specialtyNames: ['urology', 'tiết niệu'],
    },
    {
      keywords: ['kinh nguyệt', 'đau bụng kinh', 'có thai', 'mang thai', 'phụ khoa', 'menstrual', 'pregnancy', 'gynecology', 'ovarian', 'buồng trứng'],
      specialtyNames: ['gynecology', 'phụ khoa', 'sản phụ khoa'],
    },
  ];

  private async detectCategory(message: string): Promise<{ category: string; specialtyId?: string }> {
    const dbResult = await this.specialtyManager.detectCategory(message);
    if (dbResult.specialtyId && dbResult.category !== 'general') return dbResult;

    const normalizedMsg = message.normalize('NFC').toLowerCase();

    for (const entry of AIMedicalService.SYMPTOM_SPECIALTY_MAP) {
      if (!entry.keywords.some(kw => normalizedMsg.includes(kw.normalize('NFC').toLowerCase()))) continue;

      for (const name of entry.specialtyNames) {
        try {
          const spec = await Specialty.findOne({
            name: { $regex: new RegExp(name.normalize('NFC'), 'iu') },
            isActive: true,
          }).select('_id name category').lean();

          if (spec) {
            return { category: (spec as any).category || name, specialtyId: (spec as any)._id.toString() };
          }
        } catch { continue; }
      }
      return { category: entry.specialtyNames[0], specialtyId: undefined };
    }

    // Fallback: use triage to suggest specialty
    const triage = ClinicalTriageEngine.score(message, this.detectLanguage(message), this.patientProfile);
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

      const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);
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
        const docId = doctor._id.toString();
        const bookedSlots = bookedByDoctor.get(docId) || new Set();
        let slotsForDay = ALL_TIME_SLOTS;

        const daySchedule = (doctor.available_hours as any)?.[dayOfWeek];
        if (daySchedule) {
          if (daySchedule.isAvailable === false) continue;
          if (daySchedule.start && daySchedule.end) {
            slotsForDay = ALL_TIME_SLOTS.filter(s => s >= daySchedule.start && s <= daySchedule.end);
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

  // ==================== APPOINTMENT EVALUATION ====================

  private async evaluateAppointmentNeed(
    assessment: ClinicalAssessment,
    category: string,
    specialtyId: string | undefined,
    language: Language,
    userId?: string
  ): Promise<AppointmentSuggestion> {
    const urgencyLevel = assessment.urgencyLevel;

    // Critical/emergency: never book, call 115
    if (urgencyLevel === 'critical') {
      return {
        shouldBook: false,
        urgencyLevel: 'critical',
        symptoms: assessment.collectedSymptoms.map(s => s.name),
        reason: language === 'vi'
          ? '🚨 Tình trạng nguy cấp — GỌI 115 NGAY, không đặt lịch trực tuyến!'
          : '🚨 Critical condition — CALL 911/115 NOW, do not book online!',
        emergencyInstructions: language === 'vi'
          ? 'Gọi 115 ngay hoặc đến phòng cấp cứu bệnh viện gần nhất.'
          : 'Call 911/115 immediately or go to the nearest emergency room.',
      };
    }

    const symptoms = assessment.collectedSymptoms.map(s => s.name);

    // Check existing appointment
    if (userId) {
      try {
        const existing = await Appointment.findOne({
          user_id: userId,
          appointment_date: { $gte: new Date() },
          status: { $in: ['pending', 'confirmed'] },
        });
        if (existing) {
          return {
            shouldBook: false,
            urgencyLevel,
            symptoms,
            hasExistingAppointment: true,
            reason: language === 'vi'
              ? 'Bạn đã có lịch hẹn sắp tới. Hãy tham khảo bác sĩ về các triệu chứng này.'
              : 'You already have an upcoming appointment. Discuss these symptoms with your doctor.',
          };
        }
      } catch (err) { console.error('Error checking existing appointments:', err); }
    }

    const routing = URGENCY_ROUTING[urgencyLevel];

    let specialtyName = category;
    if (specialtyId) {
      const spec = await this.specialtyManager.getSpecialtyById(specialtyId);
      if (spec) specialtyName = spec.name;
    }

    // Contraindications from patient allergies
    let contraindications: string[] = [];
    if (this.patientProfile?.allergies.length) {
      contraindications = this.patientProfile.allergies.map(a =>
        language === 'vi' ? `Dị ứng đã biết: ${a}` : `Known allergy: ${a}`
      );
    }

    let suggestedDoctors: AppointmentSuggestion['suggestedDoctors'] = undefined;
    if (specialtyId && urgencyLevel !== 'low') {
      suggestedDoctors = await this.findAvailableDoctors(specialtyId);
    }

    const bookingMessage = language === 'vi'
      ? routing.vi
      : routing.en;

    return {
      shouldBook: true,
      urgencyLevel,
      suggestedSpecialty: specialtyName,
      suggestedSpecialtyId: specialtyId,
      recommendedTimeframe: language === 'vi' ? routing.timeframe.vi : routing.timeframe.en,
      reason: language === 'vi'
        ? urgencyLevel === 'high'
          ? 'Triệu chứng nghiêm trọng, cần khám bác sĩ sớm.'
          : 'Nên được đánh giá y tế để chẩn đoán chính xác.'
        : urgencyLevel === 'high'
          ? 'Serious symptoms require prompt medical evaluation.'
          : 'Medical evaluation recommended for accurate diagnosis.',
      symptoms,
      contraindications: contraindications.length ? contraindications : undefined,
      suggestedDoctors,
      bookingMessage,
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
CLINICAL ASSESSMENT ROLE:
══════════════════════════════════════════
Your primary role is to ASSESS symptom severity and ROUTE appropriately:

🔴 CRITICAL (score ≥ 90): Direct to emergency — "GỌI 115 NGAY" / "CALL 911/115 NOW"
🟠 HIGH (score 70–89): Urgent appointment within 24h — express urgency clearly
🟡 MEDIUM (score 40–69): Soon appointment 2–3 days — recommend booking
🟢 LOW (score < 40): Routine appointment or self-care — reassure and guide

When presenting an assessment:
1. Acknowledge the reported symptoms empathetically
2. State the urgency level clearly
3. Explain WHY this urgency level was assigned
4. Give the appropriate next action (call 115, book appointment, or self-care)
5. Provide immediate comfort measures if appropriate

══════════════════════════════════════════
SYMPTOM COLLECTION:
══════════════════════════════════════════
- If symptoms are vague, ask 1-2 targeted clarifying questions
- Collect: location, duration, severity (1-10), associated symptoms, medical history
- After collecting enough info (3-4 turns), provide a complete assessment

══════════════════════════════════════════
PATIENT PROFILE:
══════════════════════════════════════════
- Personalize all responses using the patient's profile
- ALWAYS warn if any recommendation conflicts with known allergies
- Consider comorbidities — they increase urgency
- NEVER recommend anything the patient is allergic to

══════════════════════════════════════════
SAFETY — MANDATORY:
══════════════════════════════════════════
✅ Always recommend consulting a doctor for accurate diagnosis
🚨 Always guide to call 115 (Vietnam) or 911 for dangerous symptoms
❌ Never diagnose diseases or prescribe medications
❌ Never claim to replace a doctor
⚠️ For mental health crises: provide crisis line 1800 599 920 (VN) / 988 (US)

FORMAT:
- Natural, warm tone
- Use emojis selectively
- Structured format for assessments
- Max 800 words per response
- End EVERY response with the disclaimer in the user's language`;
  }

  // ==================== PROMPT BUILDER ====================

  private async buildUserPrompt(
    userMessage: string,
    category: string,
    specialtyId: string | undefined,
    language: Language,
    assessment?: ClinicalAssessment,
    appointmentSuggestion?: AppointmentSuggestion,
    symptomHistory?: string
  ): Promise<string> {
    const langInstruction = language === 'vi'
      ? '🇻🇳 QUAN TRỌNG: Trả lời 100% bằng TIẾNG VIỆT.'
      : '🇬🇧 IMPORTANT: Respond 100% in ENGLISH.';

    const specialtyContext = await this.specialtyManager.getSpecialtyContext(specialtyId, language);
    const historyText = this.serializeHistory();
    const parts: string[] = [specialtyContext, langInstruction];

    if (this.patientProfile) {
      parts.push(PatientProfileService.buildContextBlock(this.patientProfile, language));
    }

    if (symptomHistory) parts.push(symptomHistory);

    // Inject clinical assessment context for AI to use
    if (assessment) {
      const triageBlock = language === 'vi'
        ? `ĐÁNH GIÁ LÂM SÀNG HỆ THỐNG:
- Điểm triage: ${assessment.triageScore}/100
- Mức độ khẩn cấp: ${assessment.urgencyLevel.toUpperCase()}
- Hành động khuyến nghị: ${assessment.recommendedAction}
- Triệu chứng thu thập: ${assessment.collectedSymptoms.map(s => s.name).join(', ')}
${assessment.painScore ? `- Điểm đau: ${assessment.painScore}/10` : ''}
${assessment.redFlagsDetected.length ? `- Dấu hiệu cảnh báo: ${assessment.redFlagsDetected.join('; ')}` : ''}
${assessment.riskFactors.length ? `- Yếu tố nguy cơ: ${assessment.riskFactors.join('; ')}` : ''}
${assessment.probableDifferentials.length ? `- Vấn đề có thể liên quan: ${assessment.probableDifferentials.join(', ')}` : ''}

Hãy trình bày đánh giá này cho bệnh nhân một cách rõ ràng, đồng cảm và hành động phù hợp với mức khẩn cấp trên.`
        : `SYSTEM CLINICAL ASSESSMENT:
- Triage score: ${assessment.triageScore}/100
- Urgency level: ${assessment.urgencyLevel.toUpperCase()}
- Recommended action: ${assessment.recommendedAction}
- Collected symptoms: ${assessment.collectedSymptoms.map(s => s.name).join(', ')}
${assessment.painScore ? `- Pain score: ${assessment.painScore}/10` : ''}
${assessment.redFlagsDetected.length ? `- Red flags: ${assessment.redFlagsDetected.join('; ')}` : ''}
${assessment.riskFactors.length ? `- Risk factors: ${assessment.riskFactors.join('; ')}` : ''}
${assessment.probableDifferentials.length ? `- Likely conditions: ${assessment.probableDifferentials.join(', ')}` : ''}

Present this assessment to the patient clearly, empathetically, with action appropriate to the urgency level above.`;
      parts.push(triageBlock);
    }

    if (historyText) {
      parts.push(language === 'vi'
        ? `LỊCH SỬ HỘI THOẠI:\n${historyText}`
        : `CONVERSATION HISTORY:\n${historyText}`);
    }

    parts.push(language === 'vi'
      ? `CÂU HỎI / THÔNG TIN BỆNH NHÂN: ${userMessage}`
      : `PATIENT MESSAGE: ${userMessage}`);

    if (appointmentSuggestion?.shouldBook) {
      parts.push(await this.buildBookingContextBlock(appointmentSuggestion, language));
    }

    if (appointmentSuggestion?.contraindications?.length) {
      const warn = language === 'vi'
        ? `⚠️ LƯU Ý DỊ ỨNG: ${appointmentSuggestion.contraindications.join('; ')}`
        : `⚠️ ALLERGY WARNING: ${appointmentSuggestion.contraindications.join('; ')}`;
      parts.push(warn);
    }

    parts.push(language === 'vi'
      ? 'Trả lời bằng TIẾNG VIỆT, ngôn ngữ tự nhiên, rõ ràng, đồng cảm.'
      : 'Respond in ENGLISH, natural language, clear and empathetic.');

    return parts.join('\n\n');
  }

  // ==================== BOOKING CONTEXT BLOCK ====================

  private async buildBookingContextBlock(appt: AppointmentSuggestion, language: Language): Promise<string> {
    if (!appt.shouldBook) return '';

    const hasDoctors = appt.suggestedDoctors && appt.suggestedDoctors.length > 0;
    const urgencyLevel = appt.urgencyLevel;

    // For high urgency, show more urgent tone
    const urgencyEmoji = { high: '⚠️', medium: '📋', low: '📅', critical: '🚨' }[urgencyLevel];
    const urgencyLabel = {
      high: { vi: 'KHẨN — trong 24 giờ', en: 'URGENT — within 24 hours' },
      medium: { vi: 'Sớm — trong 2–3 ngày', en: 'Soon — within 2-3 days' },
      low: { vi: 'Định kỳ — trong tuần này', en: 'Routine — this week' },
      critical: { vi: 'CẤP CỨU', en: 'EMERGENCY' },
    }[urgencyLevel][language];

    if (hasDoctors) {
      const doc = appt.suggestedDoctors![0];
      const slot = doc.availableSlots[0];
      const fee = doc.consultationFee
        ? language === 'vi' ? `${doc.consultationFee.toLocaleString('vi-VN')} VNĐ` : `$${doc.consultationFee}`
        : language === 'vi' ? 'Liên hệ phòng khám' : 'Contact clinic';

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toLocaleDateString(
        language === 'vi' ? 'vi-VN' : 'en-US',
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      );

      return language === 'vi'
        ? `\n---\n${urgencyEmoji} **Gợi ý đặt lịch khám** [${urgencyLabel}]\nChuyên khoa: **${appt.suggestedSpecialty}**\n👨‍⚕️ **Bác sĩ ${doc.name}** ${doc.experience ? `(${doc.experience}+ năm KN)` : ''} ${doc.rating ? `⭐ ${doc.rating.toFixed(1)}` : ''}\n🕐 Khung giờ trống: **${slot}** — 📅 **${dateStr}** — 💰 **${fee}**\n\n💬 **Bạn có muốn đặt lịch không?** Nhấn nút bên dưới để xác nhận.\n---`
        : `\n---\n${urgencyEmoji} **Appointment Recommendation** [${urgencyLabel}]\nSpecialty: **${appt.suggestedSpecialty}**\n👨‍⚕️ **Dr. ${doc.name}** ${doc.experience ? `(${doc.experience}+ yrs exp)` : ''} ${doc.rating ? `⭐ ${doc.rating.toFixed(1)}` : ''}\n🕐 Available slot: **${slot}** — 📅 **${dateStr}** — 💰 **${fee}**\n\n💬 **Would you like to book this appointment?** Click the button below.\n---`;
    }

    return language === 'vi'
      ? `\n---\n${urgencyEmoji} **Gợi ý đặt lịch khám** [${urgencyLabel}]\nChuyên khoa phù hợp: **${appt.suggestedSpecialty}**\nThời gian khuyến nghị: **${appt.recommendedTimeframe}**\n\n💬 **Bạn có muốn đặt lịch không?**\n---`
      : `\n---\n${urgencyEmoji} **Appointment Recommendation** [${urgencyLabel}]\nSuggested specialty: **${appt.suggestedSpecialty}**\nRecommended timeframe: **${appt.recommendedTimeframe}**\n\n💬 **Would you like to book an appointment?**\n---`;
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
      const err = error as { status?: number; message?: string; error?: { type?: string } };
      const isQuota =
        err?.status === 429 ||
        err?.error?.type === 'tokens' ||
        err?.message?.toLowerCase().includes('rate limit') ||
        err?.message?.toLowerCase().includes('quota') ||
        err?.message?.toLowerCase().includes('too many requests');
      if (isQuota) { this.markQuotaExceeded(); throw new QuotaExceededError(); }
      throw error;
    }
  }

  // ==================== SMART GENERATE ====================

  private async tryGenerate(userPrompt: string, category: string, language: Language): Promise<{ text: string; usedFallback: boolean }> {
    if (this.isQuotaExceeded() || this.isRateLimited()) {
      return { text: this.getFallbackText(category, language), usedFallback: true };
    }
    try {
      const text = await this.callGroqAPI(userPrompt, this.buildSystemPrompt());
      return { text, usedFallback: false };
    } catch (error) {
      if (error instanceof QuotaExceededError) return { text: this.getFallbackText(category, language), usedFallback: true };
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

  // ==================== MAIN: PROCESS MESSAGE ====================

  public async processMessage(userMessage: string, userId?: string): Promise<AIResponse> {
    try {
      if (!userMessage?.trim()) throw new EmptyMessageError();

      const language = this.detectLanguage(userMessage);

      // 1. Load patient profile
      if (userId && !this.patientProfile) {
        await this.loadPatientProfile(userId);
      }

      // Accumulate text for progressive triage scoring
      this.accumulatedSymptomText += ' ' + userMessage;

      // 2. Emergency check (always first, regardless of session state)
      const emergencyCheck = this.detectEmergency(userMessage);
      if (emergencyCheck.isEmergency && emergencyCheck.protocol) {
        auditLogger.log({
          userId,
          action: 'emergency_triggered',
          userMessage,
          category: 'emergency',
          urgencyLevel: 'critical',
          emergencyAlert: true,
          timestamp: new Date(),
        });
        this.assessmentSession = null; // reset any session
        return this.buildEmergencyResponse(emergencyCheck.protocol, language);
      }

      // 3. Quick triage of current message
      const quickTriage = ClinicalTriageEngine.score(
        this.accumulatedSymptomText, language, this.patientProfile
      );
      const quickUrgency = ClinicalTriageEngine.scoreToUrgency(quickTriage.score);

      // 4. ASSESSMENT STATE MACHINE
      // a) If high/critical urgency detected from accumulation → skip collection, assess now
      if (quickUrgency === 'high' && !this.isAssessmentReadyToComplete()) {
        // Force complete assessment for high urgency
        if (this.assessmentSession) this.assessmentSession.phase = 'assessing';
      }

      // b) No session yet — detect symptom type and start one
      if (!this.assessmentSession) {
        const symptomType = this.detectSymptomType(userMessage);
        if (symptomType && quickUrgency !== 'high') {
          this.startAssessmentSession(symptomType, language);
        }
      }

      // c) Active session that needs more info
      if (this.assessmentSession && !this.isAssessmentReadyToComplete()) {
        this.advanceAssessment(userMessage);
        const nextQuestion = this.getNextAssessmentQuestion(language);

        if (nextQuestion) {
          // Still collecting — ask next question
          const questionResponse = language === 'vi'
            ? `Cảm ơn bạn đã chia sẻ. Để đánh giá chính xác hơn:\n\n❓ **${nextQuestion}**\n\n⚕️ Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp.`
            : `Thank you for sharing. To assess more accurately:\n\n❓ **${nextQuestion}**\n\n⚕️ This information is for educational purposes only and does not replace professional medical advice.`;

          this.addToHistory({ role: 'user', content: userMessage, timestamp: new Date(), language });
          this.addToHistory({ role: 'assistant', content: questionResponse, timestamp: new Date(), language });

          return {
            response: questionResponse,
            confidence: 0.7,
            requiresMoreInfo: true,
            followUpQuestions: [nextQuestion],
            category: this.assessmentSession.symptomType,
            language,
            provider: 'local',
          };
        }
        // No more questions from template → move to assessing
        if (this.assessmentSession) this.assessmentSession.phase = 'assessing';
      }

      // d) Continue advancing session if we're in the middle of turns
      if (this.assessmentSession && !this.isAssessmentReadyToComplete()) {
        this.advanceAssessment(userMessage);
      }

      // 5. Build clinical assessment
      const clinicalAssessment = this.buildClinicalAssessment(language);

      // 6. Detect category + specialty
      const { category, specialtyId } = await this.detectCategory(
        this.accumulatedSymptomText
      );

      // 7. Evaluate appointment need based on clinical assessment
      const appointmentRecommendation = await this.evaluateAppointmentNeed(
        clinicalAssessment, category, specialtyId, language, userId
      );

      // 8. Get symptom history
      let symptomHistory = '';
      if (userId) {
        symptomHistory = await SymptomTrackerService.getContextSummary(userId, language);
        if (appointmentRecommendation.symptoms.length) {
          const sessionId = this.conversationHistory[0]?.timestamp.toISOString() || 'unknown';
          await SymptomTrackerService.logSymptoms(
            userId, sessionId, appointmentRecommendation.symptoms, userMessage, category
          );
        }
      }

      // 9. Save user message to history
      this.addToHistory({ role: 'user', content: userMessage, timestamp: new Date(), category, language });

      // 10. Build AI prompt with assessment context
      const userPrompt = await this.buildUserPrompt(
        userMessage, category, specialtyId, language,
        clinicalAssessment,
        appointmentRecommendation,
        symptomHistory
      );

      const { text: responseText, usedFallback } = await this.tryGenerate(userPrompt, category, language);

      this.addToHistory({ role: 'assistant', content: responseText, timestamp: new Date(), category, language });

      // 11. Mark session complete
      if (this.assessmentSession) this.assessmentSession.phase = 'complete';

      // 12. Audit log
      auditLogger.log({
        userId,
        action: 'chat_message',
        userMessage,
        aiResponse: responseText.substring(0, 500),
        category,
        urgencyLevel: clinicalAssessment.urgencyLevel,
        emergencyAlert: false,
        timestamp: new Date(),
      });

      const analysis = this.analyzeResponse(responseText, language);
      let relatedSpecialties: string[] = [];
      if (specialtyId) relatedSpecialties = await this.specialtyManager.getRelatedSpecialties(specialtyId);

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
        patientContextUsed: !!this.patientProfile,
        clinicalAssessment,
        triageScore: clinicalAssessment.triageScore,
        urgencyLevel: clinicalAssessment.urgencyLevel,
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
    const responseText = EMERGENCY_PROTOCOLS[language][protocol] ?? EMERGENCY_PROTOCOLS[language].cardiac_emergency;
    return {
      response: responseText,
      confidence: 0.98,
      suggestedActions: language === 'vi'
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
    const response = language === 'vi'
      ? 'Xin lỗi, đang gặp sự cố kỹ thuật.\n1. Liên hệ trực tiếp nhà cung cấp y tế\n2. Gọi 115 nếu cần cấp cứu\n\n⚕️ Thông tin này chỉ mang tính giáo dục.'
      : 'Technical difficulty encountered.\n1. Contact your healthcare provider directly\n2. Call 911/115 for emergencies\n\n⚕️ Educational purposes only.';
    return {
      response,
      confidence: 0.3,
      suggestedActions: language === 'vi'
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

  private analyzeResponse(responseText: string, language: Language): { confidence: number; suggestedActions: string[] } {
    const lower = responseText.toLowerCase();
    let confidence = 0.78;

    const highTerms = language === 'vi'
      ? ['nghiên cứu cho thấy', 'dựa trên bằng chứng', 'hướng dẫn y khoa']
      : ['research shows', 'evidence-based', 'medical guidelines', 'clinical studies'];
    const cautionTerms = language === 'vi'
      ? ['có thể', 'đôi khi', 'trong một số trường hợp']
      : ['may be', 'could possibly', 'sometimes', 'in some cases'];

    if (highTerms.some(t => lower.includes(t))) confidence = 0.88;
    if (cautionTerms.some(t => lower.includes(t))) confidence = Math.min(confidence, 0.65);

    const actionMap = language === 'vi'
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
        const role = msg.role === 'user'
          ? (msg.language === 'vi' ? 'Bệnh nhân' : 'Patient')
          : (msg.language === 'vi' ? 'Trợ lý AI' : 'AI Assistant');
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

    const allergyWarning = allergies.some(a =>
      medicationName.toLowerCase().includes(a.toLowerCase()) ||
      a.toLowerCase().includes(medicationName.toLowerCase())
    );

    const allergyNote = allergyWarning
      ? `⚠️ CẢNH BÁO DỊ ỨNG: Bệnh nhân có thể dị ứng với ${medicationName}. Tham khảo bác sĩ ngay!\n\n`
      : '';

    const prompt = `Cung cấp thông tin chi tiết về thuốc: "${medicationName}"\n\nBao gồm:\n1. Tên thương mại phổ biến\n2. Công dụng điều trị\n3. Liều dùng thông thường (theo lứa tuổi nếu có)\n4. Tác dụng phụ thường gặp và nghiêm trọng\n5. Chống chỉ định\n6. Tương tác thuốc quan trọng\n7. Lưu ý đặc biệt\n\nTrả lời bằng TIẾNG VIỆT.\n\n⚕️ Kết thúc bằng: "Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp."`;
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
    const prompt = language === 'vi'
      ? `Giải thích thuật ngữ y khoa: "${term}"\n\nBao gồm:\n1. Định nghĩa y khoa chính xác\n2. Giải thích bằng ngôn ngữ đơn giản\n3. Ví dụ lâm sàng thực tế\n4. Khi nào cần gặp bác sĩ\n\nTrả lời bằng TIẾNG VIỆT, gần gũi và dễ hiểu.`
      : `Explain the medical term: "${term}"\n\nInclude:\n1. Precise medical definition\n2. Plain language explanation\n3. Real clinical examples\n4. When to see a doctor\n\nRespond in ENGLISH, friendly and easy to understand.`;
    const { text } = await this.tryGenerate(prompt, 'general', language);
    return { term, explanation: text, confidence: 0.9 };
  }

  public async getLifestyleAdvice(topic: string): Promise<LifestyleAdvice> {
    const language = this.detectLanguage(topic);

    const prompt = language === 'vi'
      ? `Cung cấp lời khuyên chi tiết về lối sống cho chủ đề: "${topic}"

Yêu cầu:
1. Giải thích ngắn gọn về tầm quan trọng của chủ đề
2. Đưa ra 3–5 lời khuyên cụ thể, thực tế với:
   - Mô tả ngắn gọn
   - Cách thực hiện hàng ngày
   - Lợi ích mong đợi
3. Những điều nên tránh
4. Kết thúc bằng lưu ý quan trọng

Định dạng: sử dụng emoji phù hợp, ngôn ngữ thân thiện.

⚕️ Thông tin này chỉ mang tính giáo dục, không thay thế tư vấn y tế chuyên nghiệp.`
      : `Provide detailed lifestyle advice for: "${topic}"

Requirements:
1. Brief explanation of why this topic matters
2. 3–5 specific, actionable tips with:
   - Short description
   - Daily implementation steps
   - Expected benefits
3. What to avoid
4. Close with important notes

Format: use appropriate emojis, friendly language.

⚕️ This information is for educational purposes only and does not replace professional medical advice.`;

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
  }

  public getHistory(): AIMessage[] { return [...this.conversationHistory]; }
  public getLastDetectedLanguage(): Language | null { return this.conversationHistory.at(-1)?.language ?? null; }

  /**
   * NEW: Get current assessment session state (for frontend to display progress)
   */
  public getAssessmentState(): {
    active: boolean;
    phase: AssessmentPhase;
    turnCount: number;
    urgencyPreview?: UrgencyLevel;
  } {
    if (!this.assessmentSession) {
      return { active: false, phase: 'idle', turnCount: 0 };
    }
    const quickTriage = ClinicalTriageEngine.score(
      this.accumulatedSymptomText,
      this.assessmentSession.language,
      this.patientProfile
    );
    return {
      active: true,
      phase: this.assessmentSession.phase,
      turnCount: this.assessmentSession.turnCount,
      urgencyPreview: ClinicalTriageEngine.scoreToUrgency(quickTriage.score),
    };
  }

  /**
   * NEW: Force complete the assessment and return the result (e.g., user clicks "Get Assessment")
   */
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

  public async getAllCategories(): Promise<string[]> { return this.specialtyManager.getAllCategories(); }
  public async getSpecialtyById(id: string) { return this.specialtyManager.getSpecialtyById(id); }
  public async refreshSpecialties(): Promise<void> { await this.specialtyManager.loadSpecialties(true); }
}

// ==================== SESSION MANAGER ====================

const serviceInstances = new Map<string, AIMedicalService>();
const serviceLastUsed = new Map<string, number>();
const SERVICE_IDLE_TIMEOUT = 30 * 60 * 1000;

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

setInterval(() => {
  const now = Date.now();
  for (const [id, lastUsed] of serviceLastUsed) {
    if (now - lastUsed > SERVICE_IDLE_TIMEOUT) {
      serviceInstances.delete(id);
      serviceLastUsed.delete(id);
    }
  }
}, 15 * 60 * 1000);