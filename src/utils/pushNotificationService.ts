import admin from 'firebase-admin';
import { DeviceType } from '../models/notificationDevice';
import Expo from 'expo-server-sdk';

export interface PushNotificationPayload {
  device_token: string;
  device_type: DeviceType;
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: 'normal' | 'high';
  badge?: number;
  sound?: string;
}

class PushNotificationService {
  private expo: Expo;
  private firebaseAdmin: any;

  constructor() {
    // Initialize Firebase Admin for Android/iOS
    try {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        
        this.firebaseAdmin = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        
        console.log('✅ Firebase Admin initialized');
      }
    } catch (error) {
      console.error('❌ Firebase Admin initialization failed:', error);
    }

    // Initialize Expo for React Native
    this.expo = new Expo();
  }

  // Send push notification
  async send(payload: PushNotificationPayload): Promise<boolean> {
    try {
      switch (payload.device_type) {
        case 'android':
        case 'ios':
          return await this.sendFCM(payload);
        case 'web':
          return await this.sendWebPush(payload);
        case 'desktop':
          return await this.sendDesktopPush(payload);
        default:
          console.error(`❌ Unsupported device type: ${payload.device_type}`);
          return false;
      }
    } catch (error) {
      console.error('❌ Error sending push notification:', error);
      return false;
    }
  }

  // Send FCM (Firebase Cloud Messaging)
  private async sendFCM(payload: PushNotificationPayload): Promise<boolean> {
    try {
      if (!this.firebaseAdmin) {
        console.error('❌ Firebase Admin not initialized');
        return false;
      }

      const message = {
        token: payload.device_token,
        notification: {
          title: payload.title,
          body: payload.body
        },
        data: payload.data || {},
        android: {
          priority: payload.priority === 'high' ? 'high' : 'normal',
          notification: {
            sound: payload.sound || 'default',
            channelId: payload.priority === 'high' ? 'high_priority' : 'default'
          }
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: payload.title,
                body: payload.body
              },
              sound: payload.sound || 'default',
              badge: payload.badge || 1,
              priority: payload.priority === 'high' ? 10 : 5
            }
          }
        }
      };

      const response = await this.firebaseAdmin.messaging().send(message);
      console.log(`✅ FCM notification sent: ${response}`);
      return true;
    } catch (error: any) {
      console.error('❌ FCM error:', error.message);
      
      // Handle specific FCM errors
      if (error.code === 'messaging/registration-token-not-registered') {
        console.log(`⚠️ Device token ${payload.device_token} is no longer valid`);
        // Mark device as inactive in database
      }
      
      return false;
    }
  }

  // Send web push notification
  private async sendWebPush(payload: PushNotificationPayload): Promise<boolean> {
    try {
      // This would use Web Push API
      // For now, log and return success for testing
      console.log(`📱 Web push would be sent to: ${payload.device_token.substring(0, 20)}...`);
      console.log(`Title: ${payload.title}, Body: ${payload.body}`);
      return true;
    } catch (error) {
      console.error('❌ Web push error:', error);
      return false;
    }
  }

  // Send desktop push notification
  private async sendDesktopPush(payload: PushNotificationPayload): Promise<boolean> {
    try {
      // Implement desktop push logic (Electron, NW.js, etc.)
      console.log(`💻 Desktop push would be sent to: ${payload.device_token.substring(0, 20)}...`);
      return true;
    } catch (error) {
      console.error('❌ Desktop push error:', error);
      return false;
    }
  }

  // Send batch notifications
  async sendBatch(messages: PushNotificationPayload[]): Promise<Array<{ success: boolean; error?: string }>> {
    const results = [];

    for (const message of messages) {
      try {
        const success = await this.send(message);
        results.push({ success });
      } catch (error: any) {
        results.push({ 
          success: false, 
          error: error.message 
        });
      }
    }

    return results;
  }

  // Validate device token
  async validateToken(device_token: string, device_type: DeviceType): Promise<boolean> {
    try {
      switch (device_type) {
        case 'android':
        case 'ios':
          // Check FCM token validity
          const response = await this.firebaseAdmin.messaging().send({
            token: device_token,
            data: { test: 'true' }
          }, true); // dry-run mode
          return !!response;
        
        case 'web':
          // Web push validation
          return device_token.startsWith('web:');
        
        default:
          return false;
      }
    } catch (error) {
      console.error('❌ Token validation error:', error);
      return false;
    }
  }
}

export const pushNotificationService = new PushNotificationService();
