'use strict';

const { transaction } = require('../db');
const { ApiError } = require('../lib/validation');

const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const STATUSES = new Set(['present', 'absent']);

function getDayAttendance(db, date) {
  const students = db
    .prepare(
      `SELECT id, roll_no AS rollNo, name, department
         FROM students
        ORDER BY roll_no COLLATE NOCASE`
    )
    .all();

  const records = db
    .prepare(
      `SELECT student_id AS studentId, period, status
         FROM attendance
        WHERE attendance_date = ?`
    )
    .all(date);

  const recordMap = new Map();
  for (const record of records) {
    recordMap.set(`${record.studentId}:${record.period}`, record.status);
  }

  let present = 0;
  let absent = 0;
  let markedStudents = 0;
  let completeStudents = 0;

  const studentRows = students.map((student) => {
    const attendance = PERIODS.map((period) => recordMap.get(`${student.id}:${period}`) || null);
    const marked = attendance.filter(Boolean);
    if (marked.length > 0) markedStudents += 1;
    if (marked.length === PERIODS.length) completeStudents += 1;
    present += marked.filter((status) => status === 'present').length;
    absent += marked.filter((status) => status === 'absent').length;
    return { ...student, attendance };
  });

  const totalCells = students.length * PERIODS.length;

  return {
    date,
    periods: PERIODS,
    students: studentRows,
    summary: {
      present,
      absent,
      unmarked: Math.max(totalCells - present - absent, 0),
      totalStudents: students.length,
      markedStudents,
      completeStudents,
    },
    recordCount: records.length,
  };
}

function validateRecords(db, records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new ApiError(400, 'At least one attendance record is required.');
  }
  if (records.length > 5000) {
    throw new ApiError(400, 'Too many attendance records in one request (maximum 5000).');
  }

  const seen = new Set();
  const studentIds = new Set();
  const normalized = records.map((record, index) => {
    if (!record || typeof record !== 'object') {
      throw new ApiError(400, `Record ${index + 1} is invalid.`);
    }

    const studentId = Number(record.studentId);
    const period = Number(record.period);
    const status = record.status;

    if (!Number.isInteger(studentId) || studentId < 1) {
      throw new ApiError(400, `Record ${index + 1} has an invalid studentId.`);
    }
    if (!PERIODS.includes(period)) {
      throw new ApiError(400, `Record ${index + 1} has an invalid period. Periods must be 1 to 7.`);
    }
    if (!STATUSES.has(status)) {
      throw new ApiError(400, `Record ${index + 1} has an invalid status. Use "present" or "absent".`);
    }

    const key = `${studentId}:${period}`;
    if (seen.has(key)) {
      throw new ApiError(
        400,
        `Duplicate attendance entry in request for student ${studentId}, period ${period}.`
      );
    }
    seen.add(key);
    studentIds.add(studentId);

    return { studentId, period, status };
  });

  const ids = [...studentIds];
  const placeholders = ids.map(() => '?').join(', ');
  const found = db
    .prepare(`SELECT id FROM students WHERE id IN (${placeholders})`)
    .all(...ids);
  const foundIds = new Set(found.map((row) => row.id));
  const missing = ids.filter((id) => !foundIds.has(id));

  if (missing.length > 0) {
    throw new ApiError(400, `Unknown student id(s): ${missing.join(', ')}.`);
  }

  return normalized;
}

function saveDayAttendance(db, date, records) {
  const normalized = validateRecords(db, records);

  const upsert = db.prepare(
    `INSERT INTO attendance (student_id, attendance_date, period, status)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (student_id, attendance_date, period)
     DO UPDATE SET status = excluded.status,
                   updated_at = datetime('now')`
  );

  transaction(db, () => {
    for (const record of normalized) {
      upsert.run(record.studentId, date, record.period, record.status);
    }
  });

  const day = getDayAttendance(db, date);
  return {
    saved: normalized.length,
    ...day,
  };
}

module.exports = { PERIODS, getDayAttendance, saveDayAttendance };
