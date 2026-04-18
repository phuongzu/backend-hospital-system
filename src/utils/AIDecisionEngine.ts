import Groq from 'groq-sdk';
import Doctor, { IDoctor } from '../models/doctor';
import Appointment from '../models/appointment';
import Specialty from '../models/specialty';
import Review from '../models/review';
import { PatientProfile, UrgencyLevel } from './aiMedicalService';
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
  userIntent?: string;
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

export const generateTimeSlotsFromSchedule = (
  availableHours: IDoctor['available_hours'],
  date: Date,
  intervalMinutes = 30
): string[] => {
  const days = [
    'sunday', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday',
  ] as const;

  const dayName = days[date.getDay()] as keyof IDoctor['available_hours'];
  const schedule = availableHours?.[dayName];

  if (!schedule || !schedule.isAvailable) return [];

  const [startH, startM] = schedule.start.split(':').map(Number);
  const [endH, endM] = schedule.end.split(':').map(Number);

  const slots: string[] = [];
  let current = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  while (current + intervalMinutes <= endTotal) {
    const h = Math.floor(current / 60).toString().padStart(2, '0');
    const m = (current % 60).toString().padStart(2, '0');
    slots.push(`${h}:${m}`);
    current += intervalMinutes;
  }

  return slots;
};

// ==================== FETCH DB CONTEXT ====================

export async function fetchDBContext(
  userId?: string,
  symptomText?: string
): Promise<DBContext> {

  // 1. Fetch all active specialties
  const specialties = await Specialty.find({ isActive: true })
    .select('_id name description doctorCount')
    .lean();

  const availableSpecialties: SpecialtyContext[] = specialties.map(s => ({
    id: s._id.toString(),
    name: s.name,
    description: s.description,
    doctorCount: s.doctorCount || 0,
  }));

  // 2. Fetch doctors (up to 30 for performance)
  const doctors = await Doctor.find({ isAvailable: true })
    .populate('user_id', 'name')
    .populate('specialty_id', 'name _id')
    .select('_id user_id specialty_id years_of_experience consultation_fee available_hours')
    .limit(30)
    .lean();

  const doctorIds = doctors.map(d => d._id);
  const availableDoctors: DoctorContext[] = [];

  // 3. Scan next 7 days to find availability for each doctor
  const today = new Date();
  for (const doctor of doctors) {
    let foundDay: Date | null = null;
    let availableSlots: string[] = [];

    for (let i = 1; i <= 7; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + i);
      targetDate.setHours(0, 0, 0, 0);

      const slots = generateTimeSlotsFromSchedule(
        doctor.available_hours as IDoctor['available_hours'],
        targetDate
      );

      if (slots.length > 0) {
        // Check if these slots are already booked
        const booked = await Appointment.find({
          doctor_id: doctor._id,
          appointment_date: {
            $gte: targetDate,
            $lte: new Date(new Date(targetDate).setHours(23, 59, 59, 999))
          },
          status: { $in: ['pending', 'confirmed'] },
        }).select('time_slot').lean();

        const bookedSlots = new Set(booked.map(b => b.time_slot));
        const freeSlots = slots.filter(s => !bookedSlots.has(s));

        if (freeSlots.length > 0) {
          foundDay = targetDate;
          availableSlots = freeSlots.slice(0, 5);
          break;
        }
      }
    }

    if (foundDay) {
      const docId = (doctor._id as Types.ObjectId).toString();
      const specialtyId = (doctor.specialty_id as any)?._id?.toString() ?? '';
      const specialtyName = (doctor.specialty_id as any)?.name ?? '';

      // Get rating for this doctor
      const ratingData = await Review.aggregate([
        { $match: { doctor_id: doctor._id } },
        { $group: { _id: '$doctor_id', avg: { $avg: '$rating' } } },
      ]);
      const rating = ratingData[0]?.avg || 0;

      availableDoctors.push({
        id: docId,
        name: (doctor.user_id as any)?.name ?? 'Doctor',
        specialtyId,
        specialtyName,
        availableSlots,
        nextAvailableDate: foundDay.toISOString().split('T')[0],
        rating,
        experience: doctor.years_of_experience ?? 0,
        consultationFee: doctor.consultation_fee ?? 0,
      });
    }
  }

  // 4. Fetch patient's upcoming appointments
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
      date: new Date(a.appointment_date).toLocaleDateString('en-US'),
      timeSlot: a.time_slot,
      doctorName: (a.doctor_id as any)?.name ?? 'Doctor',
      specialtyName: (a.specialty_id as any)?.name ?? 'Specialty',
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
): string {
  const specialtiesList = dbContext.availableSpecialties
    .map(s => `- ID: ${s.id} | Name: ${s.name} | Doctors: ${s.doctorCount}`)
    .join('\n');

  const doctorsList = dbContext.availableDoctors
    .map(d =>
      `- ID: ${d.id} | Name: ${d.name} | Specialty: ${d.specialtyName} (ID: ${d.specialtyId}) | ` +
      `Rating: ${d.rating.toFixed(1)} | Experience: ${d.experience}yrs | ` +
      `Fee: ${d.consultationFee} | ` +
      `Available slots on ${d.nextAvailableDate}: ${d.availableSlots.join(', ')}`
    )
    .join('\n');

  const existingAppts = dbContext.patientExistingAppointments.length
    ? dbContext.patientExistingAppointments
      .map(a => `- ${a.date} at ${a.timeSlot} with ${a.doctorName} (${a.specialtyName}) - ${a.status}`)
      .join('\n')
    : 'None';

  const profileBlock = patientProfile
    ? `
PATIENT PROFILE:
- Age: ${patientProfile.age ?? 'Unknown'}
- Gender: ${patientProfile.gender ?? 'Unknown'}
- Allergies: ${patientProfile.allergies.join(', ') || 'None'}
- Chronic conditions: ${patientProfile.chronicConditions.join(', ') || 'None'}
- Current medications: ${patientProfile.currentMedications.join(', ') || 'None'}
`
    : '';

  return `You are an expert AI doctor. Analyze the conversation and hospital data below, then return a clinical decision as JSON.

═══════════════════════════════════════
CONVERSATION WITH PATIENT:
═══════════════════════════════════════
${conversationText}
${profileBlock}

═══════════════════════════════════════
REAL HOSPITAL DATABASE:
═══════════════════════════════════════

ACTIVE SPECIALTIES:
${specialtiesList}

DOCTORS WITH EARLIEST AVAILABLE SLOTS (within next 7 days):
${doctorsList}

PATIENT'S EXISTING APPOINTMENTS:
${existingAppts}

═══════════════════════════════════════
REQUIREMENTS:
═══════════════════════════════════════
Based on the patient's symptoms, profile, and real hospital data above,
return ONLY valid JSON with EXACTLY this structure (no extra text outside JSON):

{
  "urgencyLevel": "low" | "medium" | "high" | "critical",
  "triageScore": <0-100>,
  "requiresEmergency": <true/false>,
  "emergencyReason": "<reason if emergency, or null>",
  "shouldBook": <true/false>,
  "reasoning": "<brief explanation in English>",
  "recommendedSpecialtyId": "<specialty ID from list above, or null>",
  "recommendedSpecialtyName": "<specialty name, or null>",
  "recommendedDoctorId": "<best matching doctor ID from list above, or null>",
  "recommendedDoctorName": "<doctor name, or null>",
  "recommendedTimeSlot": "<time slot from that doctor's available slots, or null>",
  "recommendedDate": "<recommended date YYYY-MM-DD, or null>",
  "redFlags": ["<warning signs if any>"],
  "selfCareAdvice": ["<self-care tips if low urgency>"],
  "followUpNeeded": <true/false>,
  "estimatedWaitDays": <days until appointment recommended>
}

IMPORTANT RULES:
- Only select doctors from the "DOCTORS WITH AVAILABLE SLOTS" list above
- Only select slots from that doctor's listed available slots
- If patient already has an appointment for the same specialty → shouldBook = false
- If critical/emergency → shouldBook = false, requiresEmergency = true
- Adjust urgencyLevel based on chronic conditions and patient age
- Write the "reasoning" field in English
- Return ONLY the JSON object, no other text`;
}

