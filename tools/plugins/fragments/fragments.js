// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { crawl } from 'https://da.live/nx/public/utils/tree.js';

const FRAGMENTS_BASE = '/fragments';

const CONSTANTS = {
  CRAWL_THROTTLE: 10,
  ICONS: {
    FOLDER: './img/Smock_Folder_18_N.svg',
    FOLDER_OPEN: './img/Smock_FolderOpen_18_N.svg',
    FRAGMENT: './img/Smock_DocumentFragment_18_N.svg',
  },
};

let selectedFragment = null;

function showMessage(text, isError = false, autoHide = false) {
  const message = document.querySelector('.feedback-message');
  const msgContainer = document.querySelector('.message-wrapper');

  if (!message || !msgContainer) return;

  message.textContent = text;
  message.classList.toggle('error', isError);
  msgContainer.classList.remove('hidden');

  if (autoHide && !isError) {
    msgContainer.classList.add('auto-hide');
    const handleAnimationEnd = () => {
      msgContainer.classList.add('hidden');
      msgContainer.classList.remove('auto-hide');
      msgContainer.removeEventListener('animationend', handleAnimationEnd);
    };
    msgContainer.addEventListener('animationend', handleAnimationEnd);
  }
}

function createFileTree(files, basePath) {
  const tree = {};
  files.forEach((file) => {
    const displayPath = file.path.replace(basePath, '');
    const parts = displayPath.split('/').filter(Boolean);
    let current = tree;
    parts.forEach((part, i) => {
      if (!current[part]) {
        current[part] = {
          isFile: i === parts.length - 1 && file.path.endsWith('.html'),
          children: {},
          path: file.path,
        };
      }
      current = current[part].children;
    });
  });
  return tree;
}

function showPreview(fragmentPath, fragmentName, context, fragmentElement) {
  const iframe = document.querySelector('.preview-iframe');
  const placeholder = document.querySelector('.preview-placeholder');
  const insertBtn = document.querySelector('.insert-btn');

  if (!iframe || !placeholder || !insertBtn) return;

  const basePath = `/${context.org}/${context.repo}`;
  const displayPath = fragmentPath.replace(basePath, '').replace(/\.html$/, '');
  const previewUrl = `https://main--${context.repo}--${context.org}.aem.page${displayPath}`;

  if (selectedFragment && selectedFragment.element) {
    selectedFragment.element.classList.remove('selected');
    selectedFragment.element.classList.add('was-selected');
  }

  selectedFragment = {
    path: fragmentPath,
    name: fragmentName,
    element: fragmentElement,
  };

  if (fragmentElement) {
    fragmentElement.classList.remove('was-selected');
    fragmentElement.classList.add('selected');
  }

  insertBtn.disabled = false;
  insertBtn.setAttribute('aria-label', `Insert fragment "${fragmentName}"`);

  iframe.src = previewUrl;
  iframe.classList.remove('hidden');
  placeholder.classList.add('hidden');
}

function createTreeItem(name, node, context) {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.setAttribute('role', 'listitem');

  const content = document.createElement('div');
  content.className = 'tree-item-content';

  if (node.isFile) {
    const button = document.createElement('button');
    button.className = 'fragment-btn-item';
    button.setAttribute('role', 'button');
    const displayName = name.replace('.html', '');
    button.setAttribute('aria-label', `Preview fragment "${displayName}"`);

    const fragmentIcon = document.createElement('img');
    fragmentIcon.src = CONSTANTS.ICONS.FRAGMENT;
    fragmentIcon.alt = 'Fragment';
    fragmentIcon.className = 'tree-icon';
    fragmentIcon.setAttribute('aria-hidden', 'true');

    const textSpan = document.createElement('span');
    textSpan.textContent = displayName;

    button.appendChild(fragmentIcon);
    button.appendChild(textSpan);
    button.title = `Click to preview "${displayName}"`;

    button.addEventListener('click', () => {
      showPreview(node.path, displayName, context, item);
    });

    content.appendChild(button);
  } else {
    const folderButton = document.createElement('button');
    folderButton.className = 'folder-btn';
    folderButton.setAttribute('role', 'button');
    folderButton.setAttribute('aria-expanded', 'false');
    folderButton.setAttribute('aria-label', `Folder ${name}`);

    const folderIcon = document.createElement('img');
    folderIcon.src = CONSTANTS.ICONS.FOLDER;
    folderIcon.alt = '';
    folderIcon.className = 'tree-icon folder-icon';
    folderIcon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'folder-name';
    label.textContent = name;

    folderButton.appendChild(folderIcon);
    folderButton.appendChild(label);

    const toggleFolder = () => {
      folderButton.classList.toggle('expanded');
      folderButton.setAttribute('aria-expanded', folderButton.classList.contains('expanded'));
      folderIcon.src = folderButton.classList.contains('expanded')
        ? CONSTANTS.ICONS.FOLDER_OPEN
        : CONSTANTS.ICONS.FOLDER;
      const list = item.querySelector('.tree-list');
      if (list) {
        list.classList.toggle('hidden');
      }
    };

    folderButton.addEventListener('click', toggleFolder);
    content.appendChild(folderButton);

    if (Object.keys(node.children).length > 0) {
      const list = document.createElement('div');
      list.className = 'tree-list hidden';
      list.setAttribute('role', 'list');

      Object.entries(node.children)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([childName, childNode]) => {
          list.appendChild(createTreeItem(childName, childNode, context));
        });

      item.appendChild(content);
      item.appendChild(list);
    }
  }

  if (!content.parentElement) {
    item.appendChild(content);
  }

  return item;
}

