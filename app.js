// console.log("process id called "+ process.pid)
import 'dotenv/config'
import express from 'express';
import cors from 'cors';
import path from 'path';
import cookieParser from 'cookie-parser';
import http from 'http';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { setupWebSocket } from './helpers/V1/websocket.js';
import { startDemoReminderScheduler } from './services/demoReminderScheduler.js';
import { startRecurringInvoiceScheduler } from './services/recurringInvoiceService.js';
const { consumerSendMailLog ,consumerExcelToExport  } = await import(`./rabbitmq/consumer.js`);

const Website_ver = process.env.WEBSITE_VERSION;

if (!Website_ver) throw new Error("CODE_VERSION missing in .env");

import CRMRoutes from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 6004;
// const FRONTEND_SERVER_IPS = [
//   '57.159.24.228',  // production frontend
//   '20.197.6.60'  // staging frontend
// ];

// CORS config
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware
app.use(express.json({ limit: '50mb' }));
// Increase payload size limits for large imports (CSV/JSON payloads).
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1000, // 1 second window
  max: 50,        // 20 requests per second

  skip: (req) => {
    const body = req.body || {};
    const query = req.query || {};

    const isPagination =
      body.page !== undefined ||
      body.limit !== undefined ||
      body.offset !== undefined ||
      query.page !== undefined ||
      query.limit !== undefined ||
      query.offset !== undefined;

    // Skip ONLY if pagination + request from frontend server IP
    // return isPagination && FRONTEND_SERVER_IPS.includes(req.ip);
    return isPagination;
  },

  message: {
    status: 429,
    error: 'Too many requests, please try again later.'
  },

  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

app.get('/', (req, res) => {
  res.send('GET request to homepage');
});

// start the consumer once 
// for send mail log
// setTimeout(async () => {
  // for send mail log
consumerSendMailLog("send_email_log_queue", "notifications_exchange", "email_log_notification");
// send mail instant log
consumerSendMailLog("send_email_instant_log_queue", "notifications_exchange", "email_instant_log_notification");
// send mail excel to export
consumerExcelToExport("send_email_excel_export_queue", "notifications_exchange", "excel_export_notification");
// }, 2000);

app.use("/crm", CRMRoutes);

// WebSocket + HTTP server
const server = http.createServer(app);
setupWebSocket(server);

// Runs in-process so it shares the live WebSocket connection map above —
// see services/demoReminderScheduler.js for why this can't be a standalone
// cron script like the ones in cron/.
startDemoReminderScheduler();

// Doesn't need the WS map, but kept in-process for simplicity — no separate
// cron infra to set up locally, and generation is idempotent/cheap to poll.
startRecurringInvoiceScheduler();

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server (HTTP + WS) running on port ${PORT}`);
  console.log(`API running on http://localhost:${PORT}`);
});
