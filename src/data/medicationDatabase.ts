export interface Medication {
  genericName: string;
  brandNames: string[];
  drugClass: string;
  indications: string[];
  mechanism: string;
  dosageForms: string[];
  sideEffects: string[];
  contraindications: string[];
  interactions: string[];
  specialPrecautions: string[];
  vietnameseInfo: {
    commonName: string;
    indications: string[];
    precautions: string[];
    dosageInstructions: string;
  };
}

export const MedicationDatabase: Medication[] = [
  {
    genericName: "Metformin",
    brandNames: ["Glucophage", "Glumetza", "Fortamet"],
    drugClass: "Biguanide antidiabetic",
    indications: [
      "Type 2 diabetes mellitus",
      "Polycystic ovary syndrome",
      "Prediabetes"
    ],
    mechanism: "Decreases hepatic glucose production and intestinal absorption of glucose; improves insulin sensitivity",
    dosageForms: ["Tablet", "Extended-release tablet", "Oral solution"],
    sideEffects: [
      "Nausea", "Diarrhea", "Abdominal discomfort",
      "Decreased appetite", "Metallic taste", "Lactic acidosis (rare)"
    ],
    contraindications: [
      "Severe renal impairment",
      "Metabolic acidosis",
      "Hypersensitivity to metformin"
    ],
    interactions: [
      "Alcohol", "Iodinated contrast materials",
      "Cimetidine", "Furosemide", "Nifedipine"
    ],
    specialPrecautions: [
      "Monitor renal function regularly",
      "Withhold before radiographic studies with contrast",
      "Risk of vitamin B12 deficiency with long-term use"
    ],
    vietnameseInfo: {
      commonName: "Metformin",
      indications: [
        "Đái tháo đường type 2",
        "Hội chứng buồng trứng đa nang",
        "Tiền đái tháo đường"
      ],
      precautions: [
        "Theo dõi chức năng thận định kỳ",
        "Ngừng thuốc trước khi chụp X-quang có cản quang",
        "Nguy cơ thiếu vitamin B12 khi dùng lâu dài"
      ],
      dosageInstructions: "Uống trong hoặc sau bữa ăn để giảm tác dụng phụ đường tiêu hóa"
    }
  },
  {
    genericName: "Atorvastatin",
    brandNames: ["Lipitor", "Atorva", "Torvast"],
    drugClass: "HMG-CoA reductase inhibitor (Statin)",
    indications: [
      "Hypercholesterolemia",
      "Primary prevention of cardiovascular disease",
      "Secondary prevention in patients with established cardiovascular disease"
    ],
    mechanism: "Inhibits HMG-CoA reductase, the rate-limiting enzyme in cholesterol synthesis",
    dosageForms: ["Tablet"],
    sideEffects: [
      "Headache", "Myalgia", "Arthralgia",
      "Increased liver enzymes", "Rhabdomyolysis (rare)",
      "Diabetes mellitus (increased risk)"
    ],
    contraindications: [
      "Active liver disease",
      "Pregnancy and breastfeeding",
      "Hypersensitivity to atorvastatin"
    ],
    interactions: [
      "Cyclosporine", "Gemfibrozil", " protease inhibitors",
      "Erythromycin", "Grapefruit juice"
    ],
    specialPrecautions: [
      "Monitor liver enzymes before and during treatment",
      "Assess muscle symptoms periodically",
      "Use with caution in patients with renal impairment"
    ],
    vietnameseInfo: {
      commonName: "Atorvastatin",
      indications: [
        "Tăng cholesterol máu",
        "Phòng ngừa bệnh tim mạch",
        "Điều trị sau biến cố tim mạch"
      ],
      precautions: [
        "Theo dõi men gan trước và trong điều trị",
        "Theo dõi triệu chứng cơ",
        "Thận trọng ở bệnh nhân suy thận"
      ],
      dosageInstructions: "Uống một lần mỗi ngày, có thể uống với hoặc không với thức ăn"
    }
  },
  {
    genericName: "Amoxicillin",
    brandNames: ["Amoxil", "Moxatag", "Trimox"],
    drugClass: "Penicillin antibiotic",
    indications: [
      "Bacterial infections",
      "Otitis media",
      "Respiratory tract infections",
      "Urinary tract infections",
      "Skin and soft tissue infections"
    ],
    mechanism: "Inhibits bacterial cell wall synthesis by binding to penicillin-binding proteins",
    dosageForms: ["Capsule", "Tablet", "Chewable tablet", "Oral suspension"],
    sideEffects: [
      "Diarrhea", "Nausea", "Vomiting",
      "Rash", "Allergic reactions",
      "Candidiasis"
    ],
    contraindications: [
      "Hypersensitivity to penicillins",
      "History of severe allergic reactions to beta-lactams"
    ],
    interactions: [
      "Probenecid", "Methotrexate",
      "Oral contraceptives", "Warfarin"
    ],
    specialPrecautions: [
      "Use with caution in patients with mononucleosis",
      "May cause antibiotic-associated colitis",
      "Complete full course of treatment"
    ],
    vietnameseInfo: {
      commonName: "Amoxicillin",
      indications: [
        "Nhiễm khuẩn",
        "Viêm tai giữa",
        "Nhiễm khuẩn đường hô hấp",
        "Nhiễm khuẩn đường tiết niệu"
      ],
      precautions: [
        "Dị ứng penicillin",
        "Có thể gây tiêu chảy",
        "Uống đủ liệu trình"
      ],
      dosageInstructions: "Uống cách đều nhau trong ngày, có thể uống với thức ăn để giảm kích ứng dạ dày"
    }
  }
  // Add more medications as needed...
];

// Helper functions
export const getMedicationByName = (name: string): Medication | undefined => {
  const lowerName = name.toLowerCase();
  return MedicationDatabase.find(med =>
    med.genericName.toLowerCase().includes(lowerName) ||
    med.brandNames.some(brand => brand.toLowerCase().includes(lowerName))
  );
};

export const getMedicationsByClass = (drugClass: string): Medication[] => {
  return MedicationDatabase.filter(med =>
    med.drugClass.toLowerCase().includes(drugClass.toLowerCase())
  );
};

export const searchMedications = (query: string): Medication[] => {
  const lowerQuery = query.toLowerCase();
  return MedicationDatabase.filter(med =>
    med.genericName.toLowerCase().includes(lowerQuery) ||
    med.brandNames.some(brand => brand.toLowerCase().includes(lowerQuery)) ||
    med.indications.some(indication => indication.toLowerCase().includes(lowerQuery))
  );
};