function handleFragmentInsert(actions, context) {
  if (!selectedFragment) {
    showMessage('No fragment selected', true);
    return;
  }

  if (!actions?.sendHTML) {
    showMessage('Cannot insert fragment: Editor not available', true);
    return;
  }

  try {
    const basePath = `/${context.org}/${context.repo}`;
    const displayPath = selectedFragment.path.replace(basePath, '').replace(/\.html$/, '');

    if (!/^[a-zA-Z0-9/_.-]+$/.test(displayPath)) {
      // eslint-disable-next-line no-console
      console.error('Invalid fragment path:', displayPath);
      showMessage('Invalid fragment path', true);
      return;
    }

    const fragmentUrl = `https://main--${context.repo}--${context.org}.aem.page${displayPath}`;
    const link = document.createElement('a');
    link.href = fragmentUrl;
    link.className = 'fragment';
    link.textContent = fragmentUrl;
    actions.sendHTML(link.outerHTML);
    showMessage('Fragment inserted successfully', false, true);
    actions.closeLibrary();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to insert fragment:', error);
    showMessage('Failed to insert fragment', true);
  }
}

function getItemDepth(item) {
  let depth = 0;
  let current = item;
  while (current && current.classList.contains('tree-item')) {
    depth += 1;
    current = current.parentElement.closest('.tree-item');
  }
  return depth;
}

function getBasePathDepth() {
  return FRAGMENTS_BASE.split('/').filter(Boolean).length;
}

function expandToDepth(item, currentDepth, targetDepth) {
  const folderBtn = item.querySelector('.folder-btn');
  const list = item.querySelector('.tree-list');

  if (folderBtn && list && currentDepth <= targetDepth) {
    folderBtn.classList.add('expanded');
    folderBtn.setAttribute('aria-expanded', 'true');
    const folderIcon = folderBtn.querySelector('.folder-icon');
    if (folderIcon) {
      folderIcon.src = CONSTANTS.ICONS.FOLDER_OPEN;
    }
    list.classList.remove('hidden');

    const childFolders = list.querySelectorAll(':scope > .tree-item');
    childFolders.forEach((childItem) => {
      expandToDepth(childItem, currentDepth + 1, targetDepth);
    });
  }
}

function findMatchingItems(items, searchText) {
  const matchingPaths = new Set();
  const searchLower = searchText.toLowerCase();

  items.forEach((item) => {
    const button = item.querySelector('.fragment-btn-item');
    if (button && button.textContent.toLowerCase().includes(searchLower)) {
      let current = item;
      while (current && current.classList.contains('tree-item')) {
        matchingPaths.add(current);
        current = current.parentElement.closest('.tree-item');
      }
    }
  });

  return matchingPaths;
}

function applyFilterToTree(items, matchingPaths) {
  items.forEach((item) => {
    const isMatching = matchingPaths.has(item);
    item.classList.toggle('hidden', !isMatching);

    const folderBtn = item.querySelector('.folder-btn');
    const list = item.querySelector('.tree-list');
    if (folderBtn && list && isMatching) {
      folderBtn.classList.add('expanded');
      folderBtn.setAttribute('aria-expanded', 'true');
      const folderIcon = folderBtn.querySelector('.folder-icon');
      if (folderIcon) {
        folderIcon.src = CONSTANTS.ICONS.FOLDER_OPEN;
      }
      list.classList.remove('hidden');
    }
  });
}

