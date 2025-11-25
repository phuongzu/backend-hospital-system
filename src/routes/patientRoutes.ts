import express from 'express';
import {
  getAllDoctors,
  updateUser,
  getUser,
  bookAppointment,
  getAllMedicalRecordsForPatient,
  getAllAppointmentsForPatient,
  editAppointment,
  cancelAppointment,
  postDoctorReview,
  getDoctorReviews,
  updateReview,
  getAppointmentAvailability,
  getPatientInfo,
  updatePatientInfo,
  editInfoPatient,
  updateEmergencyContact,
  updateMedications,
  addMedication,
  removeMedication,
  getUserReviews,
  deleteReview,
  getMyMedicalRecords,
  postEmergencyContact,
} from '../controllers/patientController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

// Public routes
router.get('/doctors', getAllDoctors);
router.get('/doctors/:doctor_id/reviews', getDoctorReviews);

// Protected routes
router.use(protect);

// Profile routes
router.get('/profile', getUser);
router.put('/profile', updateUser);

// Patient info routes
router.get('/patient-info', getPatientInfo);
router.post('/patient-info', updatePatientInfo);
router.patch('/patient-info/edit', editInfoPatient);

// Emergency contact routes
router.put('/emergency-contact', updateEmergencyContact);
router.post('/emergency-contact', postEmergencyContact);

// Medications routes
router.put('/medications', updateMedications);
router.post('/medications/add', addMedication);
router.delete('/medications/remove', removeMedication);

// Appointment routes
router.get('/appointments/availability', getAppointmentAvailability);
router.post('/appointments', bookAppointment);
router.get('/medical-records', getAllMedicalRecordsForPatient);
router.get('/appointments/history', getAllAppointmentsForPatient);
router.patch('/appointments/:appointment_id/edit', editAppointment);
router.patch('/appointments/:appointment_id/cancel', cancelAppointment);
router.patch('/reviews/:review_id', updateReview);
router.post('/doctors/:doctor_id/reviews', postDoctorReview);
router.get('/reviews/user', getUserReviews);
router.delete('/reviews/:review_id', deleteReview);
router.get('/medical-records/my-records', protect, getMyMedicalRecords);


export default router;