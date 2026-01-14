// src/utils/appointmentEvents.ts
import socketService from './socketService';
import { notificationService } from './notificationService';
import Appointment from '../models/appointment';

class AppointmentEvents {
  // ============ APPOINTMENT CREATED ============
  static async onAppointmentCreated(appointment: any): Promise<void> {
    try {
      const populatedAppointment = await Appointment.findById(appointment._id)
        .populate('doctor_id', 'user_id specialty_id')
        .populate('user_id', 'name email phoneNumber')
        .populate('specialty_id', 'name');

      if (!populatedAppointment) return;

      const { doctor_id, user_id } = populatedAppointment;

      // 🔥 REAL-TIME: Notify DOCTOR
      if (doctor_id && (doctor_id as any).user_id) {
        const doctorUserId = (doctor_id as any).user_id.toString();
        
        // Socket notification
        socketService.notifyNewAppointmentToDoctor(doctorUserId, populatedAppointment);
        
        // Also update doctor's dashboard stats if they're online
        if (socketService.isUserOnline(doctorUserId)) {
          socketService.emitToUser(doctorUserId, 'dashboard:stats-refresh', {
            type: 'STATS_NEED_REFRESH',
            timestamp: new Date()
          });
        }
      }

      // 🔥 REAL-TIME: Notify PATIENT
      if (user_id) {
        socketService.notifyPatientAppointmentStatus(
          user_id.toString(),
          populatedAppointment,
          'created'
        );
      }

      // 🔥 Create appointment room for future updates
      socketService.emitToRoom(`appointment:${appointment._id}`, 'appointment:room-created', {
        appointmentId: appointment._id,
        participants: {
          doctor: doctor_id,
          patient: user_id
        },
        timestamp: new Date()
      });

      console.log(`📅 Real-time events sent for appointment ${appointment._id}`);

    } catch (error) {
      console.error('Error in appointment created events:', error);
    }
  }

