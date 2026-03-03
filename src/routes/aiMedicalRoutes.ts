import express from 'express';
import {
  getChatHistory,
  clearChatHistory,
  getSpecialties,
  getOrCreateChatSession,
  sendMessage,
  getSessionMessages,
  closeSession,
  getChatSessions,
  searchChatHistory,
  getMedicationInfo,
  getMedicalTermExplanation,
  createAppointmentFromSuggestion,
  getAllSpecialties,
  getDoctorsBySpecialty,
  findDoctorsForAppointment,
  bookAppointmentFromAI
} from '../controllers/aiMedicalController';
import { protect } from '../middlewares/authmiddleware';
import { validateRequest } from '../middlewares/validateRequest';

const router = express.Router();

router.use(protect);

router.get('/history', getChatHistory);
router.delete('/history', clearChatHistory);
router.get('/specialties', getSpecialties);
router.get('/session', getOrCreateChatSession);
router.post('/chat', sendMessage);
router.get('/session/:session_id', getSessionMessages);
router.post('/session/:session_id/close', closeSession);
router.get('/sessions', getChatSessions);
router.get('/search', searchChatHistory);
router.get('/medication/:medicationName', getMedicationInfo);
router.get('/explain/:term', getMedicalTermExplanation);
router.post('/appointments/create', createAppointmentFromSuggestion);
router.get('/specialties', getAllSpecialties);
router.get('/specialties/:specialty_id/doctors', getDoctorsBySpecialty);
router.get('/doctors/available', findDoctorsForAppointment);
router.post('/appointments/book-from-ai', bookAppointmentFromAI);
export default router;