function resetTreeToDefaultState(items) {
  const targetDepth = getBasePathDepth();

  items.forEach((item) => {
    item.classList.remove('hidden');

    const depth = getItemDepth(item);
    const folderBtn = item.querySelector(':scope > .tree-item-content > .folder-btn');
    const list = item.querySelector(':scope > .tree-list');

    if (folderBtn && list) {
      if (depth <= targetDepth) {
        folderBtn.classList.add('expanded');
        folderBtn.setAttribute('aria-expanded', 'true');
        const folderIcon = folderBtn.querySelector('.folder-icon');
        if (folderIcon) {
          folderIcon.src = CONSTANTS.ICONS.FOLDER_OPEN;
        }
        list.classList.remove('hidden');
      } else {
        folderBtn.classList.remove('expanded');
        folderBtn.setAttribute('aria-expanded', 'false');
        const folderIcon = folderBtn.querySelector('.folder-icon');
        if (folderIcon) {
          folderIcon.src = CONSTANTS.ICONS.FOLDER;
        }
        list.classList.add('hidden');
      }
    }
  });
}

function filterFragments(searchText, fragmentsList) {
  const items = fragmentsList.querySelectorAll('.tree-item');

  if (!searchText) {
    resetTreeToDefaultState(items);
    return;
  }

  const matchingPaths = findMatchingItems(items, searchText);
  applyFilterToTree(items, matchingPaths);
}

async function loadFragments() {
  const fragmentsContainer = document.querySelector('.fragments-list');

  if (!fragmentsContainer.querySelector('.loading-state')) {
    const loadingState = document.createElement('div');
    loadingState.className = 'loading-state';
    loadingState.textContent = 'Loading fragments...';
    fragmentsContainer.innerHTML = '';
    fragmentsContainer.appendChild(loadingState);
  }

  try {
    const files = [];
    const { context: loadContext, token } = await DA_SDK;
    const path = `/${loadContext.org}/${loadContext.repo}${FRAGMENTS_BASE}`;
    const basePath = `/${loadContext.org}/${loadContext.repo}`;

    const { results } = crawl({
      path,
      callback: (file) => {
        if (file.path.endsWith('.html')) {
          files.push(file);
        }
      },
      throttle: CONSTANTS.CRAWL_THROTTLE,
      mode: 'horizontal',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    await results;

    fragmentsContainer.innerHTML = '';

    if (files.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'loading-state';
      emptyState.textContent = 'No fragments found';
      fragmentsContainer.appendChild(emptyState);
      return;
    }

    const tree = createFileTree(files, basePath);
    const targetDepth = getBasePathDepth();

    Object.entries(tree)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([name, node]) => {
        const item = createTreeItem(name, node, loadContext);
        fragmentsContainer.appendChild(item);
        expandToDepth(item, 1, targetDepth);
      });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load fragments:', error);

    const errorState = document.createElement('div');
    errorState.className = 'error-state';

    const errorText = document.createElement('p');
    errorText.textContent = 'Failed to load fragments.';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.type = 'button';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', loadFragments);

    errorState.appendChild(errorText);
    errorState.appendChild(retryBtn);
    fragmentsContainer.innerHTML = '';
    fragmentsContainer.appendChild(errorState);

    showMessage('Failed to load fragments. Click Retry to try again.', true);
  }
}

(async function init() {
  try {
    const { actions, context } = await DA_SDK;
    const fragmentsList = document.querySelector('.fragments-list');
    const searchInput = document.querySelector('.fragment-search');
    const insertBtn = document.querySelector('.insert-btn');

    searchInput.addEventListener('input', (e) => {
      filterFragments(e.target.value, fragmentsList);
    });

    insertBtn.addEventListener('click', () => {
      handleFragmentInsert(actions, context);
    });

    fragmentsList.addEventListener('keydown', (e) => {
      const allFragments = Array.from(fragmentsList.querySelectorAll('.fragment-btn-item'));
      if (allFragments.length === 0) return;

      const currentIndex = allFragments.findIndex((btn) => btn === document.activeElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % allFragments.length;
        allFragments[nextIndex].focus();
        allFragments[nextIndex].click();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex <= 0 ? allFragments.length - 1 : currentIndex - 1;
        allFragments[prevIndex].focus();
        allFragments[prevIndex].click();
      } else if (e.key === 'Enter' && currentIndex >= 0) {
        e.preventDefault();
        insertBtn.click();
      }
    });

    await loadFragments();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Initialization failed:', error);
    showMessage('Initialization failed. Please refresh the page.', true);
  }
}());
