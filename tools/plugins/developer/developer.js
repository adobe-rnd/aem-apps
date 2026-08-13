/* eslint-disable import/no-unresolved, no-console */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { fetchBranches } from './api.js';

const REF_PARAM = 'ref';
const DEFAULT_REF = 'main';

const ERROR_MESSAGES = {
  unauthorized: 'You are not authorized to view branches for this site.',
  'not-found': 'No branches found — check that the organization and site are correct.',
  network: 'Could not reach the admin API. Check your connection and try again.',
};

function setStatus(text, type = '') {
  const el = document.getElementById('status-message');
  el.textContent = text;
  el.className = `status-message ${type}`.trim();
}

function populateBranches(select, branches, selected) {
  select.innerHTML = '';

  // Empty entry, always first — selecting it removes the ref param entirely.
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = '';
  if (selected === '') emptyOption.selected = true;
  select.append(emptyOption);

  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch;
    option.textContent = branch;
    if (branch === selected) option.selected = true;
    select.append(option);
  });
}

async function init() {
  const select = document.getElementById('branch-select');
  const branchField = document.getElementById('branch-field');
  const { actions, context, token } = await DA_SDK;
  const { org, repo } = context;

  setStatus('Loading branches…', 'loading');

  const { branches, error } = await fetchBranches(org, repo, token);

  if (error) {
    setStatus(ERROR_MESSAGES[error] || `Failed to load branches: ${error}`, 'error');
    return;
  }

  if (branches.length === 0) {
    setStatus('No branches found.', 'error');
    return;
  }

  // context.ref reflects the current ?ref= on the top-level page (as
  // parsed by the DA shell), so it doubles as the currently-selected
  // branch — no need to track it ourselves.
  const { ref } = context;
  let preselected = branches.includes(DEFAULT_REF) ? DEFAULT_REF : branches[0];
  if (branches.includes(ref)) {
    preselected = ref;
  }
  populateBranches(select, branches, preselected);
  branchField.hidden = false;
  setStatus('');

  select.addEventListener('change', () => {
    const branch = select.value;

    // We can't read the top-level page's query params from inside this
    // iframe (cross-origin), so the target URL is rebuilt from scratch
    // using the DA SDK context instead of mutating the existing one. An
    // empty selection means "no ref" — the param is omitted entirely.
    const { path, view } = context;
    const query = branch ? `?${REF_PARAM}=${branch}` : '';
    const topUrl = `/${view}${query}#/${org}/${repo}${path}`;

    actions.setHref(topUrl);
  });
}

init();
