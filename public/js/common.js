'use strict';

/**
 * Shared browser helpers for every page: API client, formatting, toasts,
 * icons, avatar tones and the responsive app shell.
 */
const App = (() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function icon(name, className = 'icon') {
    return `<svg class="${className}" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
  }

  async function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch {
      throw new Error('Cannot reach the server. Check that the application is running.');
    }

    if (response.status === 204) return null;

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const message =
        (payload && payload.error) ||
        (typeof payload === 'string' && payload) ||
        `Request failed with status ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function toast(message, type = 'success', title) {
    const stack = $('#toastStack');
    if (!stack) return;

    const titles = {
      success: 'Success',
      error: 'Something went wrong',
      warning: 'Heads up',
      info: 'Information',
    };
    const iconNames = {
      success: 'check',
      error: 'alert-triangle',
      warning: 'alert-triangle',
      info: 'sparkles',
    };

    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.setAttribute('role', 'status');
    element.innerHTML = `
      <span class="toast-icon">${icon(iconNames[type] || 'check')}</span>
      <div class="toast-copy">
        <strong>${escapeHtml(title || titles[type] || 'Notice')}</strong>
        <p>${escapeHtml(message)}</p>
      </div>
      <button class="toast-close" type="button" aria-label="Dismiss notification">
        ${icon('close')}
      </button>
    `;

    const dismiss = () => {
      if (!element.isConnected) return;
      element.classList.add('is-leaving');
      setTimeout(() => element.remove(), 220);
    };

    element.querySelector('.toast-close').addEventListener('click', dismiss);
    stack.appendChild(element);
    setTimeout(dismiss, type === 'error' ? 6500 : 4200);
  }

  function initials(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function avatarTone(name) {
    let hash = 0;
    for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % 6;
  }

  function avatar(name, extraClass = '') {
    return `<span class="avatar-sm tone-avatar-${avatarTone(name)} ${extraClass}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
  }

  function parseLocalDate(iso) {
    if (!iso) return null;
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function todayISO() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  function monthISO(date = new Date()) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${date.getFullYear()}-${month}`;
  }

  function formatDate(iso, options = {}) {
    const date = parseLocalDate(iso);
    if (!date) return '—';
    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...options,
    });
  }

  function formatDateShort(iso) {
    return formatDate(iso, { day: 'numeric', month: 'short' });
  }

  function formatMonth(iso) {
    const date = parseLocalDate(`${iso}-01`);
    if (!date) return '—';
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function formatDayName(iso) {
    const date = parseLocalDate(iso);
    if (!date) return '';
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  function relativeDay(iso) {
    const today = todayISO();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    if (iso === today) return 'Today';
    if (iso === yesterdayISO) return 'Yesterday';
    return formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function addDays(iso, amount) {
    const date = parseLocalDate(iso);
    if (!date) return iso;
    date.setDate(date.getDate() + amount);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function formatPercent(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${number.toFixed(digits)}%`;
  }

  function debounce(fn, delay = 250) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function setLoading(button, loading) {
    if (!button) return;
    if (loading) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.classList.add('is-loading');
      button.innerHTML = `<span class="spinner" style="width:15px;height:15px;border-width:2px"></span><span>Saving…</span>`;
    } else {
      button.disabled = false;
      button.classList.remove('is-loading');
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  function emptyState(iconName, title, description, action = '') {
    return `
      <div class="empty-state">
        <span class="empty-icon">${icon(iconName)}</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(description)}</p>
        ${action}
      </div>
    `;
  }

  function percentTone(percentage, threshold = 75) {
    if (percentage < threshold) return 'danger';
    if (percentage < threshold + 5) return 'warning';
    return 'success';
  }

  function statusBadge(belowThreshold) {
    return belowThreshold
      ? `<span class="badge badge-danger">${icon('alert-triangle')} Below threshold</span>`
      : `<span class="badge badge-success">${icon('check')} On track</span>`;
  }

  function initShell() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    const navMap = {
      '/': 'dashboard',
      '/index.html': 'dashboard',
      '/students': 'students',
      '/students.html': 'students',
      '/attendance': 'attendance',
      '/attendance.html': 'attendance',
      '/reports': 'reports',
      '/reports.html': 'reports',
    };
    const active = navMap[path];
    $$('[data-nav]').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === active);
    });

    const todayChip = $('#todayChip');
    if (todayChip) {
      todayChip.innerHTML = `${icon('calendar')} ${escapeHtml(
        new Date().toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      )}`;
    }

    const menuBtn = $('#menuBtn');
    if (menuBtn) {
      let overlay = $('.nav-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'nav-overlay';
        overlay.addEventListener('click', () => document.body.classList.remove('nav-open'));
        document.body.appendChild(overlay);
      }
      menuBtn.addEventListener('click', () => document.body.classList.toggle('nav-open'));
      $$('.sidebar .nav-link').forEach((link) => {
        link.addEventListener('click', () => document.body.classList.remove('nav-open'));
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') document.body.classList.remove('nav-open');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShell);
  } else {
    initShell();
  }

  return {
    $,
    $$,
    escapeHtml,
    icon,
    api,
    toast,
    initials,
    avatarTone,
    avatar,
    todayISO,
    monthISO,
    formatDate,
    formatDateShort,
    formatMonth,
    formatDayName,
    relativeDay,
    addDays,
    formatPercent,
    debounce,
    setLoading,
    emptyState,
    percentTone,
    statusBadge,
    initShell,
  };
})();

window.App = App;
