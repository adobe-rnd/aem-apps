function createDate(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}

export function formatISODate(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function parseISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) return undefined;
  const date = createDate(year, month - 1, day);
  return formatISODate(date) === value ? date : undefined;
}

export function getToday() {
  const now = new Date();
  return createDate(now.getFullYear(), now.getMonth(), now.getDate());
}

function moveMonth(date, offset) {
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + offset;
  const boundedIndex = Math.max(12, Math.min(119999, monthIndex));
  const year = Math.floor(boundedIndex / 12);
  const month = boundedIndex % 12;
  const lastDay = createDate(year, month + 1, 0).getUTCDate();
  return createDate(year, month, Math.min(date.getUTCDate(), lastDay));
}

export default function initDateCalendar(datePicker, trigger, calendar) {
  const heading = calendar.querySelector('#calendar-month');
  const grid = calendar.querySelector('tbody');
  const previous = calendar.querySelector('[data-month="-1"]');
  const next = calendar.querySelector('[data-month="1"]');
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  const dayLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  let focusedDate = getToday();

  function render(focus = false) {
    const year = focusedDate.getUTCFullYear();
    const month = focusedDate.getUTCMonth();
    const firstDay = createDate(year, month, 1).getUTCDay();
    const days = createDate(year, month + 1, 0).getUTCDate();
    const selected = datePicker.value;
    const today = formatISODate(getToday());
    heading.textContent = monthLabel.format(focusedDate);
    previous.disabled = year === 1 && month === 0;
    next.disabled = year === 9999 && month === 11;
    const rows = document.createDocumentFragment();
    for (let week = 0; week < 6; week += 1) {
      const row = document.createElement('tr');
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const cell = document.createElement('td');
        const day = week * 7 + weekday - firstDay + 1;
        if (day > 0 && day <= days) {
          const date = createDate(year, month, day);
          const value = formatISODate(date);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'calendar-day';
          button.dataset.date = value;
          button.textContent = day;
          button.setAttribute('aria-label', dayLabel.format(date));
          cell.setAttribute('aria-selected', String(value === selected));
          button.classList.toggle('selected', value === selected);
          if (value === today) button.setAttribute('aria-current', 'date');
          button.tabIndex = day === focusedDate.getUTCDate() ? 0 : -1;
          cell.append(button);
        }
        row.append(cell);
      }
      rows.append(row);
    }
    grid.replaceChildren(rows);
    if (focus) grid.querySelector('[tabindex="0"]').focus();
  }

  function close(restoreFocus = false) {
    calendar.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function select(value) {
    datePicker.value = value;
    datePicker.dispatchEvent(new Event('input', { bubbles: true }));
    datePicker.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  }

  trigger.disabled = false;
  trigger.addEventListener('click', () => {
    if (!calendar.hidden) {
      close();
      return;
    }
    focusedDate = parseISODate(datePicker.value) || getToday();
    calendar.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    render(true);
  });

  calendar.addEventListener('click', (event) => {
    const button = event.target.closest('button, sl-button');
    if (!button) return;
    if (button.dataset.date) {
      select(button.dataset.date);
    } else if (button.dataset.month) {
      focusedDate = moveMonth(focusedDate, Number(button.dataset.month));
      render();
    } else if (button.dataset.calendarAction === 'today') {
      select(formatISODate(getToday()));
    } else if (button.dataset.calendarAction === 'clear') {
      select('');
    }
  });

  grid.addEventListener('keydown', (event) => {
    if (!event.target.matches('.calendar-day')) return;
    const date = parseISODate(event.target.dataset.date);
    const offsets = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -date.getUTCDay(),
      End: 6 - date.getUTCDay(),
    };
    let target;
    if (offsets[event.key] !== undefined) {
      target = createDate(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() + offsets[event.key],
      );
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const amount = event.shiftKey ? 12 : 1;
      target = moveMonth(date, event.key === 'PageUp' ? -amount : amount);
    } else {
      return;
    }
    event.preventDefault();
    if (target.getUTCFullYear() < 1 || target.getUTCFullYear() > 9999) return;
    focusedDate = target;
    render(true);
  });

  grid.addEventListener('focusin', (event) => {
    if (!event.target.matches('.calendar-day')) return;
    focusedDate = parseISODate(event.target.dataset.date);
    grid.querySelectorAll('.calendar-day').forEach((button) => {
      button.tabIndex = button === event.target ? 0 : -1;
    });
  });

  datePicker.addEventListener('input', () => {
    if (calendar.hidden) return;
    focusedDate = parseISODate(datePicker.value) || getToday();
    render();
  });

  const dateField = trigger.closest('.date-field');
  function dismissOutside(event) {
    // Finish pointer clicks before collapsing the in-flow popup.
    if (event.type === 'focusin' && event.target.matches(':active')) return;
    if (!calendar.hidden && !calendar.contains(event.target)
      && !dateField.contains(event.target)) close();
  }
  document.addEventListener('click', dismissOutside);
  document.addEventListener('focusin', dismissOutside);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !calendar.hidden) {
      event.preventDefault();
      close(true);
    }
  });
}
