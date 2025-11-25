import cron from 'node-cron';
import ChatSession from '../models/chatbot';

export class SessionCleanupService {
  static startCleanupJob() {
    // Chạy mỗi ngày lúc 2:00 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        console.log('🔄 Starting automatic session cleanup...');
        const cleanedCount = await ChatSession.cleanupExpiredSessions();
        console.log(`✅ Cleaned up ${cleanedCount} expired sessions`);
      } catch (error) {
        console.error('❌ Error in automatic session cleanup:', error);
      }
    });
  }
}
