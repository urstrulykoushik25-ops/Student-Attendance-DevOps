'use strict';

const express = require('express');
const { ApiError, parseThreshold } = require('../lib/validation');

const router = express.Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'threshold'").get();
  res.json({ threshold: row ? Number(row.value) : 75 });
});

router.put('/', (req, res) => {
  const db = req.app.locals.db;
  const body = req.body || {};
  if (body.threshold === undefined || body.threshold === null || body.threshold === '') {
    throw new ApiError(400, 'Threshold is required.');
  }
  const threshold = parseThreshold(body.threshold);

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('threshold', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(String(threshold));

  res.json({ threshold });
});

module.exports = router;