// Call Models AI

export async function getAIDecision(
  groq: Groq,
  conversationText: string,
  dbContext: DBContext,
  patientProfile: PatientProfile | null,
  groqModel: string
): Promise<AIDecision> {
  const prompt = buildDecisionPrompt(conversationText, dbContext, patientProfile);

  try {
    const completion = await groq.chat.completions.create({
      model: groqModel,
      messages: [
        {
          role: 'system',
          content: 'You are an expert AI doctor. Return only valid JSON, no additional text.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as AIDecision;

    return sanitizeAIDecision(parsed, dbContext);

  } catch (error) {
    console.error('❌ AI Decision failed, using safe fallback:', error);
    return {
      urgencyLevel: 'medium',
      triageScore: 50,
      shouldBook: false,
      reasoning: 'Automatic analysis unavailable. Please consult a doctor.',
      redFlags: [],
      requiresEmergency: false,
      followUpNeeded: true,
      estimatedWaitDays: 3,
      userIntent: 'symptom_report',
    };
  }
}


// Protect 

function sanitizeAIDecision(
  decision: Partial<AIDecision>,
  dbContext: DBContext
): AIDecision {
  const validUrgencies: UrgencyLevel[] = ['low', 'medium', 'high', 'critical'];

  const urgencyLevel = validUrgencies.includes(decision.urgencyLevel as UrgencyLevel)
    ? decision.urgencyLevel as UrgencyLevel
    : 'medium';

  const validIntents = [
    'greeting', 'small_talk', 'symptom_report', 'confirm_booking',
    'decline_booking', 'appointment_inquiry', 'general_health_info',
    'medication_inquiry', 'emergency_report'
  ];

  const userIntent = validIntents.includes(decision.userIntent ?? '')
    ? decision.userIntent
    : 'symptom_report';

  // Verify doctor exists in real DB context
  const doctor = dbContext.availableDoctors.find(
    d => d.id === decision.recommendedDoctorId
  ) ?? null;

  // Verify slot exists in doctor's real available slots
  const slotValid = doctor?.availableSlots.includes(decision.recommendedTimeSlot ?? '') ?? false;

  // Verify specialty exists in real DB context
  const specialty = dbContext.availableSpecialties.find(
    s => s.id === decision.recommendedSpecialtyId
  ) ?? null;

  return {
    urgencyLevel,
    triageScore: Math.min(100, Math.max(0, decision.triageScore ?? 50)),
    shouldBook: decision.shouldBook ?? false,
    reasoning: decision.reasoning ?? '',
    recommendedSpecialtyId: specialty?.id,
    recommendedSpecialtyName: specialty?.name ?? decision.recommendedSpecialtyName,
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
    userIntent,
  };
}
