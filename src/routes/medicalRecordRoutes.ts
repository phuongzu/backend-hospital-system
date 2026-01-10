import express from 'express';
import {
  startTreatment,
  completeTreatmentStep,
  completeProcess,
  confirmProcess,
  requestStepApproval,
  getApprovalRequests,
  activateTreatmentStep,
  changeTreatmentPlanStatus,
  getMyRecords,
  completeTreatmentStepWithMessage
} from '../controllers/medicalRecordController';
import { protect } from '../middlewares/authmiddleware';

const router = express.Router();

router.get('/my-records', protect, getMyRecords);
router.post('/:id/start-treatment', protect, startTreatment);

// Routes for Treatment Plan Steps (Patient side)
router.patch('/:id/steps/:stepNumber/activate', protect, activateTreatmentStep);
router.patch('/:id/steps/:stepNumber/complete', protect, completeTreatmentStep); // Standardized
// Also keep the old one or the one frontend was trying if preferred, but standardization is better:
router.patch('/:id/complete-step/:stepNumber', protect, completeTreatmentStep); 
router.patch('/:consultationId/steps/:stepNumber/complete', completeTreatmentStep);
router.patch('/:consultationId/steps/:stepNumber/complete-with-message', completeTreatmentStepWithMessage);
// Request approval for a specific step
router.post('/:id/steps/:stepNumber/request-approval', protect, requestStepApproval);

// Legacy/Alternative process routes
router.patch('/:id/process/:processId/complete', protect, completeProcess);
router.patch('/:id/process/:processId/confirm', protect, confirmProcess);
router.patch('/:id/process/:processId/approve', protect, changeTreatmentPlanStatus);

// Doctor side
router.get('/:id/approval-requests', protect, getApprovalRequests);

export default router;