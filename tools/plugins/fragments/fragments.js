/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { crawl } from 'https://da.live/nx/public/utils/tree.js';

const FRAGMENTS_BASE = '/fragments';
const CRAWL_THROTTLE = 10;
const LOCALE_PATTERN = /^[a-z]{2}(-[a-z]{2,4})?$/i;
const DA_ADMIN = 'https://admin.da.live';

let selectedFragment = null;
let currentPageLocale = null;

function isLocaleFolder(name) {
  return LOCALE_PATTERN.test(name);
}

function stripOrgRepoPrefix(path, org, repo) {
  const prefix = `/${org}/${repo}`;
  return path.startsWith(prefix) ? path.substring(prefix.length) || '/' : path;
}

function isFolderItem(item) {
  return !item.ext && !item.name.includes('.') && item.name !== 'drafts';
}

function setFolderIconState(folderIcon, isExpanded) {
  if (!folderIcon) return;
  folderIcon.classList.toggle('folder-icon', !isExpanded);
  folderIcon.classList.toggle('folder-open-icon', isExpanded);
}

/**
 * Extract locale from a path (e.g., "/en-us/products/page" → "en-us")
 * @param {string} path - The path to extract locale from
 * @returns {string|null} The locale if found, null otherwise
 */
function extractLocaleFromPath(path) {
  const segments = path.split('/').filter(Boolean);
  if (segments.length > 0 && isLocaleFolder(segments[0])) {
    return segments[0];
  }
  return null;
}

/**
 * Discover all "fragments" folders at levels 0, 1, or 2
 * @param {string} org - Organization name
 * @param {string} repo - Repository name
 * @param {string} token - Auth token
 * @returns {Promise<Array>} Array of discovered fragment roots with metadata
 */
