import { WebSocketServer } from 'ws';

const wsClients = new Map(); // userId => WebSocket

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId') || null;

    wsClients.set(ws, userId);
    console.log(`WebSocket connected${userId ? ` for user: ${userId}` : ''}`);

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`WebSocket disconnected${userId ? `: ${userId}` : ''}`);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error${userId ? ` for ${userId}` : ''}:`, err);
    });
  });

  return wss;
}

function sendMessageToWSClient(userId, eventData) {
  for (const [client, id] of wsClients.entries()) {
    if (id === userId && client.readyState === 1) {
      client.send(JSON.stringify(eventData));
      console.log(`Message sent to WebSocket client: ${userId}`);
      return;
    }
  }
  console.warn(`Client ${userId} not connected or socket closed`);
}

function broadcastMessage(eventData) {
  for (const [client, userId] of wsClients.entries()) {
    if (client.readyState === 1) {
      client.send(JSON.stringify(eventData));
      console.log(`Broadcast to: ${userId}`);
    }
  }
}

export { setupWebSocket, sendMessageToWSClient, broadcastMessage };
