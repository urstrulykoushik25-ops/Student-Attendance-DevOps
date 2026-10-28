'use strict';

const { ApiError, parseThreshold, round2 } = require('../lib/validation');

function getThresholdValue(db, override) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'threshold'").get();
  const stored = row ? Number(row.value) : 75;
  return parseThreshold(override, stored);
}

/**
 * Calculates a class-wide monthly attendance report.
 *
 * Working periods are the distinct (date, period) pairs for which any
 * attendance was recorded during the month. A student's absence count is the
 * number of working periods they did not attend, so an unmarked period counts
 * as absent in the final percentage. `recordedAbsent` is also returned so the
 * explicit absences can be audited separately.
 */
function getMonthlyReport(db, month, thresholdOverride) {
  const threshold = getThresholdValue(db, thresholdOverride);
  const like = `${month}-%`;

  const working = db
    .prepare(
      `SELECT COUNT(*) AS workingPeriods,
              COUNT(DISTINCT attendance_date) AS workingDays
         FROM (SELECT DISTINCT attendance_date, period
                 FROM attendance
                WHERE attendance_date LIKE ?)`
    )
    .get(like);

  const workingPeriods = Number(working.workingPeriods || 0);
  const workingDays = Number(working.workingDays || 0);

  const rows = db
    .prepare(
      `SELECT s.id,
              s.roll_no AS rollNo,
              s.name,
              s.department,
              COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END), 0) AS attended,
              COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END), 0) AS recordedAbsent
         FROM students s
         LEFT JOIN attendance a
           ON a.student_id = s.id
          AND a.attendance_date LIKE ?
        GROUP BY s.id, s.roll_no, s.name, s.department
        ORDER BY s.roll_no COLLATE NOCASE`
    )
    .all(like);

  let totalAttended = 0;
  const students = rows.map((row) => {
    const attended = Number(row.attended);
    const recordedAbsent = Number(row.recordedAbsent);
    const absent = Math.max(workingPeriods - attended, 0);
    const percentage = workingPeriods > 0 ? round2((attended / workingPeriods) * 100) : 0;
    totalAttended += attended;

    return {
      id: row.id,
      rollNo: row.rollNo,
      name: row.name,
      department: row.department,
      attended,
      absent,
      recordedAbsent,
      workingPeriods,
      percentage,
      belowThreshold: percentage < threshold,
    };
  });

  const possiblePeriods = students.length * workingPeriods;
  const classAverage = possiblePeriods > 0 ? round2((totalAttended / possiblePeriods) * 100) : 0;
  const belowThresholdCount = students.filter((student) => student.belowThreshold).length;

  return {
    month,
    threshold,
    workingDays,
    workingPeriods,
    totalStudents: students.length,
    classAverage,
    belowThresholdCount,
    students,
    generatedAt: new Date().toISOString(),
  };
}

function getStudentMonthlyDetail(db, studentId, month, thresholdOverride) {
  const student = db
    .prepare('SELECT id, roll_no AS rollNo, name, department FROM students WHERE id = ?')
    .get(studentId);

  if (!student) {
    throw new ApiError(404, 'Student not found.');
  }

  const report = getMonthlyReport(db, month, thresholdOverride);
  const summary = report.students.find((row) => row.id === student.id) || null;
  const like = `${month}-%`;

  const dates = db
    .prepare(
      `SELECT DISTINCT attendance_date AS date
         FROM attendance
        WHERE attendance_date LIKE ?
        ORDER BY attendance_date`
    )
    .all(like);

  const records = db
    .prepare(
      `SELECT attendance_date AS date, period, status
         FROM attendance
        WHERE student_id = ?
          AND attendance_date LIKE ?`
    )
    .all(student.id, like);

  const byDate = new Map();
  for (const record of records) {
    if (!byDate.has(record.date)) byDate.set(record.date, new Map());
    byDate.get(record.date).set(Number(record.period), record.status);
  }

  const days = dates.map(({ date }) => {
    const dayRecords = byDate.get(date) || new Map();
    const periods = [];
    for (let period = 1; period <= 7; period += 1) {
      periods.push(dayRecords.get(period) || null);
    }
    const present = periods.filter((status) => status === 'present').length;
    const absent = periods.filter((status) => status === 'absent').length;
    return { date, periods, present, absent, unmarked: 7 - present - absent };
  });

  return {
    month,
    threshold: report.threshold,
    student,
    summary,
    workingDays: report.workingDays,
    workingPeriods: report.workingPeriods,
    days,
  };
}

function getAttendanceHistory(db, month) {
  const like = `${month}-%`;
  const days = db
    .prepare(
      `SELECT attendance_date AS date,
              COUNT(*) AS records,
              COUNT(DISTINCT student_id) AS students,
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent
         FROM attendance
        WHERE attendance_date LIKE ?
        GROUP BY attendance_date
        ORDER BY attendance_date DESC`
    )
    .all(like)
    .map((day) => {
      const present = Number(day.present || 0);
      const absent = Number(day.absent || 0);
      const total = present + absent;
      return {
        date: day.date,
        records: Number(day.records),
        students: Number(day.students),
        present,
        absent,
        percentage: total > 0 ? round2((present / total) * 100) : 0,
      };
    });

  return {
    month,
    days,
    workingDays: days.length,
    workingPeriods: days.reduce((total, day) => total + day.records, 0),
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildMonthlyCsv(report) {
  const header = [
    'Roll No',
    'Name',
    'Department',
    'Working Days',
    'Working Periods',
    'Attended',
    'Absent',
    'Attendance %',
    'Below Threshold',
  ];

  const lines = [header.join(',')];
  for (const student of report.students) {
    lines.push(
      [
        student.rollNo,
        student.name,
        student.department,
        report.workingDays,
        report.workingPeriods,
        student.attended,
        student.absent,
        student.percentage.toFixed(2),
        student.belowThreshold ? 'YES' : 'NO',
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

module.exports = {
  getThresholdValue,
  getMonthlyReport,
  getStudentMonthlyDetail,
  getAttendanceHistory,
  buildMonthlyCsv,
};
