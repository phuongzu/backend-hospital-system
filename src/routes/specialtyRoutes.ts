import express from 'express';
import { 
getAllSpecialties,
getSpecialtyById,
updateSpecialty,
createSpecialty,
deleteSpecialty
} from '../controllers/specialtyController';

const router = express.Router();

// Get all specialties
router.get('/', getAllSpecialties);
router.get('/:id',getSpecialtyById);
router.post('/create',createSpecialty);
router.put('/specialties/:id',updateSpecialty);
router.delete('/:id',deleteSpecialty);

export default router;
