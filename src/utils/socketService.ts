import { Server, Socket } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import User from '../models/user';

class SocketService {
  private io: Server;
  private userSockets: Map<string, string[]> = new Map(); // userId -> socketIds

  initialize(server: http.Server): void {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.io.use(this.authenticateSocket.bind(this));
    this.io.on('connection', this.handleConnection.bind(this));

    console.log('✅ Socket.IO initialized');
  }

  // Socket authentication middleware
  private async authenticateSocket(socket: Socket, next: (err?: Error) => void): Promise<void> {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET!) as any;
      const user = await User.findById(decoded.id).select('_id role isActive');
      
      if (!user || !user.isActive) {
        return next(new Error('Authentication error: User not found or inactive'));
      }

      socket.data.user = {
        _id: user._id.toString(),
        role: user.role
      };

      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error'));
    }
  }

  // Handle new connection
  private handleConnection(socket: Socket): void {
    const userId = socket.data.user._id;
    const socketId = socket.id;

    console.log(`🔌 New socket connection: ${socketId} for user: ${userId}`);

    // Store socket mapping
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, []);
    }
    this.userSockets.get(userId)!.push(socketId);

    // Join user room
    socket.join(`user:${userId}`);

    // Join role-based rooms
    socket.join(`role:${socket.data.user.role}`);

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socketId}`);
      
      const userSockets = this.userSockets.get(userId);
      if (userSockets) {
        const index = userSockets.indexOf(socketId);
        if (index > -1) {
          userSockets.splice(index, 1);
        }
        
        if (userSockets.length === 0) {
          this.userSockets.delete(userId);
        }
      }
    });

    // Handle custom events
    socket.on('join_room', (room: string) => {
      socket.join(room);
      console.log(`📝 User ${userId} joined room: ${room}`);
    });

    socket.on('leave_room', (room: string) => {
      socket.leave(room);
      console.log(`📝 User ${userId} left room: ${room}`);
    });

    socket.on('notification_read', (notificationId: string) => {
      this.io.to(`user:${userId}`).emit('notification_updated', {
        notificationId,
        read: true
      });
    });

    // Health check
    socket.on('ping', (callback) => {
      if (typeof callback === 'function') {
        callback('pong');
      }
    });
  }

  // Emit to specific user
  emitToUser(userId: string, event: string, data: any): void {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  // Emit to multiple users
  emitToUsers(userIds: string[], event: string, data: any): void {
    userIds.forEach(userId => {
      this.emitToUser(userId, event, data);
    });
  }

  // Emit to all users
  emitToAll(event: string, data: any): void {
    this.io.emit(event, data);
  }

  // Emit to role
  emitToRole(role: string, event: string, data: any): void {
    this.io.to(`role:${role}`).emit(event, data);
  }

  // Emit to room
  emitToRoom(room: string, event: string, data: any): void {
    this.io.to(room).emit(event, data);
  }

  // Check if user is online
  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId) && this.userSockets.get(userId)!.length > 0;
  }

  // Get online users count
  getOnlineUsersCount(): number {
    return this.userSockets.size;
  }

  // Get user's socket IDs
  getUserSocketIds(userId: string): string[] {
    return this.userSockets.get(userId) || [];
  }
}

export const socketService = new SocketService();
export default socketService;
