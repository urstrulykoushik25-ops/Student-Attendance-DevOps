'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

/**
 * Starts an isolated application instance backed by a temporary SQLite file.
 */
async function startTestServer(options = {}) {
  const directory = options.dbPath ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'attendx-test-'));
  const dbPath = options.dbPath || path.join(directory, 'test.db');
  const db = createDatabase(dbPath);
  const app = createApp({ db });
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    db,
    server,
    baseUrl,
    dbPath,
    directory,
    async close() {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      try {
        db.close();
      } catch {
        // Already closed.
      }
      if (directory) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

async function request(baseUrl, route, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, headers: response.headers, body, text };
}

async function createStudent(baseUrl, student) {
  const response = await request(baseUrl, '/api/students', {
    method: 'POST',
    body: student,
  });
  if (response.status !== 201) {
    throw new Error(`Failed to create student: ${JSON.stringify(response.body)}`);
  }
  return response.body.student;
}

function dateInMonth(month, day) {
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * Saves attendance for a set of students over a number of days.
 * `isPresent(studentIndex, day, period)` decides each period's status.
 */
async function saveMonth(baseUrl, { month, days, students, isPresent }) {
  const records = [];
  for (let day = 1; day <= days; day += 1) {
    const date = dateInMonth(month, day);
    students.forEach((student, studentIndex) => {
      for (let period = 1; period <= 7; period += 1) {
        records.push({
          studentId: student.id,
          period,
          status: isPresent(studentIndex, day, period) ? 'present' : 'absent',
        });
      }
    });
    const response = await request(baseUrl, '/api/attendance', {
      method: 'POST',
      body: { date, records: records.splice(0) },
    });
    if (response.status !== 200) {
      throw new Error(`Failed to save attendance for ${date}: ${JSON.stringify(response.body)}`);
    }
  }
}

module.exports = {
  startTestServer,
  request,
  createStudent,
  dateInMonth,
  saveMonth,
};
