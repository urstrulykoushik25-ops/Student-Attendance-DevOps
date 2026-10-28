'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { createStudent, saveMonth } = require('./helpers');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const REMOTE_URL = process.env.SELENIUM_REMOTE_URL || '';

function uniqueDate() {
  const date = new Date(2030, 0, 1);
  date.setDate(date.getDate() + (Date.now() % 7000));
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function fetchJson(route) {
  const response = await fetch(`${BASE_URL}${route}`, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  assert.equal(response.status, 200, `GET ${route} failed: ${text}`);
  return JSON.parse(text);
}

describe('Selenium end-to-end attendance tests', () => {
  let driver;
  let students;
  const suffix = Date.now().toString(36).slice(-6).toUpperCase();
  const reportMonth = '2024-01';

  before(async () => {
    students = [
      await createStudent(BASE_URL, {
        rollNo: `E2E${suffix}01`,
        name: `Alpha ${suffix}`,
        department: 'Computer Science',
      }),
      await createStudent(BASE_URL, {
        rollNo: `E2E${suffix}02`,
        name: `Beta ${suffix}`,
        department: 'Computer Science',
      }),
      await createStudent(BASE_URL, {
        rollNo: `E2E${suffix}03`,
        name: `Gamma ${suffix}`,
        department: 'Information Technology',
      }),
      await createStudent(BASE_URL, {
        rollNo: `E2E${suffix}04`,
        name: `Delta ${suffix}`,
        department: 'Information Technology',
      }),
    ];

    await saveMonth(BASE_URL, {
      month: reportMonth,
      days: 10,
      students,
      isPresent(studentIndex, day, period) {
        if (studentIndex === 0) return period <= 6; // 60/70 = 85.71%
        if (studentIndex === 1) return period <= 3; // 30/70 = 42.86%
        if (studentIndex === 2) return true; // 100%
        return (day - 1) * 7 + period <= 52; // 74.29%
      },
    });

    const options = new chrome.Options()
      .addArguments('--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100')
      .setLoggingPrefs({ browser: 'ALL' });

    const builder = new Builder().forBrowser('chrome').setChromeOptions(options);
    if (REMOTE_URL) builder.usingServer(REMOTE_URL);
    driver = await builder.build();
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 30000, script: 30000 });
  });

  after(async () => {
    if (driver) await driver.quit();
  });

  async function goto(path) {
    await driver.get(`${BASE_URL}${path}`);
  }

  async function waitForRows(selector) {
    await driver.wait(until.elementsLocated(By.css(selector)), 20000);
    return driver.findElements(By.css(selector));
  }

  async function findRow(rollNo) {
    await driver.wait(until.elementLocated(By.css(`tr[data-roll="${rollNo}"]`)), 20000);
    return driver.findElement(By.css(`tr[data-roll="${rollNo}"]`));
  }

  async function click(element) {
    await driver.executeScript(
      'arguments[0].scrollIntoView({ block: "center", inline: "center", behavior: "instant" });',
      element
    );
    await driver.sleep(250);
    try {
      await element.click();
    } catch (error) {
      if (error.name !== 'ElementClickInterceptedError') throw error;
      await driver.executeScript('arguments[0].click();', element);
    }
  }

  it('1. displays all registered students on the attendance page', { timeout: 120000 }, async () => {
    await goto('/attendance.html?date=2024-02-15');
    const rows = await waitForRows('[data-testid="attendance-row"]');
    assert.ok(rows.length >= students.length, 'all registered students should be listed');

    const tableText = await driver.findElement(By.css('#attendanceTable')).getText();
    for (const student of students) {
      assert.ok(tableText.includes(student.name), `expected ${student.name} in the attendance table`);
      assert.ok(tableText.includes(student.rollNo), `expected ${student.rollNo} in the attendance table`);
    }
  });

  it('2. marks attendance for all seven periods and saves it', { timeout: 120000 }, async () => {
    await goto('/attendance.html?date=2024-02-15');
    await findRow(students[0].rollNo);

    for (let period = 1; period <= 7; period += 1) {
      const cell = driver.findElement(By.css(`[data-testid="cell-${students[0].id}-${period}"]`));
      const status = await cell.getAttribute('data-status');
      if (status !== 'present') await click(cell);
      assert.equal(await cell.getAttribute('data-status'), 'present');
      assert.equal((await cell.getText()).trim(), 'P');
    }

    await click(await driver.findElement(By.css('[data-testid="save-attendance"]')));
    await driver.wait(until.elementLocated(By.css('.toast.success')), 20000);

    const day = await fetchJson('/api/attendance?date=2024-02-15');
    const saved = day.students.find((student) => student.id === students[0].id);
    assert.deepEqual(saved.attendance, Array(7).fill('present'));
  });

  it('3. reloads saved attendance for the selected date', { timeout: 120000 }, async () => {
    await goto('/attendance.html?date=2024-02-15');
    await findRow(students[0].rollNo);

    for (let period = 1; period <= 7; period += 1) {
      const cell = driver.findElement(By.css(`[data-testid="cell-${students[0].id}-${period}"]`));
      assert.equal(await cell.getAttribute('data-status'), 'present');
      assert.ok((await cell.getAttribute('class')).includes('is-present'));
    }
  });

  it('4. handles missing and duplicate student information', { timeout: 120000 }, async () => {
    await goto('/students.html');
    await waitForRows('[data-testid="student-row"]');

    await driver.findElement(By.css('[data-testid="add-student"]')).click();
    const studentModal = await driver.findElement(By.css('#studentModal'));
    await driver.wait(until.elementIsVisible(studentModal), 10000);
    await driver.findElement(By.css('[data-testid="save-student"]')).click();
    const formError = await driver.findElement(By.css('#studentFormError'));
    await driver.wait(until.elementIsVisible(formError), 10000);
    assert.match(await driver.findElement(By.css('#studentFormErrorText')).getText(), /Roll number is required/i);

    await driver.findElement(By.css('#studentModal [data-close-modal]')).click();
    await driver.wait(until.elementIsNotVisible(studentModal), 10000);

    await driver.findElement(By.css('[data-testid="add-student"]')).click();
    await driver.wait(until.elementIsVisible(studentModal), 10000);
    await driver.findElement(By.css('[data-testid="student-roll"]')).sendKeys(students[0].rollNo);
    await driver.findElement(By.css('[data-testid="student-name"]')).sendKeys('Duplicate Student');
    await driver.findElement(By.css('[data-testid="student-department"]')).sendKeys('Computer Science');
    await driver.findElement(By.css('[data-testid="save-student"]')).click();
    const formErrorText = await driver.findElement(By.css('#studentFormErrorText'));
    await driver.wait(until.elementTextContains(formErrorText, 'already exists'), 10000);
    await driver.findElement(By.css('#studentModal [data-close-modal]')).click();
  });

  it('5. prevents duplicate attendance entries', { timeout: 120000 }, async () => {
    const date = uniqueDate();
    const records = [];
    for (let period = 1; period <= 7; period += 1) {
      records.push({ studentId: students[2].id, period, status: 'present' });
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${BASE_URL}/api/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, records }),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.saved, 7);
      assert.equal(body.recordCount, 7, 'a repeated save must not create duplicate rows');
    }

    const day = await fetchJson(`/api/attendance?date=${date}`);
    assert.equal(day.recordCount, 7);
  });

  it('6. calculates monthly attendance totals correctly', { timeout: 120000 }, async () => {
    await goto(`/reports.html?month=${reportMonth}`);
    const row = await findRow(students[0].rollNo);
    assert.ok((await row.getText()).includes(students[0].name));
    assert.equal((await driver.findElement(By.css(`[data-testid="attended-${students[0].rollNo}"]`)).getText()).trim(), '60');
    assert.equal((await driver.findElement(By.css(`[data-testid="absent-${students[0].rollNo}"]`)).getText()).trim(), '10');
  });

  it('7. displays the attendance percentage correctly', { timeout: 120000 }, async () => {
    const pct = await driver.findElement(By.css(`[data-testid="pct-${students[0].rollNo}"]`)).getText();
    assert.match(pct, /85\.71%/);
  });

  it('8. identifies students below the configured threshold', { timeout: 120000 }, async () => {
    const betaRow = await findRow(students[1].rollNo);
    assert.match(await betaRow.getText(), /Below threshold/i);

    await driver.findElement(By.css('#tabBelow')).click();
    await driver.sleep(400);
    const filteredRows = await driver.findElements(By.css('tr[data-testid="report-row"]'));
    const rolls = [];
    for (const row of filteredRows) rolls.push(await row.getAttribute('data-roll'));
    assert.ok(rolls.includes(students[1].rollNo), 'Beta should remain visible in the below-threshold filter');
    assert.ok(!rolls.includes(students[0].rollNo), 'Alpha should be filtered out');

    await driver.findElement(By.css('#tabAll')).click();
  });

  it('9. generates the monthly report and exports CSV', { timeout: 120000 }, async () => {
    assert.ok(await driver.findElement(By.css('[data-testid="report-table"]')));
    assert.ok(await driver.findElement(By.css('[data-testid="export-csv"]')));

    const response = await fetch(`${BASE_URL}/api/reports/monthly.csv?month=${reportMonth}&threshold=75`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/csv/);
    const csv = await response.text();
    assert.ok(csv.includes('Roll No,Name,Department'));
    assert.ok(csv.includes(students[1].rollNo));
    assert.ok(csv.includes('42.86'));
    assert.ok(csv.includes('YES'));
  });
});
