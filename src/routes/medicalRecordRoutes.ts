import express from 'express';
import {
  startTreatment,
  completeTreatmentStep,
  completeProcess,
  confirmProcess,
  requestStepApproval,
  getApprovalRequests,
  activateTreatmentStep,
  changeTreatmentPlanStatus
} from '../controllers/medicalRecordController';
import { protect } from '../middlewares/authmiddleware';

const router = express.Router();

router.post('/:id/start-treatment', protect, startTreatment);
router.patch('/:id/steps/:stepNumber/activate', protect, activateTreatmentStep);
router.patch('/:id/complete-step/:stepNumber', protect, completeTreatmentStep);
router.patch('/:id/process/:processId/complete', protect, completeProcess);
router.patch('/:id/process/:processId/confirm', protect, confirmProcess);
router.post('/:id/process/:processId/request-approval', protect, requestStepApproval);
router.get('/:id/approval-requests', protect, getApprovalRequests);
router.patch('/:id/process/:processId/approve', protect, changeTreatmentPlanStatus);


export default router;