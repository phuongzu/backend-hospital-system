import Groq from 'groq-sdk';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Specialty from '../models/specialty';
import Review from '../models/review';
import { PatientProfile, UrgencyLevel, Language } from './aiMedicalService';
import { Types } from 'mongoose';

// ==================== TYPES ====================

export interface AIDecision {
  urgencyLevel: UrgencyLevel;
  triageScore: number;
  shouldBook: boolean;
  reasoning: string;
  recommendedSpecialtyId?: string;
  recommendedSpecialtyName?: string;
  recommendedDoctorId?: string;
  recommendedDoctorName?: string;
  recommendedTimeSlot?: string;
  recommendedDate?: string;
  redFlags: string[];
  selfCareAdvice?: string[];
  requiresEmergency: boolean;
  emergencyReason?: string;
  followUpNeeded: boolean;
  estimatedWaitDays?: number;
}

export interface DBContext {
  availableSpecialties: SpecialtyContext[];
  availableDoctors: DoctorContext[];
  patientExistingAppointments: ExistingAppointment[];
  patientProfile?: PatientProfile | null;
}

interface SpecialtyContext {
  id: string;
  name: string;
  description?: string;
  doctorCount: number;
}

interface DoctorContext {
  id: string;
  name: string;
  specialtyId: string;
  specialtyName: string;
  availableSlots: string[];
  nextAvailableDate: string;
  rating: number;
  experience: number;
  consultationFee: number;
}

interface ExistingAppointment {
  id: string;
  date: string;
  timeSlot: string;
  doctorName: string;
  specialtyName: string;
  status: string;
}

const ALL_TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
];

// ==================== FETCH DB CONTEXT ====================

export async function fetchDBContext(
  userId?: string,
  symptomText?: string
): Promise<DBContext> {

  // 1. Fetch tất cả specialties đang active
  const specialties = await Specialty.find({ isActive: true })
    .select('_id name description doctorCount')
    .lean();

  const availableSpecialties: SpecialtyContext[] = specialties.map(s => ({
    id: s._id.toString(),
    name: s.name,
    description: s.description,
    doctorCount: s.doctorCount || 0,
  }));

  // 2. Fetch doctors có lịch trống (ngày mai trở đi)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(tomorrow);
  endOfTomorrow.setHours(23, 59, 59, 999);

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = DAYS[tomorrow.getDay()];

  const doctors = await Doctor.find({ isAvailable: true })
    .populate('user_id', 'name')
    .populate('specialty_id', 'name _id')
    .select('_id user_id specialty_id years_of_experience consultation_fee available_hours')
    .limit(30)
    .lean();



  const doctorIds = doctors.map(d => d._id);

  // Lấy slot đã bị đặt ngày mai
  const bookedAppointments = await Appointment.find({
    doctor_id: { $in: doctorIds },
    appointment_date: { $gte: tomorrow, $lte: endOfTomorrow },
    status: { $in: ['pending', 'confirmed'] },
  }).select('doctor_id time_slot').lean();

  const bookedByDoctor = new Map<string, Set<string>>();
  for (const appt of bookedAppointments) {
    const key = appt.doctor_id.toString();
    if (!bookedByDoctor.has(key)) bookedByDoctor.set(key, new Set());
    bookedByDoctor.get(key)!.add(appt.time_slot);
  }

  // Lấy rating
  const ratings = await Review.aggregate([
    { $match: { doctor_id: { $in: doctorIds } } },
    { $group: { _id: '$doctor_id', avg: { $avg: '$rating' } } },
  ]);
  const ratingMap = new Map(ratings.map(r => [r._id.toString(), r.avg]));

  const availableDoctors: DoctorContext[] = [];

  for (const doctor of doctors) {
    const docId = (doctor._id as Types.ObjectId).toString();
    const booked = bookedByDoctor.get(docId) || new Set();

    // Kiểm tra lịch làm việc theo ngày
    const daySchedule = (doctor.available_hours as any)?.[dayOfWeek];
    if (daySchedule?.isAvailable === false) continue;

    let slotsForDay = ALL_TIME_SLOTS;
    if (daySchedule?.start && daySchedule?.end) {
      slotsForDay = ALL_TIME_SLOTS.filter(
        s => s >= daySchedule.start && s <= daySchedule.end
      );
    }

    const availableSlots = slotsForDay.filter(s => !booked.has(s));
    if (!availableSlots.length) continue; // Bỏ qua bác sĩ hết slot

    const specialtyId = (doctor.specialty_id as any)?._id?.toString() || '';
    const specialtyName = (doctor.specialty_id as any)?.name || '';

    availableDoctors.push({
      id: docId,
      name: (doctor.user_id as any)?.name || 'Bác sĩ',
      specialtyId,
      specialtyName,
      availableSlots: availableSlots.slice(0, 5),
      nextAvailableDate: tomorrow.toISOString().split('T')[0],
      rating: ratingMap.get(docId) ?? 0,
      experience: doctor.years_of_experience || 0,
      consultationFee: doctor.consultation_fee || 0,
    });
  }

  // 3. Fetch lịch hẹn hiện có của patient
  let patientExistingAppointments: ExistingAppointment[] = [];
  if (userId) {
    const existing = await Appointment.find({
      user_id: userId,
      appointment_date: { $gte: new Date() },
      status: { $in: ['pending', 'confirmed'] },
    })
      .populate<{ doctor_id: { name: string } }>('doctor_id', 'name')
      .populate<{ specialty_id: { name: string; _id: any } }>('specialty_id', 'name _id')
      .select('_id appointment_date time_slot status doctor_id specialty_id')
      .sort({ appointment_date: 1 })
      .limit(5)
      .lean();


    patientExistingAppointments = existing.map(a => ({
      id: (a._id as Types.ObjectId).toString(),
      date: new Date(a.appointment_date).toLocaleDateString('vi-VN'),
      timeSlot: a.time_slot,
      doctorName: (a.doctor_id as any)?.name || 'Bác sĩ',
      specialtyName: (a.specialty_id as any)?.name || 'Chuyên khoa',
      status: a.status,
    }));
  }

  return {
    availableSpecialties,
    availableDoctors,
    patientExistingAppointments,
  };
}

