import http from 'http';
import { createApplication } from './app.js';
import { createRealtimeServer } from './realtime/websocket.js';

const context = createApplication();

const server = http.createServer(context.app);

createRealtimeServer(server, {
  jwtSecret: context.config.jwtSecret,
  monitoring: context.monitoringService,
});

server.listen(context.config.port, () => {
  console.log(`Backend server listening on port ${context.config.port}`);
});
