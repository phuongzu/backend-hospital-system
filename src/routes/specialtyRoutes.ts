import express from 'express';
import {
    getAllSpecialties,
    getSpecialtyById,
    updateSpecialty,
    createSpecialty,
    deleteSpecialty
} from '../controllers/specialtyController';
import { protect } from '../middlewares/authmiddleware';

const router = express.Router();

// Get all specialties
router.get('/', getAllSpecialties);
router.get('/:id', getSpecialtyById);
router.post('/create', protect, createSpecialty);
router.put('/:id', protect, updateSpecialty);
router.delete('/:id', protect, deleteSpecialty);

export default router;
