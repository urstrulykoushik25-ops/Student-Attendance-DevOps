'use strict';

(() => {
  const { $, $$, api, escapeHtml, formatDate, setLoading, toast, emptyState, icon, todayISO, addDays } = App;

  const state = {
    date: todayISO(),
    students: [],
    recordCount: 0,
  };

  const dateInput = $('#attendanceDate');
  const tbody = $('#attendanceBody');
  const saveButton = $('#saveAttendance');

  function periodLabel(period) {
    return `Period ${period}`;
  }

  function updateSummary() {
    let present = 0;
    let absent = 0;
    for (const student of state.students) {
      for (const status of student.attendance) {
        if (status === 'present') present += 1;
        if (status === 'absent') absent += 1;
      }
    }
    const total = state.students.length * 7;
    $('#sumPresent').textContent = present;
    $('#sumAbsent').textContent = absent;
    $('#sumUnmarked').textContent = Math.max(total - present - absent, 0);
    $('#sumStudents').textContent = state.students.length;
    $('#attendanceSubtitle').textContent = `${state.students.length} student${state.students.length === 1 ? '' : 's'} · ${present + absent} of ${total} periods marked`;
    return { present, absent };
  }

  function cellMarkup(student, period) {
    const status = student.attendance[period - 1];
    const cls = status === 'present' ? 'is-present' : status === 'absent' ? 'is-absent' : 'is-empty';
    const text = status === 'present' ? 'P' : status === 'absent' ? 'A' : '';
    const label = status ? `${status}` : 'not marked';
    return `<button class="period-toggle ${cls}" type="button"
      data-testid="cell-${student.id}-${period}"
      data-student-id="${student.id}"
      data-period="${period}"
      data-status="${status || ''}"
      aria-label="${escapeHtml(student.name)}, ${periodLabel(period)}: ${label}. Click to change."
      title="${periodLabel(period)} · ${label}">${text}</button>`;
  }

  function renderTable() {
    if (state.students.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="table-empty">
            ${emptyState(
              'users',
              'No students in the roster',
              'Add students before taking attendance for this date.',
              `<a class="btn btn-primary btn-sm" href="/students.html">${icon('plus')} Add students</a>`
            )}
          </td>
        </tr>
      `;
      updateSummary();
      return;
    }

    tbody.innerHTML = state.students
      .map(
        (student, index) => `
        <tr data-testid="attendance-row" data-student-id="${student.id}" data-roll="${escapeHtml(student.rollNo)}">
          <td><span class="row-index">${String(index + 1).padStart(2, '0')}</span></td>
          <td><span class="roll-pill">${escapeHtml(student.rollNo)}</span></td>
          <td>
            <div class="student-cell">
              ${App.avatar(student.name)}
              <div>
                <strong>${escapeHtml(student.name)}</strong>
                <small>${escapeHtml(student.department)}</small>
              </div>
            </div>
          </td>
          ${[1, 2, 3, 4, 5, 6, 7].map((period) => `<td class="period-cell">${cellMarkup(student, period)}</td>`).join('')}
        </tr>
      `
      )
      .join('');

    updateSummary();
  }

  function updateDateHeading() {
    const label = formatDate(state.date, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    $('#attendanceDateLabel').textContent = label;
  }

  function setSavedIndicator(visible, text = 'Saved records loaded') {
    const indicator = $('#savedIndicator');
    indicator.hidden = !visible;
    $('#savedIndicatorText').textContent = text || 'Saved records loaded';
  }

  async function loadAttendance(date) {
    state.date = date;
    dateInput.value = date;
    updateDateHeading();
    setSavedIndicator(false);

    try {
      const data = await api(`/api/attendance?date=${encodeURIComponent(date)}`);
      state.students = data.students;
      state.recordCount = data.recordCount;
      renderTable();
      setSavedIndicator(data.recordCount > 0, data.recordCount > 0 ? 'Saved records loaded' : '');
      const url = new URL(window.location.href);
      url.searchParams.set('date', date);
      window.history.replaceState({}, '', url);
      if (data.recordCount > 0) {
        toast(`${data.recordCount} saved period records loaded for ${formatDate(date)}.`, 'info', 'Attendance loaded');
      }
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="10" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
      toast(error.message, 'error', 'Could not load attendance');
    }
  }

  function cycleCell(button) {
    const student = state.students.find((item) => item.id === Number(button.dataset.studentId));
    if (!student) return;
    const period = Number(button.dataset.period);
    const current = student.attendance[period - 1];
    const next = current === 'present' ? 'absent' : 'present';
    student.attendance[period - 1] = next;
    button.dataset.status = next;
    button.classList.remove('is-present', 'is-absent', 'is-empty');
    button.classList.add(next === 'present' ? 'is-present' : 'is-absent');
    button.textContent = next === 'present' ? 'P' : 'A';
    button.setAttribute('aria-label', `${student.name}, ${periodLabel(period)}: ${next}. Click to change.`);
    button.title = `${periodLabel(period)} · ${next}`;
    updateSummary();
  }

  function markAll(status) {
    for (const student of state.students) {
      student.attendance = student.attendance.map(() => status);
    }
    $$('.period-toggle', tbody).forEach((button) => {
      button.dataset.status = status;
      button.classList.remove('is-present', 'is-absent', 'is-empty');
      button.classList.add(status === 'present' ? 'is-present' : 'is-absent');
      button.textContent = status === 'present' ? 'P' : 'A';
      const student = state.students.find((item) => item.id === Number(button.dataset.studentId));
      const period = Number(button.dataset.period);
      if (student) {
        button.setAttribute('aria-label', `${student.name}, ${periodLabel(period)}: ${status}. Click to change.`);
        button.title = `${periodLabel(period)} · ${status}`;
      }
    });
    updateSummary();
  }

  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('.period-toggle');
    if (button) cycleCell(button);
  });

  $('#markAllPresent').addEventListener('click', () => {
    markAll('present');
    toast('All periods marked present. Save to store the sheet.', 'info', 'Sheet updated');
  });

  $('#markAllAbsent').addEventListener('click', () => {
    markAll('absent');
    toast('All periods marked absent. Save to store the sheet.', 'info', 'Sheet updated');
  });

  saveButton.addEventListener('click', async () => {
    const records = [];
    for (const student of state.students) {
      student.attendance.forEach((status, index) => {
        if (status) records.push({ studentId: student.id, period: index + 1, status });
      });
    }

    if (records.length === 0) {
      toast('Mark at least one period before saving the attendance sheet.', 'warning', 'Nothing to save');
      return;
    }

    setLoading(saveButton, true);
    try {
      const result = await api('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ date: state.date, records }),
      });
      state.students = result.students;
      state.recordCount = result.recordCount;
      renderTable();
      setSavedIndicator(true, 'Saved just now');
      toast(
        `${result.saved} period record${result.saved === 1 ? '' : 's'} saved for ${formatDate(state.date)}.`,
        'success',
        'Attendance saved'
      );
    } catch (error) {
      toast(error.message, 'error', 'Could not save attendance');
    } finally {
      setLoading(saveButton, false);
    }
  });

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    loadAttendance(dateInput.value);
  });

  $('#prevDate').addEventListener('click', () => loadAttendance(addDays(state.date, -1)));
  $('#nextDate').addEventListener('click', () => loadAttendance(addDays(state.date, 1)));
  $('#todayBtn').addEventListener('click', () => loadAttendance(todayISO()));

  const params = new URLSearchParams(window.location.search);
  const initialDate = params.get('date') || todayISO();
  loadAttendance(initialDate);
})();