  // ============ APPOINTMENT UPDATED ============
  static async onAppointmentUpdated(appointmentId: string, updateData: any, oldStatus?: string): Promise<void> {
    try {
      const appointment = await Appointment.findById(appointmentId)
        .populate('doctor_id', 'user_id')
        .populate('user_id', 'name');

      if (!appointment) return;

      const { doctor_id, user_id, status } = appointment;

      // 🔥 REAL-TIME: Update all connected clients
      socketService.updateAppointmentRealTime(appointmentId, {
        ...updateData,
        oldStatus,
        newStatus: status
      });

      // 🔥 Notify DOCTOR
      if (doctor_id && (doctor_id as any).user_id) {
        socketService.emitToUser(
          (doctor_id as any).user_id.toString(),
          'appointment:doctor-updated',
          {
            type: 'APPOINTMENT_UPDATED',
            appointmentId,
            status,
            patientName: user_id?.name,
            timestamp: new Date()
          }
        );
      }

      // 🔥 Notify PATIENT
      if (user_id) {
        socketService.emitToUser(
          user_id.toString(),
          'appointment:patient-updated',
          {
            type: 'APPOINTMENT_STATUS_CHANGED',
            appointmentId,
            status,
            doctorName: (doctor_id as any)?.name,
            timestamp: new Date()
          }
        );
      }

      // 🔥 If status changed to 'confirmed', send reminders
      if (oldStatus !== 'confirmed' && status === 'confirmed') {
        await this.scheduleReminders(appointment);
      }

      // 🔥 If cancelled, notify all participants
      if (status === 'cancelled') {
        socketService.emitToRoom(`appointment:${appointmentId}`, 'appointment:cancelled', {
          appointmentId,
          cancelledAt: new Date(),
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('Error in appointment updated events:', error);
    }
  }

  // ============ APPOINTMENT CANCELLED ============
  static async onAppointmentCancelled(appointmentId: string): Promise<void> {
    try {
      const appointment = await Appointment.findById(appointmentId)
        .populate('doctor_id', 'user_id')
        .populate('user_id');

      if (!appointment) return;

      // 🔥 Broadcast cancellation
      socketService.emitToRoom(`appointment:${appointmentId}`, 'appointment:force-cancelled', {
        type: 'APPOINTMENT_CANCELLED',
        appointmentId,
        reason: 'Cancelled by user or system',
        timestamp: new Date()
      });

      // 🔥 Notify doctor
      if (appointment.doctor_id && (appointment.doctor_id as any).user_id) {
        socketService.emitToUser(
          (appointment.doctor_id as any).user_id.toString(),
          'appointment:doctor-cancelled',
          {
            appointmentId,
            patientName: appointment.user_id?.name,
            timestamp: new Date()
          }
        );
      }

      // 🔥 Update doctor dashboard stats
      if (appointment.doctor_id) {
        socketService.emitToRoom(
          `doctor-dashboard:${(appointment.doctor_id as any).user_id}`,
          'dashboard:stats-refresh',
          { type: 'STATS_NEED_REFRESH' }
        );
      }

    } catch (error) {
      console.error('Error in appointment cancelled events:', error);
    }
  }

  // ============ SCHEDULE REMINDERS ============
  private static async scheduleReminders(appointment: any): Promise<void> {
    try {
      const { _id, user_id, doctor_id, appointment_date, time_slot } = appointment;
      
      if (!user_id || !appointment_date) return;

      // Schedule 24-hour reminder
      const reminder24h = new Date(appointment_date);
      reminder24h.setHours(reminder24h.getHours() - 24);
      
      if (reminder24h > new Date()) {
        await notificationService.sendNotification({
          user_id: user_id.toString(),
          title: 'Appointment Reminder',
          message: `Reminder: Your appointment is in 24 hours at ${time_slot}`,
          type: 'reminder',
          scheduled_time: reminder24h,
          data: {
            appointmentId: _id,
            appointmentTime: time_slot,
            doctorName: (doctor_id as any)?.name
          }
        });
      }

      // Schedule 1-hour reminder
      const reminder1h = new Date(appointment_date);
      reminder1h.setHours(reminder1h.getHours() - 1);
      
      if (reminder1h > new Date()) {
        await notificationService.sendNotification({
          user_id: user_id.toString(),
          title: 'Appointment Soon',
          message: `Your appointment starts in 1 hour at ${time_slot}`,
          type: 'reminder',
          scheduled_time: reminder1h,
          data: {
            appointmentId: _id,
            appointmentTime: time_slot
          }
        });
      }

    } catch (error) {
      console.error('Error scheduling reminders:', error);
    }
  }

  // ============ GET REAL-TIME STATS ============
  static async getDoctorRealTimeStats(doctorId: string): Promise<any> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [
        todayAppointments,
        pendingAppointments,
        completedToday,
        totalPatients
      ] = await Promise.all([
        Appointment.countDocuments({
          doctor_id: doctorId,
          appointment_date: { $gte: today, $lt: tomorrow },
          status: { $in: ['pending', 'confirmed'] }
        }),
        Appointment.countDocuments({
          doctor_id: doctorId,
          status: 'pending'
        }),
        Appointment.countDocuments({
          doctor_id: doctorId,
          appointment_date: { $gte: today, $lt: tomorrow },
          status: 'completed'
        }),
        // This would need a different query to count unique patients
        Appointment.distinct('user_id', { doctor_id: doctorId }).then(ids => ids.length)
      ]);

      return {
        todayAppointments,
        pendingAppointments,
        completedToday,
        totalPatients,
        updatedAt: new Date()
      };
    } catch (error) {
      console.error('Error getting real-time stats:', error);
      return {
        todayAppointments: 0,
        pendingAppointments: 0,
        completedToday: 0,
        totalPatients: 0,
        updatedAt: new Date()
      };
    }
  }
}

export default AppointmentEvents;