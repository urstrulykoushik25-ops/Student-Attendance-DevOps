'use strict';

const path = require('node:path');
const express = require('express');
const { ApiError } = require('./lib/validation');

const studentsRouter = require('./routes/students');
const attendanceRouter = require('./routes/attendance');
const reportsRouter = require('./routes/reports');
const settingsRouter = require('./routes/settings');
const dashboardRouter = require('./routes/dashboard');

/**
 * Builds the Express application. The database is injected so tests can use
 * an isolated temporary database instead of the production file.
 * @param {{ db: import('node:sqlite').DatabaseSync }} options
 */
function createApp({ db }) {
  if (!db) throw new Error('createApp requires a database instance.');

  const app = express();
  const publicDir = path.join(__dirname, '..', 'public');

  app.locals.db = db;
  app.disable('x-powered-by');

  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  app.get('/api/health', (req, res) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      res.json({
        status: 'ok',
        service: 'student-attendance',
        database: 'ok',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });

  app.use('/api/students', studentsRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/dashboard', dashboardRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  app.use(
    express.static(publicDir, {
      extensions: ['html'],
      index: 'index.html',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    })
  );

  app.use((req, res) => {
    if (req.accepts('html')) {
      res.status(404).sendFile(path.join(publicDir, '404.html'));
    } else {
      res.status(404).json({ error: 'Not found.' });
    }
  });

  // Express identifies error handlers by their four-argument signature.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error instanceof ApiError ? error.status : error.status || 500;
    if (status >= 500) {
      console.error('[server] Unhandled error:', error);
    }
    if (res.headersSent) {
      return next(error);
    }
    const payload = {
      error: status >= 500 ? 'Internal server error.' : error.message,
    };
    if (error.details) payload.details = error.details;
    res.status(status).json(payload);
  });

  return app;
}

module.exports = { createApp };
