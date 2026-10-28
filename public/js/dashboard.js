'use strict';

(() => {
  const { $, api, escapeHtml, icon, formatDate, formatDateShort, formatDayName, formatPercent, relativeDay, percentTone, emptyState, toast } = App;

  function setGreeting() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const element = $('#greeting');
    if (element) element.textContent = `${greeting}, Faculty`;
  }

  function renderPeriodPulse(today) {
    const container = $('#periodPulse');
    if (!container) return;

    if (!today.hasRecords) {
      container.innerHTML = emptyState(
        'clipboard-check',
        'No attendance saved yet',
        'Open the attendance sheet to mark periods 1–7 for today.',
        `<a class="btn btn-primary btn-sm" href="/attendance.html">${icon('clipboard-check')} Take attendance</a>`
      );
      return;
    }

    container.innerHTML = today.periods
      .map((period) => {
        const total = period.present + period.absent + period.unmarked;
        const presentWidth = total ? (period.present / total) * 100 : 0;
        const absentWidth = total ? (period.absent / total) * 100 : 0;
        return `
          <div class="period-row">
            <span class="period-label">P${period.period}</span>
            <div class="period-bar" role="img" aria-label="Period ${period.period}: ${period.present} present, ${period.absent} absent, ${period.unmarked} unmarked">
              <span class="bar-present" style="width:${presentWidth}%"></span>
              <span class="bar-absent" style="width:${absentWidth}%"></span>
            </div>
            <span class="period-counts"><b>${period.present}</b> P <span aria-hidden="true">·</span> <i>${period.absent}</i> A</span>
          </div>
        `;
      })
      .join('');
  }

  function renderLowAttendance(data) {
    const container = $('#lowAttendanceList');
    if (!container) return;

    if (!data.lowAttendance.length) {
      container.innerHTML = emptyState(
        'shield',
        'Everyone is on track',
        `No student is below the ${data.threshold}% attendance threshold this month.`
      );
      return;
    }

    container.innerHTML = data.lowAttendance
      .map(
        (student) => `
        <a class="low-item" href="/reports.html?month=${encodeURIComponent(data.month)}&student=${student.id}">
          ${App.avatar(student.name)}
          <div class="low-item-main">
            <strong>${escapeHtml(student.name)}</strong>
            <small>${escapeHtml(student.rollNo)} · ${escapeHtml(student.department)}</small>
          </div>
          <div class="low-item-pct">
            <strong>${formatPercent(student.percentage)}</strong>
            <span class="mini-progress" aria-hidden="true"><span style="width:${Math.min(student.percentage, 100)}%"></span></span>
          </div>
        </a>
      `
      )
      .join('');
  }

  function renderRecent(data) {
    const tbody = $('#recentBody');
    if (!tbody) return;

    if (!data.recentDays.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No attendance history for ${escapeHtml(formatDate(data.date, { month: 'long', year: 'numeric' }))} yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.recentDays
      .map((day) => {
        const tone = percentTone(day.percentage, data.threshold);
        const badge =
          tone === 'danger'
            ? `<span class="badge badge-danger">Needs review</span>`
            : tone === 'warning'
              ? `<span class="badge badge-warning">Watch</span>`
              : `<span class="badge badge-success">Healthy</span>`;
        return `
          <tr>
            <td>
              <div class="history-day">
                <span class="day-badge">
                  <strong>${new Date(`${day.date}T00:00:00`).getDate()}</strong>
                  <small>${formatDayName(day.date).slice(0, 3)}</small>
                </span>
                <div class="day-info">
                  <strong>${escapeHtml(relativeDay(day.date))}</strong>
                  <small>${escapeHtml(formatDate(day.date))}</small>
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
            <td>${badge}</td>
            <td><a class="table-link" href="/attendance.html?date=${encodeURIComponent(day.date)}">Open ${icon('arrow-right', 'icon icon-sm')}</a></td>
          </tr>
        `;
      })
      .join('');
  }

  async function loadDashboard() {
    const today = App.todayISO();
    const month = App.monthISO();
    try {
      const data = await api(`/api/dashboard?date=${today}&month=${month}`);
      const todayPct = data.today.percentage;

      $('#statTotalStudents').textContent = data.totalStudents;
      $('#statTotalMeta').textContent = `${data.monthSummary.totalStudents} students in the monthly report`;

      $('#statToday').textContent = `${data.today.markedStudents}/${data.totalStudents}`;
      $('#statTodayMeta').textContent = `${data.today.present} present · ${data.today.absent} absent`;

      $('#statAverage').textContent = formatPercent(data.monthSummary.classAverage);
      $('#statAverageMeta').textContent = `${data.monthSummary.workingDays} working days · ${data.monthSummary.workingPeriods} periods`;

      $('#statLow').textContent = data.monthSummary.belowThresholdCount;
      $('#statLowMeta').textContent = `Below the ${data.threshold}% threshold`;

      const ring = $('#todayRing');
      if (ring) {
        ring.style.setProperty('--value', Math.min(todayPct, 100));
        const label = $('#todayRingLabel');
        if (label) label.textContent = `${Math.round(todayPct)}%`;
      }
      $('#todayPercent').textContent = formatPercent(todayPct);
      $('#todayMeta').textContent = data.today.hasRecords
        ? `${data.today.present} present · ${data.today.absent} absent · ${data.today.completeStudents} complete sheets`
        : 'No attendance saved for today yet';

      renderPeriodPulse(data.today);
      renderLowAttendance(data);
      renderRecent(data);
    } catch (error) {
      toast(error.message, 'error', 'Could not load the dashboard');
      const pulse = $('#periodPulse');
      if (pulse) pulse.innerHTML = emptyState('alert-triangle', 'Dashboard unavailable', error.message);
    }
  }

  setGreeting();
  loadDashboard();
})();
