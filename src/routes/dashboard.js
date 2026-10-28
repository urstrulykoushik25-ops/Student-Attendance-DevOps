'use strict';

const express = require('express');
const { assertDate, assertMonth, localDateISO } = require('../lib/validation');
const { getDayAttendance } = require('../services/attendance');
const { getMonthlyReport, getAttendanceHistory } = require('../services/reports');

const router = express.Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const date = assertDate(req.query.date || localDateISO());
  const month = assertMonth(req.query.month || date.slice(0, 7));
  const report = getMonthlyReport(db, month, req.query.threshold);
  const day = getDayAttendance(db, date);
  const history = getAttendanceHistory(db, month);

  const periodRows = db
    .prepare(
      `SELECT period,
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent
         FROM attendance
        WHERE attendance_date = ?
        GROUP BY period
        ORDER BY period`
    )
    .all(date);

  const periodMap = new Map(periodRows.map((row) => [Number(row.period), row]));
  const periods = [];
  for (let period = 1; period <= 7; period += 1) {
    const row = periodMap.get(period);
    const present = Number(row?.present || 0);
    const absent = Number(row?.absent || 0);
    periods.push({
      period,
      present,
      absent,
      unmarked: Math.max(day.summary.totalStudents - present - absent, 0),
    });
  }

  const marked = day.summary.present + day.summary.absent;
  const percentage = marked > 0 ? Math.round((day.summary.present / marked) * 10000) / 100 : 0;

  const lowAttendance = report.students
    .filter((student) => student.belowThreshold)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 6);

  res.json({
    date,
    month,
    threshold: report.threshold,
    totalStudents: day.summary.totalStudents,
    today: {
      ...day.summary,
      percentage,
      hasRecords: day.recordCount > 0,
      periods,
    },
    monthSummary: {
      workingDays: report.workingDays,
      workingPeriods: report.workingPeriods,
      classAverage: report.classAverage,
      belowThresholdCount: report.belowThresholdCount,
      totalStudents: report.totalStudents,
    },
    lowAttendance,
    recentDays: history.days.slice(0, 6),
  });
});

module.exports = router;
