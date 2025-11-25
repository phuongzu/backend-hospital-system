import { Request, Response } from 'express';
import Specialty from '../models/specialty';

// Fetch all specialties
export const getAllSpecialties = async (req: Request, res: Response) => {
  try {
    const specialties = await Specialty.find({});

    res.status(200).json({
      success: true,
      data: specialties
    });
  } catch (error) {
    console.error('Error fetching specialties:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
export const getSpecialtyById = async (req: Request, res: Response) => {
  try {
    const specialty = await Specialty.findById(req.params.id);
    if (!specialty) {
      return res.status(404).json({ success: false, message: 'Specialty not found' });
    }
    res.status(200).json({ success: true, data: specialty });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching specialty' });
  }
};

export const createSpecialty = async (req: Request, res: Response) => {
  try {
    const newSpecialty = new Specialty(req.body);
    const savedSpecialty = await newSpecialty.save();
    res.status(201).json({ success: true, message: 'Specialty created successfully', data: savedSpecialty });
  } catch (error: any) {
    console.error('Error creating specialty:', error);
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A specialty with this name already exists' });
    }
    res.status(400).json({ success: false, message: error.message || 'Error creating specialty' });
  }
};

export const updateSpecialty = async (req: Request, res: Response) => {
  try {
    const updatedSpecialty = await Specialty.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!updatedSpecialty) {
      return res.status(404).json({ success: false, message: 'Specialty not found' });
    }
    res.status(200).json({ success: true, message: 'Specialty updated successfully', data: updatedSpecialty });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Error updating specialty' });
  }
};

export const deleteSpecialty = async (req: Request, res: Response) => {
  try {
    const deletedSpecialty = await Specialty.findByIdAndDelete(req.params.id);
    if (!deletedSpecialty) {
      return res.status(404).json({ success: false, message: 'Specialty not found' });
    }
    res.status(200).json({ success: true, message: 'Specialty deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting specialty' });
  }
};