async function discoverFragmentRoots(org, repo, token) {
  const roots = [];

  try {
    const level0Path = `${DA_ADMIN}/list/${org}/${repo}/fragments`;
    const response = await fetch(level0Path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      roots.push({
        path: '/fragments',
        locale: null,
        depth: 1,
        label: '/fragments',
      });
    }
  } catch (error) {
    // Ignore
  }

  try {
    const rootListPath = `${DA_ADMIN}/list/${org}/${repo}`;
    const response = await fetch(rootListPath, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const data = await response.json();
      const folders = data.filter(isFolderItem);

      const level1Checks = folders.map(async (folder) => {
        const folderPath = stripOrgRepoPrefix(folder.path || `/${folder.name}`, org, repo);
        const folderName = folder.name;
        const fragmentsPath = `${DA_ADMIN}/list/${org}/${repo}${folderPath}/fragments`;

        try {
          const fragResponse = await fetch(fragmentsPath, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (fragResponse.ok) {
            const locale = isLocaleFolder(folderName) ? folderName : null;
            roots.push({
              path: `${folderPath}/fragments`,
              locale,
              depth: 2,
              label: `${folderPath}/fragments`,
            });
          }
        } catch (err) {
          // Ignore
        }
      });

      await Promise.all(level1Checks);

      const level2Checks = folders.map(async (folder) => {
        const folderPath = stripOrgRepoPrefix(folder.path || `/${folder.name}`, org, repo);

        try {
          const subListPath = `${DA_ADMIN}/list/${org}/${repo}${folderPath}`;
          const subResponse = await fetch(subListPath, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (subResponse.ok) {
            const subData = await subResponse.json();
            const subFolders = subData.filter(isFolderItem);

            const level2FragmentChecks = subFolders.map(async (subFolder) => {
              const subFolderPath = stripOrgRepoPrefix(
                subFolder.path || `${folderPath}/${subFolder.name}`,
                org,
                repo,
              );

              const fragmentsPath = `${DA_ADMIN}/list/${org}/${repo}${subFolderPath}/fragments`;

              try {
                const fragResponse = await fetch(fragmentsPath, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (fragResponse.ok) {
                  const pathSegments = subFolderPath.split('/').filter(Boolean);
                  const locale = pathSegments.length === 2 && isLocaleFolder(pathSegments[1])
                    ? pathSegments[1] : null;
                  roots.push({
                    path: `${subFolderPath}/fragments`,
                    locale,
                    depth: 3,
                    label: `${subFolderPath}/fragments`,
                  });
                }
              } catch (err) {
                // Ignore
              }
            });

            await Promise.all(level2FragmentChecks);
          }
        } catch (err) {
          // Ignore
        }
      });

      await Promise.all(level2Checks);
    }
  } catch (error) {
    // Ignore
  }

  return roots.sort((a, b) => {
    if (!a.locale && b.locale) return -1;
    if (a.locale && !b.locale) return 1;
    return a.label.localeCompare(b.label);
  });
}

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

    const fragmentIcon = document.createElement('span');
    fragmentIcon.className = 'tree-icon fragment-icon';
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

    const folderIcon = document.createElement('span');
    folderIcon.className = 'tree-icon folder-icon';
    folderIcon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'folder-name';
    label.textContent = name;

    folderButton.appendChild(folderIcon);
    folderButton.appendChild(label);

    const toggleFolder = () => {
      folderButton.classList.toggle('expanded');
      const isExpanded = folderButton.classList.contains('expanded');
      folderButton.setAttribute('aria-expanded', isExpanded);

      setFolderIconState(folderIcon, isExpanded);

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

function expandToDepth(item, currentDepth, targetDepth) {
  const folderBtn = item.querySelector('.folder-btn');
  const list = item.querySelector('.tree-list');

  if (folderBtn && list && currentDepth <= targetDepth) {
    folderBtn.classList.add('expanded');
    folderBtn.setAttribute('aria-expanded', 'true');
    setFolderIconState(folderBtn.querySelector('.tree-icon'), true);
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
    let isMatch = false;

    // Check fragment file names
    const fragmentBtn = item.querySelector('.fragment-btn-item');
    if (fragmentBtn && fragmentBtn.textContent.toLowerCase().includes(searchLower)) {
      isMatch = true;
    }

    // Check folder names
    const folderBtn = item.querySelector('.folder-btn');
    if (folderBtn) {
      const folderName = folderBtn.querySelector('.folder-name');
      if (folderName && folderName.textContent.toLowerCase().includes(searchLower)) {
        isMatch = true;
      }
    }

    // If this item matches, add it and all parent folders to matching paths
    if (isMatch) {
      let current = item;
      while (current && current.classList.contains('tree-item')) {
        matchingPaths.add(current);
        current = current.parentElement.closest('.tree-item');
      }
    }
  });

  return matchingPaths;
}

function highlightText(text, searchText) {
  if (!searchText) return text;
  const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function applyFilterToTree(items, matchingPaths, searchText = '') {
  items.forEach((item) => {
    const isMatching = matchingPaths.has(item);
    item.classList.toggle('hidden', !isMatching);

    const fragmentBtn = item.querySelector('.fragment-btn-item');
    if (fragmentBtn && searchText) {
      const textSpan = fragmentBtn.querySelector('span:not(.tree-icon)');
      if (textSpan) {
        const originalText = textSpan.textContent;
        textSpan.innerHTML = highlightText(originalText, searchText);
      }
    }

    const folderBtn = item.querySelector('.folder-btn');
    const list = item.querySelector('.tree-list');
    if (folderBtn && list && isMatching) {
      if (searchText) {
        const folderNameSpan = folderBtn.querySelector('.folder-name');
        if (folderNameSpan) {
          const originalText = folderNameSpan.textContent;
          folderNameSpan.innerHTML = highlightText(originalText, searchText);
        }
      }

      folderBtn.classList.add('expanded');
      folderBtn.setAttribute('aria-expanded', 'true');
      setFolderIconState(folderBtn.querySelector('.tree-icon'), true);
      list.classList.remove('hidden');
    }
  });
}

function clearHighlights(items) {
  items.forEach((item) => {
    const fragmentBtn = item.querySelector('.fragment-btn-item');
    if (fragmentBtn) {
      const textSpan = fragmentBtn.querySelector('span:not(.tree-icon)');
      if (textSpan && textSpan.innerHTML.includes('<mark')) {
        const plainText = textSpan.textContent;
        textSpan.textContent = plainText;
      }
    }

    const folderBtn = item.querySelector('.folder-btn');
    if (folderBtn) {
      const folderNameSpan = folderBtn.querySelector('.folder-name');
      if (folderNameSpan && folderNameSpan.innerHTML.includes('<mark')) {
        const plainText = folderNameSpan.textContent;
        folderNameSpan.textContent = plainText;
      }
    }
  });
}

function resetTreeToDefaultState(items) {
  const targetDepth = FRAGMENTS_BASE.split('/').filter(Boolean).length;

  items.forEach((item) => {
    item.classList.remove('hidden');

    const depth = getItemDepth(item);
    const folderBtn = item.querySelector(':scope > .tree-item-content > .folder-btn');
    const list = item.querySelector(':scope > .tree-list');

    if (folderBtn && list) {
      const shouldExpand = depth <= targetDepth;
      folderBtn.classList.toggle('expanded', shouldExpand);
      folderBtn.setAttribute('aria-expanded', shouldExpand);
      setFolderIconState(folderBtn.querySelector('.tree-icon'), shouldExpand);
      list.classList.toggle('hidden', !shouldExpand);
    }
  });
}

function filterFragments(searchText, fragmentsList) {
  const browser = fragmentsList.querySelector('.fragments-browser');

  if (browser) {
    const sections = browser.querySelectorAll('.fragments-column');

    if (!searchText) {
      sections.forEach((section) => {
        const header = section.querySelector('.fragments-column-header');
        const content = section.querySelector('.fragments-column-content');
        const items = content.querySelectorAll('.tree-item');
        const { locale } = section.dataset;

        items.forEach((item) => item.classList.remove('hidden'));
        clearHighlights(items);
        resetTreeToDefaultState(items);

        const shouldBeExpanded = (locale !== 'default' && locale === currentPageLocale)
          || (locale === 'default' && !currentPageLocale);

        if (shouldBeExpanded) {
          header.setAttribute('aria-expanded', 'true');
          header.querySelector('.header-icon').classList.add('expanded');
          content.classList.remove('hidden');
        } else {
          header.setAttribute('aria-expanded', 'false');
          header.querySelector('.header-icon').classList.remove('expanded');
          content.classList.add('hidden');
        }
      });
      return;
    }

    sections.forEach((section) => {
      const header = section.querySelector('.fragments-column-header');
      const content = section.querySelector('.fragments-column-content');
      const items = content.querySelectorAll('.tree-item');

      const matchingPaths = findMatchingItems(items, searchText);
      const hasMatches = matchingPaths.size > 0;

      if (hasMatches) {
        header.setAttribute('aria-expanded', 'true');
        header.querySelector('.header-icon').classList.add('expanded');
        content.classList.remove('hidden');
        applyFilterToTree(items, matchingPaths, searchText);
      } else {
        header.setAttribute('aria-expanded', 'false');
        header.querySelector('.header-icon').classList.remove('expanded');
        content.classList.add('hidden');
      }
    });
    return;
  }

  const items = fragmentsList.querySelectorAll('.tree-item');

  if (!searchText) {
    clearHighlights(items);
    resetTreeToDefaultState(items);
    return;
  }

  const matchingPaths = findMatchingItems(items, searchText);
  applyFilterToTree(items, matchingPaths, searchText);
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
    const { context: loadContext, token } = await DA_SDK;
    const basePath = `/${loadContext.org}/${loadContext.repo}`;
    const currentLocale = extractLocaleFromPath(loadContext.path || '');
    currentPageLocale = currentLocale; // Store for search filtering

    // Discover all fragment roots
    const discoveredRoots = await discoverFragmentRoots(
      loadContext.org,
      loadContext.repo,
      token,
    );

    // Fallback to hardcoded /fragments if no roots discovered
    if (discoveredRoots.length === 0) {
      discoveredRoots.push({
        path: FRAGMENTS_BASE,
        locale: null,
        depth: 1,
        label: '/fragments',
      });
    }

    const rootsWithFiles = await Promise.all(
      discoveredRoots.map(async (root) => {
        const files = [];
        const fullPath = `/${loadContext.org}/${loadContext.repo}${root.path}`;

        const { results } = crawl({
          path: fullPath,
          callback: (file) => {
            if (file.path.endsWith('.html')) {
              files.push(file);
            }
          },
          throttle: CRAWL_THROTTLE,
        });

        await results;

        return { root, files };
      }),
    );

    fragmentsContainer.innerHTML = '';

    const rootsWithContent = rootsWithFiles.filter((r) => r.files.length > 0);

    if (rootsWithContent.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'No fragments found';
      fragmentsContainer.appendChild(emptyState);
      return;
    }

    if (rootsWithContent.length === 1) {
      const { root, files } = rootsWithContent[0];
      const stripPath = `${basePath}${root.path}`;
      const tree = createFileTree(files, stripPath);
      const targetDepth = root.depth;

      Object.entries(tree)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, node]) => {
          const item = createTreeItem(name, node, loadContext, root);
          fragmentsContainer.appendChild(item);
          expandToDepth(item, 1, targetDepth);
        });
      return;
    }

    const browser = document.createElement('div');
    browser.className = 'fragments-browser';

    rootsWithContent.forEach(({ root, files }) => {
      const column = document.createElement('div');
      column.className = 'fragments-column';
      column.dataset.locale = root.locale || 'default';

      const shouldAutoExpand = root.locale === currentLocale;

      const header = document.createElement('button');
      header.className = 'fragments-column-header';
      header.type = 'button';
      header.setAttribute('aria-expanded', shouldAutoExpand ? 'true' : 'false');

      const icon = document.createElement('span');
      icon.className = shouldAutoExpand ? 'header-icon expanded' : 'header-icon';
      icon.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.textContent = root.label;

      header.appendChild(icon);
      header.appendChild(label);

      const columnContent = document.createElement('div');
      columnContent.className = 'fragments-column-content';
      if (!shouldAutoExpand) {
        columnContent.classList.add('hidden');
      }

      header.addEventListener('click', () => {
        const isExpanded = header.getAttribute('aria-expanded') === 'true';

        if (!isExpanded) {
          browser.querySelectorAll('.fragments-column-header').forEach((otherHeader) => {
            if (otherHeader !== header) {
              otherHeader.setAttribute('aria-expanded', 'false');
              otherHeader.querySelector('.header-icon').classList.remove('expanded');
              otherHeader.parentElement.querySelector('.fragments-column-content').classList.add('hidden');
            }
          });
        }

        header.setAttribute('aria-expanded', !isExpanded);
        icon.classList.toggle('expanded');
        columnContent.classList.toggle('hidden');
      });

      column.appendChild(header);

      const stripPath = `${basePath}${root.path}`;
      const tree = createFileTree(files, stripPath);
      const targetDepth = root.depth;

      Object.entries(tree)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, node]) => {
          const item = createTreeItem(name, node, loadContext, root);
          columnContent.appendChild(item);
          if (shouldAutoExpand) {
            expandToDepth(item, 1, targetDepth);
          }
        });

      column.appendChild(columnContent);
      browser.appendChild(column);
    });

    fragmentsContainer.appendChild(browser);
  } catch (error) {
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
    showMessage('Initialization failed. Please refresh the page.', true);
  }
}());
