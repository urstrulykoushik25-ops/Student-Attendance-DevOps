'use strict';

(() => {
  const { $, $$, api, escapeHtml, icon, formatDate, formatDayName, formatMonth, formatPercent, setLoading, toast, emptyState, percentTone, statusBadge } = App;

  const state = {
    month: App.monthISO(),
    threshold: 75,
    report: null,
    history: null,
    filter: 'all',
  };

  const monthInput = $('#reportMonth');
  const thresholdInput = $('#thresholdInput');
  const reportBody = $('#reportBody');
  const historyBody = $('#historyBody');
  const detailModal = $('#studentDetailModal');

  function renderSummary() {
    const report = state.report;
    if (!report) return;
    $('#reportWorkingDays').textContent = report.workingDays;
    $('#reportWorkingDaysMeta').textContent = formatMonth(report.month);
    $('#reportWorkingPeriods').textContent = report.workingPeriods;
    $('#reportAverage').textContent = formatPercent(report.classAverage);
    $('#reportAverageMeta').textContent = `${report.workingDays} days · ${report.workingPeriods} periods`;
    $('#reportBelow').textContent = report.belowThresholdCount;
    $('#reportBelowMeta').textContent = `Below the ${report.threshold}% threshold`;
    $('#reportCaption').textContent = `${formatMonth(report.month)} · ${report.totalStudents} students · threshold ${report.threshold}%`;
    $('#countAll').textContent = report.students.length;
    $('#countBelow').textContent = report.belowThresholdCount;
  }

  function renderReportTable() {
    const report = state.report;
    if (!report) return;

    const rows = state.filter === 'below' ? report.students.filter((student) => student.belowThreshold) : report.students;

    if (rows.length === 0) {
      reportBody.innerHTML = `
        <tr>
          <td colspan="7" class="table-empty">
            ${emptyState(
              state.filter === 'below' ? 'shield' : 'chart',
              state.filter === 'below' ? 'No students below threshold' : 'No report data yet',
              state.filter === 'below'
                ? `Every student is at or above ${report.threshold}% this month.`
                : 'Save attendance for this month to generate a class summary.'
            )}
          </td>
        </tr>
      `;
      return;
    }

    reportBody.innerHTML = rows
      .map((student) => {
        const tone = percentTone(student.percentage, report.threshold);
        return `
          <tr data-testid="report-row" data-id="${student.id}" data-roll="${escapeHtml(student.rollNo)}" tabindex="0" aria-label="Open report for ${escapeHtml(student.name)}">
            <td>
              <div class="student-cell">
                ${App.avatar(student.name)}
                <div>
                  <strong>${escapeHtml(student.name)}</strong>
                  <small>${student.attended} of ${student.workingPeriods} periods attended</small>
                </div>
              </div>
            </td>
            <td><span class="roll-pill">${escapeHtml(student.rollNo)}</span></td>
            <td><span class="dept-badge" title="${escapeHtml(student.department)}">${escapeHtml(student.department)}</span></td>
            <td class="num" data-testid="attended-${escapeHtml(student.rollNo)}"><span class="strong">${student.attended}</span></td>
            <td class="num" data-testid="absent-${escapeHtml(student.rollNo)}">${student.absent}</td>
            <td>
              <div class="pct ${tone === 'danger' ? 'is-danger' : ''}" data-testid="pct-${escapeHtml(student.rollNo)}">
                <strong>${formatPercent(student.percentage)}</strong>
                <span class="progress is-${tone}" aria-hidden="true"><span style="width:${Math.min(student.percentage, 100)}%"></span></span>
              </div>
            </td>
            <td data-testid="status-${escapeHtml(student.rollNo)}">${statusBadge(student.belowThreshold)}</td>
          </tr>
        `;
      })
      .join('');
  }

  function renderHistory() {
    const history = state.history;
    if (!history) return;
    $('#historyCaption').textContent = `${history.workingDays} saved day${history.workingDays === 1 ? '' : 's'} · ${history.workingPeriods} periods in ${formatMonth(history.month)}`;

    if (history.days.length === 0) {
      historyBody.innerHTML = `<tr><td colspan="6" class="table-empty">No attendance history for ${escapeHtml(formatMonth(history.month))} yet.</td></tr>`;
      return;
    }

    historyBody.innerHTML = history.days
      .map((day) => {
        const tone = percentTone(day.percentage, state.report ? state.report.threshold : 75);
        return `
          <tr>
            <td>
              <div class="history-day">
                <span class="day-badge">
                  <strong>${new Date(`${day.date}T00:00:00`).getDate()}</strong>
                  <small>${formatDayName(day.date).slice(0, 3)}</small>
                </span>
                <div class="day-info">
                  <strong>${escapeHtml(formatDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</strong>
                  <small>${escapeHtml(formatDayName(day.date))}</small>
                </div>
              </div>
            </td>
            <td>${day.students} students</td>
            <td>${day.records} periods</td>
            <td><span class="strong">${day.present}</span> <span class="muted">/ ${day.records}</span></td>
            <td>
              <div class="pct ${tone === 'danger' ? 'is-danger' : ''}">
                <strong>${formatPercent(day.percentage)}</strong>
                <span class="progress is-${tone}" aria-hidden="true"><span style="width:${Math.min(day.percentage, 100)}%"></span></span>
              </div>
            </td>
            <td><a class="table-link" href="/attendance.html?date=${encodeURIComponent(day.date)}">Open ${icon('arrow-right', 'icon icon-sm')}</a></td>
          </tr>
        `;
      })
      .join('');
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('month', state.month);
    url.searchParams.set('threshold', String(state.threshold));
    window.history.replaceState({}, '', url);
  }

  async function loadReport({ initial = false } = {}) {
    try {
      const [report, history] = await Promise.all([
        api(`/api/reports/monthly?month=${encodeURIComponent(state.month)}&threshold=${encodeURIComponent(state.threshold)}`),
        api(`/api/attendance/history?month=${encodeURIComponent(state.month)}`),
      ]);
      state.report = report;
      state.history = history;
      state.threshold = report.threshold;
      thresholdInput.value = report.threshold;
      renderSummary();
      renderReportTable();
      renderHistory();
      updateUrl();

      const params = new URLSearchParams(window.location.search);
      const studentId = params.get('student');
      if (initial && studentId) {
        openStudentDetail(Number(studentId));
      }
    } catch (error) {
      toast(error.message, 'error', 'Could not load the monthly report');
      reportBody.innerHTML = `<tr><td colspan="7" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
      historyBody.innerHTML = `<tr><td colspan="6" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function applyFilters() {
    const month = monthInput.value;
    const threshold = Number(thresholdInput.value);

    if (!month) {
      toast('Choose a month to generate the report.', 'warning', 'Month required');
      return;
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      toast('Threshold must be a number between 0 and 100.', 'warning', 'Invalid threshold');
      return;
    }

    const button = $('#applyFilters');
    setLoading(button, true);
    try {
      const saved = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ threshold }),
      });
      state.month = month;
      state.threshold = saved.threshold;
      await loadReport();
      toast(`Report generated for ${formatMonth(month)} with a ${saved.threshold}% threshold.`, 'success', 'Report updated');
    } catch (error) {
      toast(error.message, 'error', 'Could not update the report');
    } finally {
      setLoading(button, false);
    }
  }

  async function openStudentDetail(studentId) {
    if (!studentId) return;
    detailModal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#detailName').textContent = 'Student report';
    $('#detailMeta').textContent = formatMonth(state.month);
    $('#detailBody').innerHTML = `<div class="loading-state"><span class="spinner"></span> Loading student report…</div>`;

    try {
      const detail = await api(
        `/api/reports/student/${studentId}?month=${encodeURIComponent(state.month)}&threshold=${encodeURIComponent(state.threshold)}`
      );
      const { student, summary, days } = detail;
      $('#detailName').textContent = student.name;
      $('#detailMeta').textContent = `${student.rollNo} · ${student.department} · ${formatMonth(detail.month)}`;

      const stats = `
        <div class="detail-summary">
          <div class="detail-stat"><span>Attended</span><strong class="text-success">${summary ? summary.attended : 0}</strong></div>
          <div class="detail-stat"><span>Absent</span><strong class="${summary && summary.absent > 0 ? 'danger' : ''}">${summary ? summary.absent : 0}</strong></div>
          <div class="detail-stat"><span>Attendance</span><strong class="${summary && summary.belowThreshold ? 'danger' : ''}">${summary ? formatPercent(summary.percentage) : '0.00%'}</strong></div>
          <div class="detail-stat"><span>Working periods</span><strong>${detail.workingPeriods}</strong></div>
        </div>
      `;

      if (!days.length) {
        $('#detailBody').innerHTML = `${stats}${emptyState('calendar', 'No daily records', 'No attendance was saved for this student in the selected month.')}`;
        return;
      }

      const grid = `
        <div class="detail-grid-wrap">
          <table class="detail-grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>P1</th><th>P2</th><th>P3</th><th>P4</th><th>P5</th><th>P6</th><th>P7</th>
                <th>Present</th>
                <th>Absent</th>
              </tr>
            </thead>
            <tbody>
              ${days
                .map(
                  (day) => `
                  <tr>
                    <td>${escapeHtml(formatDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</td>
                    ${day.periods
                      .map((status) => {
                        const cls = status === 'present' ? 'present' : status === 'absent' ? 'absent' : 'unmarked';
                        const text = status === 'present' ? 'P' : status === 'absent' ? 'A' : '–';
                        return `<td><span class="day-cell ${cls}">${text}</span></td>`;
                      })
                      .join('')}
                    <td><span class="text-success strong">${day.present}</span></td>
                    <td><span class="${day.absent ? 'text-danger' : 'muted'} strong">${day.absent}</span></td>
                  </tr>
                `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;

      $('#detailBody').innerHTML = `${stats}${grid}`;
    } catch (error) {
      $('#detailBody').innerHTML = emptyState('alert-triangle', 'Could not load student report', error.message);
    }
  }

  function closeDetail() {
    detailModal.hidden = true;
    document.body.style.overflow = '';
    const url = new URL(window.location.href);
    if (url.searchParams.has('student')) {
      url.searchParams.delete('student');
      window.history.replaceState({}, '', url);
    }
  }

  reportBody.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-id]');
    if (row) openStudentDetail(Number(row.dataset.id));
  });

  reportBody.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('tr[data-id]');
    if (row) {
      event.preventDefault();
      openStudentDetail(Number(row.dataset.id));
    }
  });

  $$('.report-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.filter = tab.dataset.filter;
      $$('.report-tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      renderReportTable();
    });
  });

  $('#applyFilters').addEventListener('click', applyFilters);
  thresholdInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyFilters();
  });

  $('#exportCsv').addEventListener('click', () => {
    if (!state.report) {
      toast('Generate a report before exporting.', 'warning', 'Nothing to export');
      return;
    }
    const url = `/api/reports/monthly.csv?month=${encodeURIComponent(state.month)}&threshold=${encodeURIComponent(state.threshold)}`;
    window.location.href = url;
    toast(`CSV export started for ${formatMonth(state.month)}.`, 'success', 'Export ready');
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeDetail());
  });
  detailModal.addEventListener('click', (event) => {
    if (event.target === detailModal) closeDetail();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !detailModal.hidden) closeDetail();
  });

  const params = new URLSearchParams(window.location.search);
  state.month = params.get('month') || App.monthISO();
  const urlThreshold = params.has('threshold') ? Number(params.get('threshold')) : NaN;
  state.threshold = Number.isFinite(urlThreshold) && urlThreshold >= 0 && urlThreshold <= 100 ? urlThreshold : 75;
  monthInput.value = state.month;
  thresholdInput.value = state.threshold;

  loadReport({ initial: true });
})();
