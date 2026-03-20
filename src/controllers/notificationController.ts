import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/authmiddleware';
import { notificationService } from '../utils/notificationService';
import Notification from '../models/notification';
import NotificationDevice from '../models/notificationDevice';
import User from '../models/user';
import Doctor from '../models/doctor';

// ================================
// GET USER NOTIFICATIONS
// ================================
export const getUserNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { page = 1, limit = 20, read, type, category, priority, start_date, end_date } = req.query;

    const result = await notificationService.getUserNotifications(req.user._id, {
      page: Number(page),
      limit: Number(limit),
      read: read as any,
      type: type as string,
      category: category as string,
      priority: priority as string,
      start_date: start_date ? new Date(start_date as string) : undefined,
      end_date: end_date ? new Date(end_date as string) : undefined,
    });

    res.status(200).json({ success: true, data: result.notifications, pagination: result.pagination });
  } catch (error) {
    console.error('❌ Error getting notifications:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// GET NOTIFICATION BY ID
// ================================
export const getNotificationById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { notificationId } = req.params;

    const notification = await Notification.findOne({ _id: notificationId, user_id: req.user._id });
    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    if (!notification.read) await notification.markAsRead();

    res.status(200).json({ success: true, data: notification.toNotificationResponse() });
  } catch (error) {
    console.error('❌ Error getting notification:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// GET UNREAD COUNT
// ================================
export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const count = await notificationService.getUnreadCount(req.user._id);
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    console.error('❌ Error getting unread count:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// MARK AS READ
// ================================
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { notificationId } = req.params;

    const notification = await notificationService.markAsRead(notificationId, req.user._id);
    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Notification marked as read', data: notification.toNotificationResponse() });
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // ============= DEBUG: Xem DB đang lưu field gì =============
    // Chạy lần đầu để biết schema thực tế, sau đó có thể xóa block này
    const sampleNotif = await Notification.findOne().lean();
    console.log('=== DEBUG NOTIFICATION SCHEMA ===');
    console.log('Sample document keys:', sampleNotif ? Object.keys(sampleNotif) : 'No documents found');
    console.log('Sample document:', JSON.stringify(sampleNotif, null, 2));
    console.log('Current userId:', userId.toString());
    const doctor = await Doctor.findOne({ user_id: userId }).lean();
    console.log('Doctor found:', doctor ? doctor._id.toString() : 'null');
    const beforeCount = await Notification.countDocuments({ read: false });    console.log('Total unread notifications in DB (all users):', beforeCount);
    const orConditions: any[] = [
      { user_id: userId },
      { recipient_id: userId },
      { recipient: userId },
    ];

    if (doctor) {
      orConditions.push(
        { doctor_id: doctor._id },
        { user_id: doctor._id },
      );
    }

    const filter = {
      $or: orConditions,
      read: false,
    };

    console.log('=== UPDATE FILTER ===');
    console.log(JSON.stringify(filter, null, 2));

    // Đếm số doc match filter (trước khi update)
    const matchCount = await Notification.countDocuments(filter);
    console.log('Documents matching filter:', matchCount);

    if (matchCount === 0) {
      // Không có gì để update — trả về thành công luôn (idempotent)
      console.warn('⚠️ No matching notifications found. Check field names in DB vs filter.');
      res.status(200).json({
        success: true,
        message: 'No unread notifications found',
        modifiedCount: 0,
        debug: {
          userId: userId.toString(),
          doctorId: doctor?._id?.toString() ?? null,
          hint: 'Check if notification documents use user_id, doctor_id, or recipient_id'
        }
      });
      return;
    }

    // Thực hiện update
    const result = await Notification.updateMany(
      filter,
      {
        $set: {
        read: true,
        read_at: new Date(),
        updated_at: new Date(),
      }
      }
    );

    console.log('=== UPDATE RESULT ===');
    console.log('Matched:', result.matchedCount);
    console.log('Modified:', result.modifiedCount);
    console.log('Acknowledged:', result.acknowledged);

    if (result.modifiedCount === 0 && result.matchedCount > 0) {
      // Match được nhưng không sửa được → có thể field isRead không tồn tại trong schema
      console.error('❌ Matched but not modified — isRead field might not be in schema');
    }

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });

  } catch (error: any) {
    console.error('❌ markAllAsRead error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


export const registerDevice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { device_token, device_type, platform, browser } = req.body;

    if (!device_token || !device_type) {
      res.status(400).json({ success: false, message: 'Device token and type are required' });
      return;
    }

    const device = await notificationService.registerDevice(req.user._id, device_token, device_type, platform, browser);
    res.status(200).json({ success: true, message: 'Device registered successfully', data: device });
  } catch (error) {
    console.error('❌ Error registering device:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// UNREGISTER DEVICE
// ================================
export const unregisterDevice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { device_token } = req.body;

    if (!device_token) {
      res.status(400).json({ success: false, message: 'Device token is required' });
      return;
    }

    await notificationService.unregisterDevice(device_token);
    res.status(200).json({ success: true, message: 'Device unregistered successfully' });
  } catch (error) {
    console.error('❌ Error unregistering device:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// GET USER DEVICES
// ================================
export const getUserDevices = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const devices = await NotificationDevice.find({ user_id: req.user._id, is_active: true }).sort({ updated_at: -1 });
    res.status(200).json({ success: true, data: devices });
  } catch (error) {
    console.error('❌ Error getting user devices:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// DELETE NOTIFICATION
// ================================
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { notificationId } = req.params;

    const notification = await Notification.findOneAndDelete({ _id: notificationId, user_id: req.user._id });
    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting notification:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// CLEAR ALL NOTIFICATIONS
// ================================
export const clearAllNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const result = await Notification.deleteMany({ user_id: req.user._id });
    res.status(200).json({ success: true, message: 'All notifications cleared', data: { deletedCount: result.deletedCount } });
  } catch (error) {
    console.error('❌ Error clearing all notifications:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// GET NOTIFICATION STATS
// ================================
export const getNotificationStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { days = 30 } = req.query;
    const stats = await notificationService.getStatistics(req.user._id, Number(days));

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('❌ Error getting notification stats:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// CREATE TEST NOTIFICATION
// ================================
export const createTestNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ success: false, message: 'Admin access required' });
      return;
    }

    const { user_id, template_key, title, message, type, channels, variables } = req.body;

    const notification = await notificationService.sendNotification({
      user_id: user_id || req.user._id,
      template_key,
      title: title || 'Test Notification',
      message: message || 'This is a test notification',
      type: type || 'system',
      channels: channels || ['in_app', 'email'],
      variables: variables || {},
      metadata: { test: true },
    });

    res.status(200).json({ success: true, message: 'Test notification sent', data: notification });
  } catch (error) {
    console.error('❌ Error creating test notification:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================================
// HANDLE CLICK ACTION
// ================================
export const clickNotificationAction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { notificationId } = req.params;

    const notification = await Notification.findOne({ _id: notificationId, user_id: req.user._id });
    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    await notification.markAsClicked();

    if (notification.action_url) {
      res.status(200).json({
        success: true,
        data: {
          action_url: notification.action_url,
          action_label: notification.action_label,
        },
      });
    } else {
      res.status(200).json({ success: true, message: 'Notification action clicked' });
    }
  } catch (error) {
    console.error('❌ Error clicking notification action:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
