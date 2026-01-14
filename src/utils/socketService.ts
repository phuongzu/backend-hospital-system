import { Server, Socket } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import User from '../models/user';

/* =======================
   TYPES
======================= */

interface SocketUser {
  _id: string;
  role: string;
}

/* Extend socket.data typing */
declare module 'socket.io' {
  interface Socket {
    data: {
      user: SocketUser;
    };
  }
}

/* =======================
   SOCKET SERVICE
======================= */

class SocketService {
  private io?: Server;

  // userId -> socketIds[]
  private userSockets: Map<string, string[]> = new Map();

  /* =======================
     INITIALIZE
  ======================= */
  initialize(server: http.Server, io?: Server): void {
    if (io) {
      this.io = io;
    } else {
      this.io = new Server(server, {
        cors: {
          origin: process.env.FRONTEND_URL || '*',
          methods: ['GET', 'POST'],
          credentials: true,
        },
        transports: ['websocket', 'polling'],
      });
    }

    this.io.use(this.authenticateSocket.bind(this));
    this.io.on('connection', this.handleConnection.bind(this));

    console.log('✅ Socket.IO initialized');
  }

  /* =======================
     AUTH MIDDLEWARE
  ======================= */
  private async authenticateSocket(
    socket: Socket,
    next: (err?: Error) => void
  ): Promise<void> {
    try {
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization;

      if (!rawToken) {
        return next(new Error('Authentication error: No token provided'));
      }

      const token = rawToken.replace('Bearer ', '');

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET!
      ) as { id: string };

      const user = await User.findById(decoded.id).select(
        '_id role isActive'
      );

      if (!user || !user.isActive) {
        return next(new Error('Authentication error: User not found or inactive'));
      }

      socket.data.user = {
        _id: user._id.toString(),
        role: user.role,
      };

      next();
    } catch (error) {
      console.error('❌ Socket auth error:', error);
      next(new Error('Authentication error'));
    }
  }

  /* =======================
     CONNECTION HANDLER
  ======================= */
  private handleConnection(socket: Socket): void {
    const userId = socket.data.user._id;
    const role = socket.data.user.role;
    const socketId = socket.id;

    console.log(`🔌 Connected: ${socketId} (user ${userId})`);

    // Save socket mapping
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, []);
    }
    this.userSockets.get(userId)!.push(socketId);

    // Join base rooms
    socket.join(`user:${userId}`);
    socket.join(`role:${role}`);

    // Role-based rooms
    if (role === 'doctor') {
      socket.join(`doctor:${userId}`);
      socket.join(`doctor-dashboard:${userId}`);
    }

    /* ---------- EVENTS ---------- */

    socket.on('join_room', (room: string) => {
      socket.join(room);
      console.log(`📝 ${userId} joined room ${room}`);
    });

    socket.on('leave_room', (room: string) => {
      socket.leave(room);
      console.log(`📝 ${userId} left room ${room}`);
    });

    socket.on('notification_read', (notificationId: string) => {
      this.io?.to(`user:${userId}`).emit('notification_updated', {
        notificationId,
        read: true,
        timestamp: new Date(),
      });
    });

    socket.on('ping', (callback?: (msg: string) => void) => {
      callback?.('pong');
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Disconnected: ${socketId}`);

      const sockets = this.userSockets.get(userId);
      if (!sockets) return;

      const index = sockets.indexOf(socketId);
      if (index !== -1) sockets.splice(index, 1);

      if (sockets.length === 0) {
        this.userSockets.delete(userId);
      }
    });
  }

  /* =======================
     EMIT HELPERS
  ======================= */

  emitToUser(userId: string, event: string, data: any): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit(event, data);
  }

  emitToUsers(userIds: string[], event: string, data: any): void {
    if (!this.io) return;
    userIds.forEach(id => this.emitToUser(id, event, data));
  }

  emitToAll(event: string, data: any): void {
    if (!this.io) return;
    this.io.emit(event, data);
  }

  emitToRole(role: string, event: string, data: any): void {
    if (!this.io) return;
    this.io.to(`role:${role}`).emit(event, data);
  }

  emitToRoom(room: string, event: string, data: any): void {
    if (!this.io) return;
    this.io.to(room).emit(event, data);
  }

  /* =======================
     APPOINTMENT EVENTS
  ======================= */

  notifyNewAppointmentToDoctor(doctorId: string, appointment: any): void {
    if (!this.io) return;

    this.io.to(`doctor:${doctorId}`).emit('appointment:new', {
      type: 'APPOINTMENT_CREATED',
      appointment,
      timestamp: new Date(),
    });

    this.io.to(`doctor-dashboard:${doctorId}`).emit(
      'dashboard:appointment-update',
      {
        type: 'NEW_APPOINTMENT',
        appointment,
        timestamp: new Date(),
      }
    );
  }

  notifyPatientAppointmentStatus(
    patientId: string,
    appointment: any,
    action: 'created' | 'updated' | 'cancelled'
  ): void {
    if (!this.io) return;

    this.io.to(`user:${patientId}`).emit('appointment:status', {
      type: `APPOINTMENT_${action.toUpperCase()}`,
      appointment,
      timestamp: new Date(),
    });
  }

  updateAppointmentRealTime(
    appointmentId: string,
    updateData: any
  ): void {
    if (!this.io) return;

    this.io.to(`appointment:${appointmentId}`).emit(
      'appointment:update',
      {
        appointmentId,
        ...updateData,
        timestamp: new Date(),
      }
    );
  }

  /* =======================
     UTILS
  ======================= */

  isUserOnline(userId: string): boolean {
    return (
      this.userSockets.has(userId) &&
      this.userSockets.get(userId)!.length > 0
    );
  }

  getOnlineUsersCount(): number {
    return this.userSockets.size;
  }

  async getOnlineDoctors(): Promise<string[]> {
    if (!this.io) return [];

    const sockets = await this.io.in('role:doctor').fetchSockets();
    return [...new Set(sockets.map(s => s.data.user._id))];
  }

  sendNotification(userId: string, notification: any): void {
    if (!this.io) return;

    this.io.to(`user:${userId}`).emit('notification:new', {
      ...notification,
      timestamp: new Date(),
    });
  }
}

export const socketService = new SocketService();
export default socketService;
