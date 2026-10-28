'use strict';

const path = require('node:path');
const { createDatabase, DEFAULT_DB_PATH } = require('./db');
const { createApp } = require('./app');
const { seedDemoData } = require('./seed');

const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
const port = Number(process.env.PORT || 3000);

const db = createDatabase(dbPath);

if (String(process.env.SEED_DEMO).toLowerCase() === 'true') {
  const result = seedDemoData(db);
  if (result.seeded) {
    console.log(`[seed] Added ${result.students} demo students and ${result.records} attendance records.`);
  }
}

const app = createApp({ db });
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[server] Student Attendance Management System listening on http://localhost:${port}`);
  console.log(`[server] Database: ${path.resolve(dbPath)}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      // Ignore close errors during shutdown.
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
