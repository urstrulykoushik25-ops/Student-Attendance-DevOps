'use strict';

const express = require('express');
const { assertDate, assertMonth, localDateISO } = require('../lib/validation');
const { getDayAttendance, saveDayAttendance } = require('../services/attendance');
const { getAttendanceHistory } = require('../services/reports');

const router = express.Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const date = req.query.date || localDateISO();
  assertDate(date);
  res.json(getDayAttendance(db, date));
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const body = req.body || {};
  const date = assertDate(body.date);
  const result = saveDayAttendance(db, date, body.records);
  res.json(result);
});

router.get('/history', (req, res) => {
  const db = req.app.locals.db;
  const month = req.query.month || localDateISO().slice(0, 7);
  assertMonth(month);
  res.json(getAttendanceHistory(db, month));
});

module.exports = router;
