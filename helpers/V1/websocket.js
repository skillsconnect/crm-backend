import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import db from '../../config/knex.js';

const wsClients = new Map(); // WebSocket => userId (string)

const KEY_SECRET = process.env.SECRET_KEY;

// Resolve a verified user id from the connection's ?token= (the same access JWT
// the REST API uses). Returns null if the token is missing / invalid / revoked
// / expired — the connection is then rejected. The old ?userId= query param is
// no longer trusted.
async function resolveUserId(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token) return null;

    const payload = jwt.verify(token, KEY_SECRET);
    if (!payload?.id) return null;

    // Mirror middlewares/Authenticate.js — token must still be live in the DB.
    const rows = await db('ups_user_token')
      .where('token', token)
      .whereNull('revoked_at')
      .andWhere('expires_at', '>', db.fn.now())
      .limit(1);
    if (!rows || rows.length === 0) return null;

    return String(payload.id);
  } catch {
    return null;
  }
}

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const userId = await resolveUserId(req);

    if (!userId) {
      try { ws.close(1008, 'unauthorized'); } catch { /* already closed */ }
      console.warn('WebSocket connection rejected (invalid/missing token)');
      return;
    }

    wsClients.set(ws, userId);
    console.log(`WebSocket connected for user: ${userId}`);

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`WebSocket disconnected: ${userId}`);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error for ${userId}:`, err);
    });
  });

  return wss;
}

function sendMessageToWSClient(userId, eventData) {
  const target = String(userId);
  let delivered = false;
  for (const [client, id] of wsClients.entries()) {
    if (id === target && client.readyState === 1) {
      client.send(JSON.stringify(eventData));
      delivered = true;
    }
  }
  if (!delivered) console.warn(`WS client ${target} not connected — event not pushed live`);
  return delivered;
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