// ==================== BUILD DECISION PROMPT ====================

function buildDecisionPrompt(
  conversationText: string,
  dbContext: DBContext,
  patientProfile: PatientProfile | null,
  language: Language
): string {
  const specialtiesList = dbContext.availableSpecialties
    .map(s => `- ID: ${s.id} | Tên: ${s.name} | Số bác sĩ: ${s.doctorCount}`)
    .join('\n');

  const doctorsList = dbContext.availableDoctors
    .map(d =>
      `- ID: ${d.id} | Tên: ${d.name} | Chuyên khoa: ${d.specialtyName} (ID: ${d.specialtyId}) | ` +
      `Rating: ${d.rating.toFixed(1)} | Kinh nghiệm: ${d.experience} năm | ` +
      `Phí: ${d.consultationFee.toLocaleString()}đ | ` +
      `Slot trống ngày ${d.nextAvailableDate}: ${d.availableSlots.join(', ')}`
    )
    .join('\n');

  const existingAppts = dbContext.patientExistingAppointments.length
    ? dbContext.patientExistingAppointments
      .map(a => `- ${a.date} lúc ${a.timeSlot} với ${a.doctorName} (${a.specialtyName}) - ${a.status}`)
      .join('\n')
    : 'Không có lịch hẹn nào';

  const profileBlock = patientProfile
    ? `
HỒSƠ BỆNH NHÂN:
- Tuổi: ${patientProfile.age ?? 'Không rõ'}
- Giới tính: ${patientProfile.gender ?? 'Không rõ'}
- Dị ứng: ${patientProfile.allergies.join(', ') || 'Không có'}
- Bệnh nền: ${patientProfile.chronicConditions.join(', ') || 'Không có'}
- Thuốc đang dùng: ${patientProfile.currentMedications.join(', ') || 'Không có'}
- Chẩn đoán gần đây: ${patientProfile.recentDiagnoses.join(', ') || 'Không có'}`
    : '';

  return `Bạn là một bác sĩ AI chuyên gia. Hãy phân tích cuộc hội thoại và dữ liệu bệnh viện bên dưới, sau đó đưa ra quyết định lâm sàng.

═══════════════════════════════════════
CUỘC HỘI THOẠI VỚI BỆNH NHÂN:
═══════════════════════════════════════
${conversationText}
${profileBlock}

═══════════════════════════════════════
DỮ LIỆU BỆNH VIỆN THỰC TẾ:
═══════════════════════════════════════

CHUYÊN KHOA ĐANG HOẠT ĐỘNG:
${specialtiesList}

BÁC SĨ CÓ LỊCH TRỐNG (ngày mai):
${doctorsList}

LỊCH HẸN HIỆN CÓ CỦA BỆNH NHÂN:
${existingAppts}

═══════════════════════════════════════
YÊU CẦU:
═══════════════════════════════════════
Dựa trên triệu chứng, hồ sơ bệnh nhân và dữ liệu bệnh viện thực tế ở trên,
hãy trả về JSON với cấu trúc CHÍNH XÁC như sau (không thêm text ngoài JSON):

{
  "urgencyLevel": "low" | "medium" | "high" | "critical",
  "triageScore": <số từ 0-100>,
  "requiresEmergency": <true/false>,
  "emergencyReason": "<lý do nếu emergency, hoặc null>",
  "shouldBook": <true/false>,
  "reasoning": "<giải thích ngắn gọn quyết định bằng tiếng Việt>",
  "recommendedSpecialtyId": "<ID chuyên khoa từ danh sách trên, hoặc null>",
  "recommendedSpecialtyName": "<tên chuyên khoa, hoặc null>",
  "recommendedDoctorId": "<ID bác sĩ phù hợp nhất từ danh sách trên, hoặc null>",
  "recommendedDoctorName": "<tên bác sĩ, hoặc null>",
  "recommendedTimeSlot": "<slot giờ từ danh sách slot trống của bác sĩ đó, hoặc null>",
  "recommendedDate": "<ngày khuyến nghị YYYY-MM-DD, hoặc null>",
  "redFlags": ["<dấu hiệu nguy hiểm nếu có>"],
  "selfCareAdvice": ["<lời khuyên tự chăm sóc nếu urgency thấp>"],
  "followUpNeeded": <true/false>,
  "estimatedWaitDays": <số ngày nên khám trong vòng bao lâu>
}

LƯU Ý QUAN TRỌNG:
- Chỉ chọn bác sĩ từ danh sách "BÁC SĨ CÓ LỊCH TRỐNG" ở trên
- Chỉ chọn slot từ danh sách "Slot trống" của bác sĩ đó
- Nếu bệnh nhân đã có lịch hẹn cùng chuyên khoa → shouldBook = false
- Nếu critical/emergency → shouldBook = false, requiresEmergency = true
- Phân tích bệnh nền và tuổi để điều chỉnh urgencyLevel
- Chỉ trả về JSON, không giải thích thêm`;
}


