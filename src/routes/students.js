'use strict';

const express = require('express');
const { ApiError, cleanString, parseId } = require('../lib/validation');

const router = express.Router();

function mapStudent(row) {
  return {
    id: row.id,
    rollNo: row.rollNo,
    name: row.name,
    department: row.department,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  let rows;

  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT id, roll_no AS rollNo, name, department,
                created_at AS createdAt, updated_at AS updatedAt
           FROM students
          WHERE name LIKE ? OR roll_no LIKE ? OR department LIKE ?
          ORDER BY roll_no COLLATE NOCASE`
      )
      .all(like, like, like);
  } else {
    rows = db
      .prepare(
        `SELECT id, roll_no AS rollNo, name, department,
                created_at AS createdAt, updated_at AS updatedAt
           FROM students
          ORDER BY roll_no COLLATE NOCASE`
      )
      .all();
  }

  const departments = db
    .prepare('SELECT COUNT(DISTINCT department) AS count FROM students')
    .get();

  res.json({
    students: rows.map(mapStudent),
    total: rows.length,
    departments: Number(departments.count || 0),
  });
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const body = req.body || {};
  const rollNo = cleanString(body.rollNo, 'Roll number', { max: 30 });
  const name = cleanString(body.name, 'Student name', { min: 2, max: 100 });
  const department = cleanString(body.department, 'Department', { min: 2, max: 80 });

  const existing = db
    .prepare('SELECT id FROM students WHERE roll_no = ? COLLATE NOCASE')
    .get(rollNo);
  if (existing) {
    throw new ApiError(409, `A student with roll number "${rollNo}" already exists.`);
  }

  const result = db
    .prepare('INSERT INTO students (roll_no, name, department) VALUES (?, ?, ?)')
    .run(rollNo, name, department);

  const student = db
    .prepare(
      `SELECT id, roll_no AS rollNo, name, department,
              created_at AS createdAt, updated_at AS updatedAt
         FROM students WHERE id = ?`
    )
    .get(result.lastInsertRowid);

  res.status(201).json({ student: mapStudent(student) });
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = parseId(req.params.id);
  const body = req.body || {};
  const rollNo = cleanString(body.rollNo, 'Roll number', { max: 30 });
  const name = cleanString(body.name, 'Student name', { min: 2, max: 100 });
  const department = cleanString(body.department, 'Department', { min: 2, max: 80 });

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
  if (!student) {
    throw new ApiError(404, 'Student not found.');
  }

  const duplicate = db
    .prepare('SELECT id FROM students WHERE roll_no = ? COLLATE NOCASE AND id <> ?')
    .get(rollNo, id);
  if (duplicate) {
    throw new ApiError(409, `A student with roll number "${rollNo}" already exists.`);
  }

  db.prepare(
    `UPDATE students
        SET roll_no = ?, name = ?, department = ?, updated_at = datetime('now')
      WHERE id = ?`
  ).run(rollNo, name, department, id);

  const updated = db
    .prepare(
      `SELECT id, roll_no AS rollNo, name, department,
              created_at AS createdAt, updated_at AS updatedAt
         FROM students WHERE id = ?`
    )
    .get(id);

  res.json({ student: mapStudent(updated) });
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = parseId(req.params.id);
  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
  if (!student) {
    throw new ApiError(404, 'Student not found.');
  }

  db.prepare('DELETE FROM students WHERE id = ?').run(id);
  res.status(204).end();
});

module.exports = router;
