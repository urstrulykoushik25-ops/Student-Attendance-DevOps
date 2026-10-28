'use strict';

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function cleanString(value, field, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string') {
    throw new ApiError(400, `${field} is required.`);
  }
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned.length < min) {
    throw new ApiError(400, `${field} must be at least ${min} character${min === 1 ? '' : 's'}.`);
  }
  if (cleaned.length > max) {
    throw new ApiError(400, `${field} must be at most ${max} characters.`);
  }
  return cleaned;
}

function parseId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, `${field} must be a positive integer.`);
  }
  return id;
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function assertDate(value, field = 'date') {
  if (!isDate(value)) {
    throw new ApiError(400, `${field} must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
}

function assertMonth(value, field = 'month') {
  if (!isMonth(value)) {
    throw new ApiError(400, `${field} must be a valid month in YYYY-MM format.`);
  }
  return value;
}

function parseThreshold(value, fallback = 75) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new ApiError(400, 'Threshold must be a number between 0 and 100.');
  }
  return Math.round(threshold * 100) / 100;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  ApiError,
  cleanString,
  parseId,
  isDate,
  isMonth,
  assertDate,
  assertMonth,
  parseThreshold,
  round2,
  localDateISO,
};
