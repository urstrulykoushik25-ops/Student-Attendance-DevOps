'use strict';

const express = require('express');
const { assertMonth, parseId, localDateISO } = require('../lib/validation');
const {
  getMonthlyReport,
  getStudentMonthlyDetail,
  buildMonthlyCsv,
} = require('../services/reports');

const router = express.Router();

router.get('/monthly', (req, res) => {
  const db = req.app.locals.db;
  const month = assertMonth(req.query.month || localDateISO().slice(0, 7));
  const report = getMonthlyReport(db, month, req.query.threshold);
  res.json(report);
});

router.get('/monthly.csv', (req, res) => {
  const db = req.app.locals.db;
  const month = assertMonth(req.query.month || localDateISO().slice(0, 7));
  const report = getMonthlyReport(db, month, req.query.threshold);
  const csv = buildMonthlyCsv(report);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="attendance-${month}.csv"`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});

router.get('/student/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = parseId(req.params.id);
  const month = assertMonth(req.query.month || localDateISO().slice(0, 7));
  const detail = getStudentMonthlyDetail(db, id, month, req.query.threshold);
  res.json(detail);
});

module.exports = router;
