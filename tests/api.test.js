'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  startTestServer,
  request,
  createStudent,
  saveMonth,
  dateInMonth,
} = require('./helpers');

describe('Student management API', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  it('reports service health', async () => {
    const response = await request(ctx.baseUrl, '/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.database, 'ok');
  });

  it('creates, lists, updates and deletes students', async () => {
    const aarav = await createStudent(ctx.baseUrl, {
      rollNo: '23CSE001',
      name: 'Aarav Sharma',
      department: 'Computer Science',
    });
    const diya = await createStudent(ctx.baseUrl, {
      rollNo: '23CSE002',
      name: 'Diya Patel',
      department: 'Computer Science',
    });
    assert.ok(aarav.id > 0);
    assert.equal(aarav.rollNo, '23CSE001');

    const list = await request(ctx.baseUrl, '/api/students');
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);
    assert.equal(list.body.departments, 1);

    const update = await request(ctx.baseUrl, `/api/students/${aarav.id}`, {
      method: 'PUT',
      body: { rollNo: '23CSE001', name: 'Aarav S. Sharma', department: 'AI & Machine Learning' },
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.student.name, 'Aarav S. Sharma');
    assert.equal(update.body.student.department, 'AI & Machine Learning');

    const search = await request(ctx.baseUrl, '/api/students?q=Diya');
    assert.equal(search.status, 200);
    assert.equal(search.body.total, 1);
    assert.equal(search.body.students[0].name, 'Diya Patel');

    const removed = await request(ctx.baseUrl, `/api/students/${diya.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);

    const missing = await request(ctx.baseUrl, `/api/students/${diya.id}`, { method: 'DELETE' });
    assert.equal(missing.status, 404);
  });

  it('rejects invalid and duplicate student information', async () => {
    const missingFields = await request(ctx.baseUrl, '/api/students', {
      method: 'POST',
      body: { rollNo: '', name: 'X', department: '' },
    });
    assert.equal(missingFields.status, 400);

    const shortName = await request(ctx.baseUrl, '/api/students', {
      method: 'POST',
      body: { rollNo: '23CSE009', name: 'A', department: 'Computer Science' },
    });
    assert.equal(shortName.status, 400);

    const duplicate = await request(ctx.baseUrl, '/api/students', {
      method: 'POST',
      body: { rollNo: '23cse001', name: 'Duplicate Roll', department: 'Computer Science' },
    });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.error, /already exists/i);
  });
});

describe('Daily attendance API', () => {
  let ctx;
  let students;

  before(async () => {
    ctx = await startTestServer();
    students = [
      await createStudent(ctx.baseUrl, {
        rollNo: 'ATT001',
        name: 'Attendance One',
        department: 'Computer Science',
      }),
      await createStudent(ctx.baseUrl, {
        rollNo: 'ATT002',
        name: 'Attendance Two',
        department: 'Information Technology',
      }),
    ];
  });

  after(async () => {
    await ctx.close();
  });

  it('saves and retrieves attendance for all seven periods', async () => {
    const date = '2024-04-01';
    const records = [];
    for (let period = 1; period <= 7; period += 1) {
      records.push({ studentId: students[0].id, period, status: 'present' });
      records.push({
        studentId: students[1].id,
        period,
        status: period <= 3 ? 'present' : 'absent',
      });
    }

    const save = await request(ctx.baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date, records },
    });
    assert.equal(save.status, 200);
    assert.equal(save.body.saved, 14);
    assert.equal(save.body.summary.present, 10);
    assert.equal(save.body.summary.absent, 4);
    assert.equal(save.body.summary.unmarked, 0);
    assert.equal(save.body.recordCount, 14);
    assert.equal(save.body.students[0].attendance.length, 7);

    const day = await request(ctx.baseUrl, `/api/attendance?date=${date}`);
    assert.equal(day.status, 200);
    assert.equal(day.body.recordCount, 14);
    assert.equal(day.body.students.length, 2);
    assert.deepEqual(day.body.students[0].attendance, Array(7).fill('present'));
    assert.deepEqual(day.body.students[1].attendance, [
      'present',
      'present',
      'present',
      'absent',
      'absent',
      'absent',
      'absent',
    ]);
  });

  it('prevents duplicate rows while allowing corrections', async () => {
    const date = '2024-04-01';
    const records = [];
    for (let period = 1; period <= 7; period += 1) {
      records.push({ studentId: students[0].id, period, status: 'absent' });
      records.push({ studentId: students[1].id, period, status: 'present' });
    }

    const correction = await request(ctx.baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date, records },
    });
    assert.equal(correction.status, 200);
    assert.equal(correction.body.saved, 14);
    assert.equal(correction.body.recordCount, 14, 'saving twice must not create duplicate rows');
    assert.equal(correction.body.summary.present, 7);
    assert.equal(correction.body.summary.absent, 7);

    const day = await request(ctx.baseUrl, `/api/attendance?date=${date}`);
    assert.equal(day.body.recordCount, 14);
    assert.deepEqual(day.body.students[0].attendance, Array(7).fill('absent'));
    assert.deepEqual(day.body.students[1].attendance, Array(7).fill('present'));
  });

  it('validates dates, periods, statuses, students and duplicate payload entries', async () => {
    const baseRecord = { studentId: students[0].id, period: 1, status: 'present' };

    const invalidDate = await request(ctx.baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date: '2024-13-40', records: [baseRecord] },
    });
    assert.equal(invalidDate.status, 400);

    const invalidPeriod = await request(ctx.baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date: '2024-04-02', records: [{ ...baseRecord, period: 8 }] },
    });
    assert.equal(invalidPeriod.status, 400);

    const invalidStatus = await request(ctx.baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date: '2024-04-02', records: [{ ...baseRecord, status: 'late' }] },
    });
    assert.equal(invalidStatus.status, 400);

    const unknownStudent = await request(ctx.baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date: '2024-04-02', records: [{ ...baseRecord, studentId: 999999 }] },
    });
    assert.equal(unknownStudent.status, 400);

    const duplicatePayload = await request(ctx.baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date: '2024-04-02', records: [baseRecord, baseRecord] },
    });
    assert.equal(duplicatePayload.status, 400);

    const empty = await request(ctx.baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date: '2024-04-02', records: [] },
    });
    assert.equal(empty.status, 400);
  });

  it('returns daily attendance history for a month', async () => {
    const history = await request(ctx.baseUrl, '/api/attendance/history?month=2024-04');
    assert.equal(history.status, 200);
    assert.equal(history.body.workingDays, 1);
    assert.equal(history.body.workingPeriods, 14);
    assert.equal(history.body.days[0].date, '2024-04-01');
    assert.equal(history.body.days[0].present, 7);
    assert.equal(history.body.days[0].absent, 7);
  });
});

describe('Monthly reports and settings', () => {
  let ctx;
  let students;
  const month = '2024-05';

  before(async () => {
    ctx = await startTestServer();
    students = [
      await createStudent(ctx.baseUrl, {
        rollNo: 'REP001',
        name: 'Report Alpha',
        department: 'Computer Science',
      }),
      await createStudent(ctx.baseUrl, {
        rollNo: 'REP002',
        name: 'Report Beta',
        department: 'Computer Science',
      }),
      await createStudent(ctx.baseUrl, {
        rollNo: 'REP003',
        name: 'Report Gamma',
        department: 'Information Technology',
      }),
      await createStudent(ctx.baseUrl, {
        rollNo: 'REP004',
        name: 'Report Delta',
        department: 'Information Technology',
      }),
    ];

    await saveMonth(ctx.baseUrl, {
      month,
      days: 10,
      students,
      isPresent(studentIndex, day, period) {
        if (studentIndex === 0) return period <= 6; // 60/70 = 85.71%
        if (studentIndex === 1) return period <= 3; // 30/70 = 42.86%
        if (studentIndex === 2) return true; // 70/70 = 100%
        return (day - 1) * 7 + period <= 52; // 52/70 = 74.29%
      },
    });
  });

  after(async () => {
    await ctx.close();
  });

  it('calculates working days, periods, totals and percentages', async () => {
    const response = await request(ctx.baseUrl, `/api/reports/monthly?month=${month}`);
    assert.equal(response.status, 200);
    const report = response.body;
    assert.equal(report.workingDays, 10);
    assert.equal(report.workingPeriods, 70);
    assert.equal(report.totalStudents, 4);
    assert.equal(report.classAverage, 75.71);

    const alpha = report.students.find((student) => student.rollNo === 'REP001');
    assert.equal(alpha.attended, 60);
    assert.equal(alpha.absent, 10);
    assert.equal(alpha.percentage, 85.71);
    assert.equal(alpha.belowThreshold, false);

    const beta = report.students.find((student) => student.rollNo === 'REP002');
    assert.equal(beta.attended, 30);
    assert.equal(beta.absent, 40);
    assert.equal(beta.percentage, 42.86);
    assert.equal(beta.belowThreshold, true);

    const gamma = report.students.find((student) => student.rollNo === 'REP003');
    assert.equal(gamma.attended, 70);
    assert.equal(gamma.percentage, 100);

    assert.equal(report.belowThresholdCount, 2);
  });

  it('applies the configured threshold to the report', async () => {
    const update = await request(ctx.baseUrl, '/api/settings', {
      method: 'PUT',
      body: { threshold: 70 },
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.threshold, 70);

    const settings = await request(ctx.baseUrl, '/api/settings');
    assert.equal(settings.body.threshold, 70);

    const report = await request(ctx.baseUrl, `/api/reports/monthly?month=${month}`);
    assert.equal(report.body.threshold, 70);
    assert.equal(report.body.belowThresholdCount, 1, 'only Beta (42.86%) is below 70%');

    const invalid = await request(ctx.baseUrl, '/api/settings', {
      method: 'PUT',
      body: { threshold: 101 },
    });
    assert.equal(invalid.status, 400);

    await request(ctx.baseUrl, '/api/settings', {
      method: 'PUT',
      body: { threshold: 75 },
    });
  });

  it('returns a student monthly detail with all seven periods per day', async () => {
    const beta = students[1];
    const response = await request(ctx.baseUrl, `/api/reports/student/${beta.id}?month=${month}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.student.rollNo, 'REP002');
    assert.equal(response.body.summary.attended, 30);
    assert.equal(response.body.summary.absent, 40);
    assert.equal(response.body.days.length, 10);
    assert.deepEqual(response.body.days[0].periods, [
      'present',
      'present',
      'present',
      'absent',
      'absent',
      'absent',
      'absent',
    ]);
    assert.equal(response.body.days[0].present, 3);
    assert.equal(response.body.days[0].absent, 4);
  });

  it('generates a CSV export with totals and threshold flags', async () => {
    const response = await request(ctx.baseUrl, `/api/reports/monthly.csv?month=${month}&threshold=75`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/csv/);
    assert.match(response.headers.get('content-disposition'), /attendance-2024-05\.csv/);
    assert.ok(response.text.startsWith('Roll No,Name,Department'));
    assert.match(response.text, /REP001,Report Alpha,Computer Science,10,70,60,10,85\.71,NO/);
    assert.match(response.text, /REP002,Report Beta,Computer Science,10,70,30,40,42\.86,YES/);
    assert.match(response.text, /REP004,Report Delta,Information Technology,10,70,52,18,74\.29,YES/);
  });

  it('validates report month parameters', async () => {
    const invalidMonth = await request(ctx.baseUrl, '/api/reports/monthly?month=2024-13');
    assert.equal(invalidMonth.status, 400);

    const missingStudent = await request(ctx.baseUrl, `/api/reports/student/999999?month=${month}`);
    assert.equal(missingStudent.status, 404);
  });
});

describe('Persistence across application restarts', () => {
  it('keeps saved students and attendance after restarting the server', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'attendx-persist-'));
    const dbPath = path.join(directory, 'persistent.db');
    let first;
    let second;

    try {
      first = await startTestServer({ dbPath });
      const student = await createStudent(first.baseUrl, {
        rollNo: 'PERSIST001',
        name: 'Persistent Student',
        department: 'Computer Science',
      });
      const date = dateInMonth('2024-06', 3);
      const save = await request(first.baseUrl, '/api/attendance', {
        method: 'POST',
        body: {
          date,
          records: [{ studentId: student.id, period: 1, status: 'present' }],
        },
      });
      assert.equal(save.status, 200);
      await first.close();
      first = null;

      second = await startTestServer({ dbPath });
      const students = await request(second.baseUrl, '/api/students');
      assert.equal(students.body.total, 1);
      assert.equal(students.body.students[0].rollNo, 'PERSIST001');

      const attendance = await request(second.baseUrl, `/api/attendance?date=${date}`);
      assert.equal(attendance.body.recordCount, 1);
      assert.equal(attendance.body.students[0].attendance[0], 'present');
    } finally {
      if (first) await first.close();
      if (second) await second.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
