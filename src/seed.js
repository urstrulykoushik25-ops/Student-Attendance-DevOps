'use strict';

const { createDatabase, transaction, DEFAULT_DB_PATH } = require('./db');
const { localDateISO } = require('./lib/validation');

const DEMO_STUDENTS = [
  { rollNo: '23CSE001', name: 'Aarav Sharma', department: 'Computer Science' },
  { rollNo: '23CSE002', name: 'Ananya Verma', department: 'Computer Science' },
  { rollNo: '23CSE003', name: 'Rohan Mehta', department: 'Computer Science' },
  { rollNo: '23CSE004', name: 'Diya Patel', department: 'Computer Science' },
  { rollNo: '23AIML001', name: 'Kabir Nair', department: 'AI & Machine Learning' },
  { rollNo: '23AIML002', name: 'Ishita Rao', department: 'AI & Machine Learning' },
  { rollNo: '23AIML003', name: 'Vivaan Gupta', department: 'AI & Machine Learning' },
  { rollNo: '23IT001', name: 'Meera Iyer', department: 'Information Technology' },
  { rollNo: '23IT002', name: 'Arjun Singh', department: 'Information Technology' },
  { rollNo: '23IT003', name: 'Saanvi Joshi', department: 'Information Technology' },
  { rollNo: '23ECE001', name: 'Aditya Kulkarni', department: 'Electronics & Communication' },
  { rollNo: '23ECE002', name: 'Nisha Reddy', department: 'Electronics & Communication' },
];

// Deterministic attendance probabilities keep the demo data stable across runs.
const ATTENDANCE_PROBABILITY = [95, 93, 91, 89, 86, 84, 81, 78, 75, 68, 61, 54];

function recentWeekdays(count = 15, endDate = new Date()) {
  const dates = [];
  const cursor = new Date(endDate);
  cursor.setHours(12, 0, 0, 0);
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      dates.unshift(localDateISO(cursor));
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

function seedDemoData(db, { force = false } = {}) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM students').get();
  if (Number(existing.count) > 0 && !force) {
    return { seeded: false, students: Number(existing.count), records: 0 };
  }

  return transaction(db, () => {
    if (force) {
      db.exec('DELETE FROM attendance;');
      db.exec('DELETE FROM students;');
    }

    const insertStudent = db.prepare(
      'INSERT INTO students (roll_no, name, department) VALUES (?, ?, ?)'
    );
    const ids = [];
    for (const student of DEMO_STUDENTS) {
      const result = insertStudent.run(student.rollNo, student.name, student.department);
      ids.push(Number(result.lastInsertRowid));
    }

    const dates = recentWeekdays(15);
    const insertAttendance = db.prepare(
      `INSERT OR IGNORE INTO attendance (student_id, attendance_date, period, status)
       VALUES (?, ?, ?, ?)`
    );

    let records = 0;
    dates.forEach((date, dateIndex) => {
      ids.forEach((studentId, studentIndex) => {
        const probability = ATTENDANCE_PROBABILITY[studentIndex % ATTENDANCE_PROBABILITY.length];
        for (let period = 1; period <= 7; period += 1) {
          const hash = (dateIndex * 37 + studentIndex * 53 + period * 17) % 100;
          const status = hash < probability ? 'present' : 'absent';
          insertAttendance.run(studentId, date, period, status);
          records += 1;
        }
      });
    });

    return { seeded: true, students: ids.length, records, dates };
  });
}

if (require.main === module) {
  const db = createDatabase(process.env.DB_PATH || DEFAULT_DB_PATH);
  const force = process.argv.includes('--force');
  const result = seedDemoData(db, { force });
  if (result.seeded) {
    console.log(
      `Seeded ${result.students} students and ${result.records} attendance records for ${result.dates[0]} to ${result.dates[result.dates.length - 1]}.`
    );
  } else {
    console.log(`Database already contains ${result.students} students. Use --force to reseed.`);
  }
  db.close();
}

module.exports = { seedDemoData, DEMO_STUDENTS };
