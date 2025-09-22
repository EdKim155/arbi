import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { MonitoringService } from '../monitoring/monitoring.service.js';
import { PricePoint } from '@arbi/shared';

interface ClientContext {
  socket: WebSocket;
  userId: string;
  subscriptions: Set<string>;
}

interface WebSocketOptions {
  jwtSecret: string;
  monitoring: MonitoringService;
}

const send = (socket: WebSocket, payload: any) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

export const createRealtimeServer = (server: HttpServer, options: WebSocketOptions) => {
  const { monitoring, jwtSecret } = options;

  const wss = new WebSocketServer({ server, path: '/ws' });

  const clients = new Map<WebSocket, ClientContext>();
  const monitorToClients = new Map<string, Set<WebSocket>>();

  const addMonitorSubscription = (monitorId: string, socket: WebSocket) => {
    const sockets = monitorToClients.get(monitorId) ?? new Set<WebSocket>();
    sockets.add(socket);
    monitorToClients.set(monitorId, sockets);
  };

  const removeMonitorSubscription = (monitorId: string, socket: WebSocket) => {
    const sockets = monitorToClients.get(monitorId);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      monitorToClients.delete(monitorId);
    }
  };

  const broadcastPrice = (monitorId: string, price: PricePoint) => {
    const sockets = monitorToClients.get(monitorId);
    if (!sockets) {
      return;
    }
    sockets.forEach((socket) => {
      send(socket, { type: 'price', monitorId, price });
    });
  };

  const broadcastAlert = (monitorId: string, payload: { conditionId: string; price: PricePoint }) => {
    const sockets = monitorToClients.get(monitorId);
    if (!sockets) {
      return;
    }
    sockets.forEach((socket) => {
      send(socket, { type: 'alert', monitorId, ...payload });
    });
  };

  monitoring.onPrice(({ monitor, price }) => {
    broadcastPrice(monitor.id, price);
  });

  monitoring.onAlert(({ monitor, condition, price }) => {
    broadcastAlert(monitor.id, { conditionId: condition.id, price });
  });

  wss.on('connection', async (socket, request) => {
    try {
      if (!request.url) {
        socket.close(1008, 'Missing url');
        return;
      }
      const requestUrl = new URL(request.url, 'http://localhost');
      const token = requestUrl.searchParams.get('token');
      if (!token) {
        socket.close(1008, 'Missing token');
        return;
      }
      const payload = jwt.verify(token, jwtSecret) as { sub: string };
      const userId = payload.sub;
      if (!userId) {
        socket.close(1008, 'Invalid token');
        return;
      }
      const context: ClientContext = { socket, userId, subscriptions: new Set() };
      clients.set(socket, context);
      send(socket, { type: 'ready' });

      socket.on('message', async (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.type === 'subscribe') {
            const monitor = await monitoring.getMonitor(message.monitorId);
            if (!monitor || monitor.userId !== userId) {
              send(socket, { type: 'error', message: 'Monitor not found' });
              return;
            }
            context.subscriptions.add(monitor.id);
            addMonitorSubscription(monitor.id, socket);
            send(socket, { type: 'subscribed', monitorId: monitor.id });
          } else if (message.type === 'unsubscribe') {
            const monitorId = message.monitorId as string;
            context.subscriptions.delete(monitorId);
            removeMonitorSubscription(monitorId, socket);
            send(socket, { type: 'unsubscribed', monitorId });
          } else if (message.type === 'ping') {
            send(socket, { type: 'pong' });
          } else {
            send(socket, { type: 'error', message: 'Unknown message type' });
          }
        } catch (err: any) {
          send(socket, { type: 'error', message: err.message ?? 'Invalid payload' });
        }
      });

      socket.on('close', () => {
        context.subscriptions.forEach((monitorId) => removeMonitorSubscription(monitorId, socket));
        clients.delete(socket);
      });
    } catch (err) {
      socket.close(1011, 'Internal error');
    }
  });

  return wss;
};
