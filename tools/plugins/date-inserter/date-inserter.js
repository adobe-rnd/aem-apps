/* eslint-disable import/no-unresolved */

import initDateCalendar, { formatISODate, getToday, parseISODate } from './date-calendar.js';
import initTimePicker from './time-picker.js';

/**
 * Formats date and optional time into ISO format
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} [time] - Optional time in HH:MM format
 * @returns {string} Formatted date/datetime string
 */
function formatDateTime(date, time) {
  if (time) {
    return `${date}T${time}`;
  }
  return date;
}

/**
 * Detects if running in standalone mode (not in DA iframe)
 * @returns {boolean} True if standalone
 */
function isStandalone() {
  return window.self === window.top;
}

/**
 * Mock actions for standalone testing
 */
const mockActions = {
  sendText: (text) => {
    // eslint-disable-next-line no-console
    console.log('sendText called with:', text);
    // eslint-disable-next-line no-alert
    alert(`Inserted: ${text}`);
  },
};

/**
 * Inserts text and displays errors
 * @param {Object} actions - DA SDK actions
 * @param {string} text - Text to insert
 * @param {HTMLElement} feedback - Feedback element
 */
async function insertText(actions, text, feedback) {
  if (!actions?.sendText) {
    feedback.textContent = 'Cannot insert: Editor not available';
    feedback.classList.add('error');
    return;
  }

  try {
    await actions.sendText(text);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Date Inserter could not insert text', error);
    feedback.textContent = 'Could not insert the date. Please try again.';
    feedback.classList.add('error');
    return;
  }
  feedback.textContent = '';
  feedback.classList.remove('error');
}

/**
 * Main initialization function
 */
(async function init() {
  let actions;

  const datePicker = document.getElementById('date-picker');
  const timePicker = document.getElementById('time-picker');
  const insertCustomBtn = document.getElementById('insert-custom-btn');
  const feedback = document.getElementById('feedback');

  try {
    await import('https://da.live/nx/public/sl/components.js');
    await Promise.all([
      customElements.whenDefined('sl-input'),
      customElements.whenDefined('sl-button'),
    ]);
    document.body.classList.remove('sl-loading');
    if (isStandalone()) {
      actions = mockActions;
    } else {
      const { default: sdk } = await import('https://da.live/nx/utils/sdk.js');
      ({ actions } = await sdk);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Date Inserter could not initialize the DA SDK', error);
    document.body.classList.remove('sl-loading');
    document.body.classList.add('sdk-error');
    feedback.textContent = 'Could not load the DA SDK. Please reload the plugin.';
    feedback.classList.add('error');
    return;
  }

  datePicker.value = formatISODate(getToday());
  timePicker.value = '';
  initDateCalendar(
    datePicker,
    document.getElementById('calendar-trigger'),
    document.getElementById('date-calendar'),
  );
  initTimePicker(
    timePicker,
    document.getElementById('time-trigger'),
    document.getElementById('time-popup'),
  );

  // Update button state when inputs change
  function updateButtonState() {
    const invalidDate = !!datePicker.value && !parseISODate(datePicker.value);
    datePicker.setAttribute('aria-invalid', String(invalidDate));
    datePicker.error = invalidDate ? 'Enter a valid date (YYYY-MM-DD).' : '';
    insertCustomBtn.toggleAttribute(
      'disabled',
      !parseISODate(datePicker.value) || !timePicker.validity.valid,
    );
  }
  updateButtonState();

  datePicker.addEventListener('input', updateButtonState);
  datePicker.addEventListener('change', updateButtonState);
  timePicker.addEventListener('input', updateButtonState);
  timePicker.addEventListener('change', updateButtonState);

  // Insert custom date/time on button click
  insertCustomBtn.addEventListener('click', () => {
    if (!insertCustomBtn.disabled) {
      const formatted = formatDateTime(datePicker.value, timePicker.value);
      insertText(actions, formatted, feedback);
    }
  });

  // Allow pressing Enter to insert
  function handleEnter(e) {
    if (e.key === 'Enter' && !insertCustomBtn.disabled) {
      e.preventDefault();
      const formatted = formatDateTime(datePicker.value, timePicker.value);
      insertText(actions, formatted, feedback);
    }
  }

  datePicker.addEventListener('keydown', handleEnter);
  timePicker.addEventListener('keydown', handleEnter);
}());
