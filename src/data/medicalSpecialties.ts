export interface MedicalSpecialty {
  _id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  isActive: boolean;
  doctorCount: number;
  commonConditions: string[];
  diagnosticProcedures: string[];
  treatments: string[];
  vietnameseTerms: { [key: string]: string };
}

export const MedicalSpecialties: MedicalSpecialty[] = [
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a1",
    name: "Cardiology",
    description: "Heart and blood vessel specialist",
    icon: "heart",
    color: "#e53935",
    isActive: true,
    doctorCount: 1,
    commonConditions: [
      "Hypertension", "Coronary artery disease", "Heart failure", 
      "Arrhythmias", "Valvular heart disease", "Heart attack",
      "Cardiomyopathy", "Pericarditis", "Congenital heart disease"
    ],
    diagnosticProcedures: [
      "ECG/EKG", "Echocardiogram", "Stress test", 
      "Cardiac catheterization", "Holter monitoring",
      "Cardiac MRI", "CT angiography", "Electrophysiology study"
    ],
    treatments: [
      "Medication management", "Cardiac rehabilitation", 
      "Angioplasty and stenting", "Pacemaker implantation",
      "Coronary bypass surgery", "Valve repair/replacement",
      "Ablation therapy", "Heart transplant"
    ],
    vietnameseTerms: {
      "Hypertension": "Cao huyết áp",
      "Heart failure": "Suy tim",
      "Arrhythmia": "Rối loạn nhịp tim",
      "ECG": "Điện tâm đồ",
      "Echocardiogram": "Siêu âm tim",
      "Heart attack": "Đau tim",
      "Cardiac catheterization": "Thông tim",
      "Pacemaker": "Máy tạo nhịp tim"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a2",
    name: "Dermatology",
    description: "Skin specialist",
    icon: "skin",
    color: "#43a047",
    isActive: true,
    doctorCount: 1,
    commonConditions: [
      "Acne", "Eczema", "Psoriasis", "Skin infections",
      "Skin cancer", "Allergic reactions", "Rosacea",
      "Vitiligo", "Hives", "Warts", "Fungal infections"
    ],
    diagnosticProcedures: [
      "Skin biopsy", "Patch testing", "Dermatoscopy",
      "Wood's lamp examination", "Culture tests",
      "Allergy testing", "Skin scraping", "Phototesting"
    ],
    treatments: [
      "Topical medications", "Oral medications", "Light therapy",
      "Surgical excision", "Cosmetic procedures",
      "Cryotherapy", "Laser treatment", "Chemical peels",
      "Biologic therapies"
    ],
    vietnameseTerms: {
      "Acne": "Mụn trứng cá",
      "Eczema": "Chàm",
      "Psoriasis": "Vảy nến",
      "Skin biopsy": "Sinh thiết da",
      "Topical medications": "Thuốc bôi ngoài da",
      "Skin cancer": "Ung thư da",
      "Fungal infections": "Nhiễm nấm"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a3",
    name: "Neurology",
    description: "Brain and nervous system specialist",
    icon: "medkit",
    color: "#1e88e5",
    isActive: true,
    doctorCount: 1,
    commonConditions: [
      "Migraine", "Epilepsy", "Stroke", "Parkinson's disease",
      "Alzheimer's disease", "Multiple sclerosis", "Neuropathy",
      "Brain tumors", "Spinal cord injuries", "Headaches"
    ],
    diagnosticProcedures: [
      "MRI brain", "CT scan", "EEG", "EMG/NCS",
      "Lumbar puncture", "Neurological examination",
      "PET scan", "Angiography", "Evoked potentials"
    ],
    treatments: [
      "Medication management", "Physical therapy",
      "Occupational therapy", "Speech therapy",
      "Deep brain stimulation", "Botox injections",
      "Nerve blocks", "Surgical interventions"
    ],
    vietnameseTerms: {
      "Migraine": "Đau nửa đầu",
      "Epilepsy": "Động kinh",
      "Stroke": "Đột quỵ",
      "Parkinson's disease": "Bệnh Parkinson",
      "Alzheimer's disease": "Bệnh Alzheimer",
      "EEG": "Điện não đồ",
      "EMG": "Điện cơ đồ"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a4",
    name: "Pediatrics",
    description: "Child specialist",
    icon: "happy",
    color: "#ffb300",
    isActive: true,
    doctorCount: 1,
    commonConditions: [
      "Childhood infections", "Asthma", "Allergies",
      "Developmental delays", "ADHD", "Autism spectrum",
      "Childhood diabetes", "Genetic disorders",
      "Nutritional deficiencies", "Growth problems"
    ],
    diagnosticProcedures: [
      "Growth monitoring", "Developmental screening",
      "Vaccination assessment", "Blood tests",
      "Imaging studies", "Hearing and vision tests",
      "Genetic testing", "Allergy testing"
    ],
    treatments: [
      "Vaccinations", "Medication management",
      "Nutritional counseling", "Developmental therapy",
      "Behavioral therapy", "Parent education",
      "Preventive care", "Growth monitoring"
    ],
    vietnameseTerms: {
      "Vaccinations": "Tiêm chủng",
      "Growth monitoring": "Theo dõi tăng trưởng",
      "Developmental delays": "Chậm phát triển",
      "ADHD": "Tăng động giảm chú ý",
      "Asthma": "Hen suyễn",
      "Nutritional deficiencies": "Thiếu dinh dưỡng"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a5",
    name: "Orthopedics",
    description: "Bone and musculoskeletal specialist",
    icon: "bandage",
    color: "#8e24aa",
    isActive: true,
    doctorCount: 0,
    commonConditions: [
      "Fractures", "Osteoarthritis", "Rheumatoid arthritis",
      "Back pain", "Sports injuries", "Osteoporosis",
      "Scoliosis", "Carpal tunnel syndrome", "Tendinitis",
      "Joint dislocations"
    ],
    diagnosticProcedures: [
      "X-rays", "MRI", "CT scan", "Bone density test",
      "Arthroscopy", "Joint aspiration", "Physical examination",
      "Ultrasound", "Nerve conduction studies"
    ],
    treatments: [
      "Fracture management", "Joint replacement",
      "Arthroscopic surgery", "Physical therapy",
      "Pain management", "Cortisone injections",
      "Spinal surgery", "Sports medicine rehabilitation"
    ],
    vietnameseTerms: {
      "Fractures": "Gãy xương",
      "Osteoarthritis": "Thoái hóa khớp",
      "Back pain": "Đau lưng",
      "Joint replacement": "Thay khớp",
      "Physical therapy": "Vật lý trị liệu",
      "Sports injuries": "Chấn thương thể thao"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a6",
    name: "Ophthalmology",
    description: "Eye specialist",
    icon: "eye",
    color: "#3949ab",
    isActive: true,
    doctorCount: 0,
    commonConditions: [
      "Cataracts", "Glaucoma", "Macular degeneration",
      "Diabetic retinopathy", "Refractive errors",
      "Conjunctivitis", "Dry eye syndrome",
      "Retinal detachment", "Eye injuries"
    ],
    diagnosticProcedures: [
      "Visual acuity test", "Slit-lamp examination",
      "Tonometry", "Retinal examination",
      "Visual field test", "Optical coherence tomography",
      "Fluorescein angiography", "Corneal topography"
    ],
    treatments: [
      "Cataract surgery", "Laser eye surgery",
      "Glaucoma medications", "Retinal surgery",
      "Corneal transplantation", "Vision therapy",
      "Prescription glasses/contacts", "Intravitreal injections"
    ],
    vietnameseTerms: {
      "Cataracts": "Đục thủy tinh thể",
      "Glaucoma": "Glaucoma",
      "Visual acuity test": "Đo thị lực",
      "Cataract surgery": "Phẫu thuật đục thủy tinh thể",
      "Refractive errors": "Tật khúc xạ",
      "Conjunctivitis": "Viêm kết mạc"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a7",
    name: "Dentistry",
    description: "Dental and oral health specialist",
    icon: "medical",
    color: "#00897b",
    isActive: true,
    doctorCount: 0,
    commonConditions: [
      "Dental caries", "Gum disease", "Tooth abscess",
      "Oral cancer", "Malocclusion", "Temporomandibular disorders",
      "Tooth sensitivity", "Oral infections", "Wisdom teeth problems"
    ],
    diagnosticProcedures: [
      "Dental X-rays", "Oral examination", "Panoramic radiography",
      "Oral cancer screening", "Periodontal probing",
      "Dental impressions", "CBCT scan", "Saliva testing"
    ],
    treatments: [
      "Fillings", "Root canal treatment", "Tooth extraction",
      "Dental crowns", "Dental implants", "Orthodontics",
      "Teeth cleaning", "Gum surgery", "Oral surgery"
    ],
    vietnameseTerms: {
      "Dental caries": "Sâu răng",
      "Gum disease": "Bệnh nướu răng",
      "Tooth extraction": "Nhổ răng",
      "Root canal treatment": "Điều trị tủy răng",
      "Dental implants": "Cấy ghép răng",
      "Orthodontics": "Chỉnh nha"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a8",
    name: "Psychiatry",
    description: "Mental health specialist",
    icon: "headset",
    color: "#6d4c41",
    isActive: true,
    doctorCount: 0,
    commonConditions: [
      "Depression", "Anxiety disorders", "Bipolar disorder",
      "Schizophrenia", "OCD", "PTSD", "Eating disorders",
      "Substance abuse", "ADHD", "Personality disorders"
    ],
    diagnosticProcedures: [
      "Psychiatric evaluation", "Psychological testing",
      "Mental status examination", "Diagnostic interviews",
      "Brain imaging", "Laboratory tests",
      "Personality assessment", "Cognitive testing"
    ],
    treatments: [
      "Psychotherapy", "Medication management",
      "Cognitive behavioral therapy", "ECT",
      "TMS", "Hospitalization", "Group therapy",
      "Family therapy", "Rehabilitation programs"
    ],
    vietnameseTerms: {
      "Depression": "Trầm cảm",
      "Anxiety disorders": "Rối loạn lo âu",
      "Psychotherapy": "Trị liệu tâm lý",
      "Medication management": "Quản lý thuốc",
      "Bipolar disorder": "Rối loạn lưỡng cực",
      "Schizophrenia": "Tâm thần phân liệt"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1a9",
    name: "Surgery",
    description: "General and specialized surgery",
    icon: "cut",
    color: "#f4511e",
    isActive: true,
    doctorCount: 0,
    commonConditions: [
      "Appendicitis", "Gallstones", "Hernias",
      "Gastrointestinal disorders", "Trauma injuries",
      "Tumors", "Vascular diseases", "Transplant needs",
      "Surgical emergencies"
    ],
    diagnosticProcedures: [
      "CT scan", "MRI", "Ultrasound", "Endoscopy",
      "Biopsy", "Angiography", "Laparoscopy",
      "Exploratory surgery", "Pre-operative testing"
    ],
    treatments: [
      "General surgery", "Laparoscopic surgery",
      "Emergency surgery", "Transplant surgery",
      "Vascular surgery", "Surgical oncology",
      "Trauma surgery", "Minimally invasive procedures"
    ],
    vietnameseTerms: {
      "Appendicitis": "Viêm ruột thừa",
      "Gallstones": "Sỏi mật",
      "Hernias": "Thoát vị",
      "Surgery": "Phẫu thuật",
      "Laparoscopic surgery": "Phẫu thuật nội soi",
      "Transplant surgery": "Phẫu thuật cấy ghép"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1aa",
    name: "Gynecology",
    description: "Female reproductive health specialist",
    icon: "female",
    color: "#d81b60",
    isActive: true,
    doctorCount: 0,
    commonConditions: [
      "Menstrual disorders", "PCOS", "Endometriosis",
      "Uterine fibroids", "Ovarian cysts", "Menopause",
      "Infertility", "Pelvic inflammatory disease",
      "Cervical abnormalities"
    ],
    diagnosticProcedures: [
      "Pap smear", "Pelvic ultrasound", "Hysteroscopy",
      "Colposcopy", "Endometrial biopsy", "HSG",
      "Laparoscopy", "Hormone testing", "Mammography"
    ],
    treatments: [
      "Hormone therapy", "Contraceptive management",
      "Fertility treatments", "Minimally invasive surgery",
      "Hysterectomy", "Cancer treatments",
      "Menopausal management", "Reproductive health counseling"
    ],
    vietnameseTerms: {
      "Menstrual disorders": "Rối loạn kinh nguyệt",
      "PCOS": "Buồng trứng đa nang",
      "Pap smear": "Xét nghiệm Pap",
      "Hormone therapy": "Liệu pháp hormone",
      "Infertility": "Vô sinh",
      "Menopause": "Mãn kinh"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1ab",
    name: "Endocrinology",
    description: "Hormone and metabolism specialist",
    icon: "pulse",
    color: "#5e35b1",
    isActive: true,
    doctorCount: 0,
    commonConditions: [
      "Diabetes mellitus", "Thyroid disorders",
      "Osteoporosis", "Adrenal disorders",
      "Pituitary disorders", "Metabolic syndrome",
      "Growth disorders", "Calcium disorders",
      "Reproductive endocrine disorders"
    ],
    diagnosticProcedures: [
      "Blood glucose testing", "HbA1c", "Thyroid function tests",
      "Hormone level testing", "Bone density scan",
      "Stimulation tests", "Imaging studies",
      "Genetic testing", "Metabolic panels"
    ],
    treatments: [
      "Insulin therapy", "Oral hypoglycemics",
      "Hormone replacement", "Thyroid medications",
      "Osteoporosis treatment", "Lifestyle counseling",
      "Diabetes education", "Metabolic management"
    ],
    vietnameseTerms: {
      "Diabetes mellitus": "Đái tháo đường",
      "Thyroid disorders": "Rối loạn tuyến giáp",
      "Insulin therapy": "Liệu pháp insulin",
      "HbA1c": "Xét nghiệm HbA1c",
      "Osteoporosis": "Loãng xương",
      "Hormone replacement": "Thay thế hormone"
    }
  },
  {
    _id: "64f1a1a1a1a1a1a1a1a1a1ac",
    name: "Gastroenterology",
    description: "Digestive system specialist",
    icon: "nutrition",
    color: "#2e7d32",
    isActive: true,
    doctorCount: 0,
    commonConditions: [
      "GERD", "Irritable bowel syndrome", "Inflammatory bowel disease",
      "Peptic ulcers", "Liver diseases", "Pancreatitis",
      "Gallbladder disease", "Celiac disease",
      "Gastrointestinal cancers"
    ],
    diagnosticProcedures: [
      "Endoscopy", "Colonoscopy", "Capsule endoscopy",
      "ERCP", "Liver biopsy", "Breath tests",
      "Stool tests", "Imaging studies", "pH monitoring"
    ],
    treatments: [
      "Medication management", "Endoscopic procedures",
      "Nutritional counseling", "Lifestyle modifications",
      "Liver disease management", "Inflammatory bowel disease therapy",
      "Cancer treatments", "Surgical referrals"
    ],
    vietnameseTerms: {
      "GERD": "Trào ngược dạ dày",
      "Endoscopy": "Nội soi",
      "Colonoscopy": "Nội soi đại tràng",
      "Liver diseases": "Bệnh gan",
      "Irritable bowel syndrome": "Hội chứng ruột kích thích",
      "Peptic ulcers": "Loét dạ dày"
    }
  }
];

// Helper functions
export const getSpecialtyById = (id: string): MedicalSpecialty | undefined => {
  return MedicalSpecialties.find(specialty => specialty._id === id);
};

export const getActiveSpecialties = (): MedicalSpecialty[] => {
  return MedicalSpecialties.filter(specialty => specialty.isActive);
};

export const getSpecialtiesWithDoctors = (): MedicalSpecialty[] => {
  return MedicalSpecialties.filter(specialty => 
    specialty.isActive && specialty.doctorCount > 0
  );
};

export const searchSpecialties = (query: string): MedicalSpecialty[] => {
  const lowerQuery = query.toLowerCase();
  return MedicalSpecialties.filter(specialty =>
    specialty.name.toLowerCase().includes(lowerQuery) ||
    specialty.description.toLowerCase().includes(lowerQuery) ||
    specialty.commonConditions.some(condition => 
      condition.toLowerCase().includes(lowerQuery)
    )
  );
};

export const getSpecialtyByName = (name: string): MedicalSpecialty | undefined => {
  return MedicalSpecialties.find(specialty => 
    specialty.name.toLowerCase() === name.toLowerCase()
  );
};

// Export specialty names for easy reference
export const SpecialtyNames = {
  CARDIOLOGY: "Cardiology",
  DERMATOLOGY: "Dermatology",
  NEUROLOGY: "Neurology",
  PEDIATRICS: "Pediatrics",
  ORTHOPEDICS: "Orthopedics",
  OPHTHALMOLOGY: "Ophthalmology",
  DENTISTRY: "Dentistry",
  PSYCHIATRY: "Psychiatry",
  SURGERY: "Surgery",
  GYNECOLOGY: "Gynecology",
  ENDOCRINOLOGY: "Endocrinology",
  GASTROENTEROLOGY: "Gastroenterology"
} as const;

export type SpecialtyName = typeof SpecialtyNames[keyof typeof SpecialtyNames];