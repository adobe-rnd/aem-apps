export default function initTimePicker(input, trigger, popup) {
  const groups = [...popup.querySelectorAll('.time-options')];
  const preview = popup.querySelector('.time-preview');
  const field = trigger.closest('.time-field');
  const pad = (value) => String(value).padStart(2, '0');
  let hour = 0;
  let minute = 0;

  const values = {
    hour: [12, ...Array.from({ length: 11 }, (_, index) => index + 1)],
    minute: Array.from({ length: 60 }, (_, index) => index),
    period: ['AM', 'PM'],
  };
  groups.forEach((group) => {
    values[group.dataset.unit].forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'time-option';
      button.dataset.value = value;
      button.textContent = typeof value === 'number' ? pad(value) : value;
      button.setAttribute('role', 'option');
      group.append(button);
    });
  });

  function render() {
    const selected = {
      hour: String(hour % 12 || 12),
      minute: String(minute),
      period: hour >= 12 ? 'PM' : 'AM',
    };
    preview.textContent = `${pad(selected.hour)}:${pad(minute)} ${selected.period}`;
    groups.forEach((group) => {
      group.querySelectorAll('.time-option').forEach((button) => {
        const active = button.dataset.value === selected[group.dataset.unit];
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
    });
  }

  function readInput() {
    [hour, minute] = /^\d{2}:\d{2}$/.test(input.value)
      ? input.value.split(':').map(Number) : [0, 0];
    render();
  }

  function close(restoreFocus = false) {
    popup.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function apply(value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  }

  trigger.disabled = false;
  trigger.addEventListener('click', () => {
    if (!popup.hidden) {
      close();
      return;
    }
    readInput();
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    groups.forEach((group) => {
      group.querySelector('[aria-selected="true"]').scrollIntoView({ block: 'nearest' });
    });
    groups[0].querySelector('[aria-selected="true"]').focus();
  });

  popup.addEventListener('click', (event) => {
    const button = event.target.closest('button, sl-button');
    if (!button) return;
    if (button.dataset.timeAction === 'done') {
      apply(`${pad(hour)}:${pad(minute)}`);
    } else if (button.dataset.timeAction === 'clear') {
      apply('');
    } else if (button.classList.contains('time-option')) {
      const { unit } = button.closest('.time-options').dataset;
      if (unit === 'hour') {
        hour = (Number(button.dataset.value) % 12) + (hour >= 12 ? 12 : 0);
      } else if (unit === 'minute') {
        minute = Number(button.dataset.value);
      } else {
        hour = (hour % 12) + (button.dataset.value === 'PM' ? 12 : 0);
      }
      render();
    }
  });

  popup.addEventListener('keydown', (event) => {
    if (!event.target.matches('.time-option')) return;
    const group = event.target.closest('.time-options');
    const options = [...group.querySelectorAll('.time-option')];
    const index = options.indexOf(event.target);
    let target;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      target = Math.max(0, index - 1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      target = Math.min(options.length - 1, index + 1);
    } else if (event.key === 'Home') {
      target = 0;
    } else if (event.key === 'End') {
      target = options.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    options[target].focus();
  });

  popup.addEventListener('focusin', (event) => {
    if (!event.target.matches('.time-option')) return;
    event.target.closest('.time-options').querySelectorAll('.time-option').forEach((button) => {
      button.tabIndex = button === event.target ? 0 : -1;
    });
  });

  input.addEventListener('input', () => {
    if (!popup.hidden) readInput();
  });
  function dismissOutside(event) {
    // Finish pointer clicks before collapsing the in-flow popup.
    if (event.type === 'focusin' && event.target.matches(':active')) return;
    if (!popup.hidden && !field.contains(event.target)) close();
  }
  document.addEventListener('click', dismissOutside);
  document.addEventListener('focusin', dismissOutside);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !popup.hidden) {
      event.preventDefault();
      close(true);
    }
  });
}
