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
  getMedicalTermExplanation
} from '../controllers/aiMedicalController';
import { protect } from '../middlewares/authmiddleware';

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


export default router;