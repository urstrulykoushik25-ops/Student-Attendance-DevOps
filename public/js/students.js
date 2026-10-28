'use strict';

(() => {
  const { $, api, escapeHtml, formatDate, setLoading, toast, emptyState, icon } = App;

  const state = {
    students: [],
    departments: 0,
    query: '',
    editingId: null,
    deletingId: null,
  };

  const studentsBody = $('#studentsBody');
  const searchInput = $('#studentSearch');
  const countLabel = $('#studentCount');
  const studentModal = $('#studentModal');
  const deleteModal = $('#deleteModal');
  const form = $('#studentForm');
  const formError = $('#studentFormError');
  const formErrorText = $('#studentFormErrorText');

  function showFormError(message) {
    formErrorText.textContent = message;
    formError.hidden = false;
  }

  function clearFormError() {
    formError.hidden = true;
    formErrorText.textContent = '';
  }

  function filteredStudents() {
    const query = state.query.trim().toLowerCase();
    if (!query) return state.students;
    return state.students.filter((student) =>
      [student.name, student.rollNo, student.department].some((value) =>
        String(value).toLowerCase().includes(query)
      )
    );
  }

  function renderStudents() {
    const rows = filteredStudents();
    countLabel.textContent = state.query
      ? `${rows.length} of ${state.students.length} students`
      : `${state.students.length} students · ${state.departments} department${state.departments === 1 ? '' : 's'}`;

    if (rows.length === 0) {
      studentsBody.innerHTML = `
        <tr>
          <td colspan="5" class="table-empty">
            ${
              state.students.length === 0
                ? emptyState(
                    'users',
                    'No students yet',
                    'Add your first student to start marking attendance.',
                    `<button class="btn btn-primary btn-sm" type="button" id="emptyAddStudent">${icon('plus')} Add student</button>`
                  )
                : emptyState('search', 'No matching students', 'Try a different name, roll number or department.')
            }
          </td>
        </tr>
      `;
      const emptyAdd = $('#emptyAddStudent');
      if (emptyAdd) emptyAdd.addEventListener('click', () => openStudentModal());
      return;
    }

    studentsBody.innerHTML = rows
      .map(
        (student) => `
        <tr data-testid="student-row" data-id="${student.id}" data-roll="${escapeHtml(student.rollNo)}">
          <td>
            <div class="student-name-cell">
              ${App.avatar(student.name)}
              <div>
                <strong>${escapeHtml(student.name)}</strong>
                <small>Student #${student.id}</small>
              </div>
            </div>
          </td>
          <td><span class="roll-pill">${escapeHtml(student.rollNo)}</span></td>
          <td><span class="dept-badge" title="${escapeHtml(student.department)}">${escapeHtml(student.department)}</span></td>
          <td><span class="small muted">${escapeHtml(formatDate(String(student.createdAt).slice(0, 10)))}</span></td>
          <td>
            <div class="actions">
              <button class="icon-btn" type="button" data-action="edit" data-id="${student.id}" aria-label="Edit ${escapeHtml(student.name)}">
                ${icon('pencil')}
              </button>
              <button class="icon-btn danger" type="button" data-action="delete" data-id="${student.id}" aria-label="Delete ${escapeHtml(student.name)}">
                ${icon('trash')}
              </button>
            </div>
          </td>
        </tr>
      `
      )
      .join('');
  }

  async function loadStudents() {
    try {
      const data = await api('/api/students');
      state.students = data.students;
      state.departments = data.departments;
      renderStudents();
    } catch (error) {
      countLabel.textContent = 'Could not load students';
      studentsBody.innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
      toast(error.message, 'error', 'Could not load students');
    }
  }

  function openModal(modal) {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function openStudentModal(student = null) {
    state.editingId = student ? student.id : null;
    form.reset();
    clearFormError();
    $('#studentModalTitle').textContent = student ? 'Edit student' : 'Add student';
    $('#studentId').value = student ? student.id : '';
    $('#studentRoll').value = student ? student.rollNo : '';
    $('#studentName').value = student ? student.name : '';
    $('#studentDepartment').value = student ? student.department : '';
    openModal(studentModal);
    setTimeout(() => $('#studentRoll').focus(), 40);
  }

  function openDeleteModal(student) {
    state.deletingId = student.id;
    $('#deleteStudentText').textContent = `Are you sure you want to remove ${student.name} (${student.rollNo})? Their attendance history will be deleted too.`;
    openModal(deleteModal);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError();

    const rollNo = $('#studentRoll').value.trim();
    const name = $('#studentName').value.trim();
    const department = $('#studentDepartment').value.trim();

    if (!rollNo) return showFormError('Roll number is required.');
    if (name.length < 2) return showFormError('Enter the student’s full name (at least 2 characters).');
    if (!department) return showFormError('Department is required.');

    const payload = { rollNo, name, department };
    const saveButton = $('#saveStudentBtn');
    setLoading(saveButton, true);

    try {
      if (state.editingId) {
        await api(`/api/students/${state.editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast(`${name} was updated.`, 'success', 'Student updated');
      } else {
        await api('/api/students', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast(`${name} was added to the roster.`, 'success', 'Student added');
      }
      closeModal(studentModal);
      await loadStudents();
    } catch (error) {
      showFormError(error.message);
    } finally {
      setLoading(saveButton, false);
    }
  });

  studentsBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const student = state.students.find((item) => item.id === Number(button.dataset.id));
    if (!student) return;
    if (button.dataset.action === 'edit') openStudentModal(student);
    if (button.dataset.action === 'delete') openDeleteModal(student);
  });

  $('#addStudentBtn').addEventListener('click', () => openStudentModal());

  searchInput.addEventListener(
    'input',
    App.debounce(() => {
      state.query = searchInput.value;
      renderStudents();
    }, 120)
  );

  $('#confirmDeleteBtn').addEventListener('click', async (event) => {
    if (!state.deletingId) return;
    const button = event.currentTarget;
    setLoading(button, true);
    try {
      await api(`/api/students/${state.deletingId}`, { method: 'DELETE' });
      closeModal(deleteModal);
      state.deletingId = null;
      toast('The student and their attendance records were removed.', 'success', 'Student removed');
      await loadStudents();
    } catch (error) {
      toast(error.message, 'error', 'Could not remove student');
    } finally {
      setLoading(button, false);
    }
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop')));
  });

  [studentModal, deleteModal].forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!studentModal.hidden) closeModal(studentModal);
    if (!deleteModal.hidden) closeModal(deleteModal);
  });

  loadStudents();
})();