// ==================== MAIN DECISION FUNCTION ====================

export async function getAIDecision(
  groq: Groq,
  conversationText: string,
  dbContext: DBContext,
  patientProfile: PatientProfile | null,
  language: Language,
  groqModel: string
): Promise<AIDecision> {
  const prompt = buildDecisionPrompt(
    conversationText,
    dbContext,
    patientProfile,
    language
  );

  try {
    const completion = await groq.chat.completions.create({
      model: groqModel,
      messages: [
        {
          role: 'system',
          content: 'Bạn là bác sĩ AI chuyên gia. Chỉ trả về JSON hợp lệ, không thêm bất kỳ text nào khác.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,       // Thấp để quyết định nhất quán
      max_tokens: 800,
      response_format: { type: 'json_object' }, // Ép Groq trả JSON
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as AIDecision;

    // Validate và sanitize output của AI
    return sanitizeAIDecision(parsed, dbContext);

  } catch (error) {
    console.error('❌ AI Decision failed, using safe fallback:', error);
    // Fallback an toàn nếu AI fail
    return {
      urgencyLevel: 'medium',
      triageScore: 50,
      shouldBook: false,
      reasoning: 'Không thể phân tích tự động. Vui lòng tư vấn bác sĩ.',
      redFlags: [],
      requiresEmergency: false,
      followUpNeeded: true,
      estimatedWaitDays: 3,
    };
  }
}

// ==================== VALIDATE AI OUTPUT ====================

function sanitizeAIDecision(
  decision: Partial<AIDecision>,
  dbContext: DBContext
): AIDecision {
  const validUrgencies: UrgencyLevel[] = ['low', 'medium', 'high', 'critical'];

  // Đảm bảo urgencyLevel hợp lệ
  const urgencyLevel = validUrgencies.includes(decision.urgencyLevel as UrgencyLevel)
    ? decision.urgencyLevel as UrgencyLevel
    : 'medium';

  // Xác minh doctorId có trong DB thật
  const doctorExists = dbContext.availableDoctors.find(
    d => d.id === decision.recommendedDoctorId
  );
  const doctor = doctorExists ?? null;

  // Xác minh slot có thật trong lịch trống của bác sĩ đó
  const slotValid = doctor?.availableSlots.includes(decision.recommendedTimeSlot ?? '');

  // Xác minh specialtyId có trong DB
  const specialtyExists = dbContext.availableSpecialties.find(
    s => s.id === decision.recommendedSpecialtyId
  );

  return {
    urgencyLevel,
    triageScore: Math.min(100, Math.max(0, decision.triageScore ?? 50)),
    shouldBook: decision.shouldBook ?? false,
    reasoning: decision.reasoning ?? '',
    recommendedSpecialtyId: specialtyExists?.id,
    recommendedSpecialtyName: specialtyExists?.name ?? decision.recommendedSpecialtyName,
    recommendedDoctorId: doctor?.id,
    recommendedDoctorName: doctor?.name,
    recommendedTimeSlot: slotValid ? decision.recommendedTimeSlot : doctor?.availableSlots[0],
    recommendedDate: doctor?.nextAvailableDate ?? decision.recommendedDate,
    redFlags: Array.isArray(decision.redFlags) ? decision.redFlags : [],
    selfCareAdvice: Array.isArray(decision.selfCareAdvice) ? decision.selfCareAdvice : [],
    requiresEmergency: decision.requiresEmergency ?? false,
    emergencyReason: decision.emergencyReason ?? undefined,
    followUpNeeded: decision.followUpNeeded ?? true,
    estimatedWaitDays: decision.estimatedWaitDays ?? 7,
  };
}