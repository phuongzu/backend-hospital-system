import mongoose from "mongoose";

const UserInfoSchema = new mongoose.Schema(
  {
    user_id: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      required: true 
    },
    emergency_contact: {
      name: { type: String, required: true },
      relationship: { type: String, default: 'Family' },
      phone: { type: String, required: true },
      email: { type: String, default: '' }
    },
    blood_type: { type: String, default: '' },
    allergist: { type: String, default: '' },
    current_medications: [{
      name: { type: String, required: true },
      dosage: { type: String, default: '' },
      frequency: { type: String, default: '' },
      start_date: { type: Date, default: Date.now },
      reason: { type: String, default: '' },
      prescribed_by: { type: String, default: '' }
    }],
    height: { type: Number, default: 0 }, // Fixed typo: heght -> height
    weight: { type: Number, default: 0 },
    chronic_diseases: { type: [String], default: [] },
    BMI: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// Update the getSummary method
UserInfoSchema.methods.getSummary = function() {
  return {
    _id: this._id,
    user_id: this.user_id,
    emergency_contact: this.emergency_contact,
    blood_type: this.blood_type,
    allergist: this.allergist,
    current_medications: this.current_medications,
    height: this.height,
    weight: this.weight,
    chronic_diseases: this.chronic_diseases,
    BMI: this.BMI,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

UserInfoSchema.methods.calculateBMI = function() {
  if (this.height > 0 && this.weight > 0) {
    const heightInMeters = this.height / 100;
    this.BMI = parseFloat((this.weight / (heightInMeters * heightInMeters)).toFixed(2));
  }
  return this.BMI;
};

UserInfoSchema.methods.updateMedicalInfo = async function(newInfo) {
  Object.assign(this, newInfo);
  this.calculateBMI();
  await this.save();
  return this;
};

const UserInfo = mongoose.model("UserInfo", UserInfoSchema);

export default UserInfo;