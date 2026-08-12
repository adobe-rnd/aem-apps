// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

const DEFAULT_TAXONOMY_PATH = '/taxonomy.json';

/**
 * Resolves where to fetch the taxonomy sheet from. Defaults to
 * `taxonomy.json` at the current site's DA source root, but a site can
 * point this plugin at a different location via a `taxonomy` query param
 * on the plugin URL (set in the DA config library's `path` column), e.g.
 * `tags.html?taxonomy=/config/taxonomy.json`. The param can be either a
 * path within this site's DA source, or a full DA source URL (`https://
 * admin.da.live/source/{org}/{repo}/...`) to share one taxonomy sheet
 * across multiple sites/orgs.
 * @param {string} org Organization name
 * @param {string} repo Repository name
 * @returns {string} The DA source URL to fetch the taxonomy sheet from
 */
function resolveTaxonomyUrl(org, repo) {
  const params = new URLSearchParams(window.location.search);
  const taxonomyParam = params.get('taxonomy');

  if (!taxonomyParam) return `${DA_ORIGIN}/source/${org}/${repo}${DEFAULT_TAXONOMY_PATH}`;
  if (/^https?:\/\//i.test(taxonomyParam)) return taxonomyParam;

  const path = taxonomyParam.startsWith('/') ? taxonomyParam : `/${taxonomyParam}`;
  return `${DA_ORIGIN}/source/${org}/${repo}${path}`;
}

/**
 * Fetches the taxonomy sheet's DA source (not the published site) so
 * authors see taxonomy edits immediately, without waiting for a publish.
 * @param {Object} actions DA actions object
 * @param {string} taxonomyUrl DA source URL of the taxonomy sheet
 * @returns {Promise<Object|null>} The taxonomy JSON data, or null on failure
 */
async function fetchTaxonomy(actions, taxonomyUrl) {
  try {
    const response = await actions.daFetch(taxonomyUrl);

    if (!response.ok) {
      console.error(`Failed to fetch taxonomy: ${response.status} ${response.statusText}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching taxonomy:', error);
    return null;
  }
}

/**
 * Walks the taxonomy sheet's flat rows into a list of selectable tags. A
 * row with only `Namespace` (and/or `Category`) set is a section header,
 * not a tag — it updates the namespace/category every later row with a
 * `Tag` inherits, until the next header row changes it. A namespace header
 * resets the category (a category only applies within one namespace).
 * Nested categories don't need special handling here — a sheet row's
 * `Category` cell can itself already contain `/`-separated levels (e.g.
 * `catlev1/catlev2`), and since this only ever treats `Category` as an
 * opaque string, that nesting just carries straight through into `path`.
 *
 * Each entry's `path` (`Namespace:Category/Tag`, or `Namespace/Tag` with no
 * category) is what actually gets sent to the document — keeps imported
 * and author-picked tags in the same format, and distinguishable even when
 * the same leaf tag name exists under more than one namespace (e.g.
 * "Race Recap" under both "Article Types" and "Tag Driven").
 * @param {Object[]} rows Raw `taxonomy.json` `data` rows
 * @returns {Object[]} `{ namespace, category, tag, path, description }`
 *   entries, one per selectable tag
 */
function parseTaxonomy(rows) {
  const tags = [];
  let namespace = '';
  let category = '';

  rows.forEach((row) => {
    if (row.Tag) {
      const path = category ? `${namespace}:${category}/${row.Tag}` : `${namespace}/${row.Tag}`;
      tags.push({
        namespace, category, tag: row.Tag, path, description: row.Description || '',
      });
      return;
    }
    if (row.Namespace) {
      namespace = row.Namespace;
      category = '';
    }
    if (row.Category) category = row.Category;
  });

  return tags;
}

/**
 * Renders the (already-filtered) tag list, grouped under a collapsible
 * heading per namespace, preserving the order namespaces first appear in.
 * A namespace renders expanded when it isn't in `collapsedNamespaces`, or
 * regardless of that, whenever `isSearching` is true — so an active search
 * always surfaces matches inside a namespace the author had collapsed,
 * without losing their manual collapse state once the search is cleared.
 * @param {Element} resultsContainer
 * @param {Object[]} tags Tags to render, each carrying its own `index`
 *   into the full tag list (used as the `selectedTags` key)
 * @param {Set<number>} selectedTags
 * @param {Set<string>} collapsedNamespaces Namespaces the author collapsed
 * @param {boolean} isSearching
 * @param {Function} onToggleTag Called with a tag's `index` and the
 *   checkbox's new checked state when it's toggled
 * @param {Function} onToggleNamespace Called with a namespace name when
 *   its heading is clicked
 */
function renderTagList(
  resultsContainer,
  tags,
  selectedTags,
  collapsedNamespaces,
  isSearching,
  onToggleTag,
  onToggleNamespace,
) {
  resultsContainer.innerHTML = '';

  if (tags.length === 0) {
    const noResultsDiv = document.createElement('div');
    noResultsDiv.className = 'no-results';
    noResultsDiv.textContent = 'No tags found matching your search';
    resultsContainer.appendChild(noResultsDiv);
    return;
  }

  const namespaces = new Map();
  tags.forEach((tag) => {
    if (!namespaces.has(tag.namespace)) namespaces.set(tag.namespace, []);
    namespaces.get(tag.namespace).push(tag);
  });

  namespaces.forEach((namespaceTags, namespace) => {
    const expanded = isSearching || !collapsedNamespaces.has(namespace);

    if (namespace) {
      const heading = document.createElement('button');
      heading.type = 'button';
      heading.className = 'tag-namespace';
      heading.setAttribute('aria-expanded', String(expanded));

      const caret = document.createElement('span');
      caret.className = 'tag-namespace-caret';
      caret.textContent = expanded ? '▾' : '▸';
      heading.appendChild(caret);

      const label = document.createElement('span');
      label.textContent = namespace;
      heading.appendChild(label);

      heading.addEventListener('click', () => onToggleNamespace(namespace));
      resultsContainer.appendChild(heading);
    }

    if (!expanded) return;

    namespaceTags.forEach((tag) => {
      const tagItem = document.createElement('div');
      tagItem.className = 'tag-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'tag-checkbox';
      checkbox.checked = selectedTags.has(tag.index);
      checkbox.addEventListener('change', (e) => onToggleTag(tag.index, e.target.checked));

      const tagInfo = document.createElement('div');
      tagInfo.className = 'tag-info';

      const tagValueRow = document.createElement('div');
      tagValueRow.className = 'tag-value-row';
      tagInfo.appendChild(tagValueRow);

      const tagValue = document.createElement('span');
      tagValue.textContent = tag.tag;
      tagValue.className = 'tag-value';
      tagValueRow.appendChild(tagValue);

      if (tag.category) {
        const tagCategory = document.createElement('span');
        tagCategory.textContent = tag.category;
        tagCategory.className = 'tag-category-badge';
        tagValueRow.appendChild(tagCategory);
      }

      if (tag.description) {
        // Descriptions read too similarly to the category badge as plain
        // text, so they're tucked behind a click-to-open popover instead of
        // always showing inline — still in the DOM (and still searchable
        // via applySearchFilter's tag.description check below), just not
        // visually competing with the category. Uses the Popover API +
        // CSS anchor positioning (both recent-baseline) rather than a
        // hover-only `title` tooltip, since `title` never shows on touch
        // and a button that visibly does nothing on click/tap reads as
        // broken — acceptable here since this is an authoring tool, not
        // the served site itself.
        const descId = `tag-description-${tag.index}`;
        const anchorName = `--tag-description-anchor-${tag.index}`;

        const tagDescriptionIcon = document.createElement('button');
        tagDescriptionIcon.type = 'button';
        tagDescriptionIcon.className = 'tag-description-icon';
        tagDescriptionIcon.textContent = 'ⓘ';
        tagDescriptionIcon.setAttribute('popovertarget', descId);
        tagDescriptionIcon.setAttribute('aria-label', `Show description for ${tag.tag}`);
        tagDescriptionIcon.style.setProperty('anchor-name', anchorName);
        // The rest of the row toggles the checkbox on click — this button
        // should only open its popover.
        tagDescriptionIcon.addEventListener('click', (e) => e.stopPropagation());
        tagValueRow.appendChild(tagDescriptionIcon);

        const tagDescriptionPopover = document.createElement('div');
        tagDescriptionPopover.id = descId;
        tagDescriptionPopover.className = 'tag-description-popover';
        tagDescriptionPopover.setAttribute('popover', 'auto');
        tagDescriptionPopover.textContent = tag.description;
        tagDescriptionPopover.style.setProperty('position-anchor', anchorName);
        tagDescriptionPopover.addEventListener('click', (e) => e.stopPropagation());
        tagValueRow.appendChild(tagDescriptionPopover);
      }

      tagInfo.addEventListener('click', () => {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });

      tagItem.appendChild(checkbox);
      tagItem.appendChild(tagInfo);
      resultsContainer.appendChild(tagItem);
    });
  });
}

/**
 * Builds the multi-select, searchable tag picker UI and wires it to
 * `actions.sendText`.
 * @param {Object} taxonomyData The raw `taxonomy.json` payload
 * @param {Object} actions DA actions object
 */
function displayTaxonomy(taxonomyData, actions) {
  if (!taxonomyData) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = '❌ Failed to load taxonomy';
    document.body.appendChild(errorDiv);
    return;
  }

  const container = document.createElement('div');
  container.className = 'tags-container';

  const header = document.createElement('h2');
  header.textContent = 'Tags';
  header.className = 'tags-header';
  container.appendChild(header);

  if (!Array.isArray(taxonomyData.data)) {
    const noDataDiv = document.createElement('div');
    noDataDiv.className = 'warning-message';
    noDataDiv.textContent = '�\u00A0️ No taxonomy data found';
    container.appendChild(noDataDiv);
    document.body.appendChild(container);
    return;
  }

  const tags = parseTaxonomy(taxonomyData.data).map((tag, index) => ({ ...tag, index }));

  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';

  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'search-wrapper';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search tags...';
  searchInput.className = 'search-input';

  const searchClearBtn = document.createElement('button');
  searchClearBtn.type = 'button';
  searchClearBtn.className = 'search-clear';
  searchClearBtn.setAttribute('aria-label', 'Clear search');
  searchClearBtn.textContent = '×';
  searchClearBtn.hidden = true;

  searchWrapper.appendChild(searchInput);
  searchWrapper.appendChild(searchClearBtn);
  searchContainer.appendChild(searchWrapper);

  container.appendChild(searchContainer);

  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'results-container';
  container.appendChild(resultsContainer);

  const selectedTagsSummary = document.createElement('div');
  selectedTagsSummary.className = 'selected-tags-summary';
  container.appendChild(selectedTagsSummary);

  const selectedTags = new Set();
  const collapsedNamespaces = new Set();
  let lastVisibleTags = tags;

  const readSelectionBtn = document.createElement('button');
  readSelectionBtn.type = 'button';
  readSelectionBtn.textContent = 'Read Selection';
  readSelectionBtn.title = 'Load tags from the currently selected text in the document';
  readSelectionBtn.className = 'btn btn-secondary';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetBtn.title = 'Clear selected tags, search, and collapsed namespaces';
  resetBtn.className = 'btn btn-secondary';

  const sendSelectedBtn = document.createElement('button');
  sendSelectedBtn.textContent = 'Send Selected (0)';
  sendSelectedBtn.className = 'btn btn-primary';

  function updateSendButton() {
    const count = selectedTags.size;
    sendSelectedBtn.textContent = `Send Selected (${count})`;
    sendSelectedBtn.className = count > 0 ? 'btn btn-primary' : 'btn btn-secondary';
    sendSelectedBtn.disabled = count === 0;
  }

  function updateSelectedSummary() {
    selectedTagsSummary.innerHTML = '';

    if (selectedTags.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'selected-tags-empty';
      empty.textContent = 'No tags selected yet';
      selectedTagsSummary.appendChild(empty);
      return;
    }

    [...selectedTags].forEach((index) => {
      const tag = tags[index];
      const chip = document.createElement('span');
      chip.className = 'selected-tag-chip';

      const chipLabel = document.createElement('span');
      chipLabel.textContent = tag.path;
      chip.appendChild(chipLabel);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'selected-tag-remove';
      removeBtn.setAttribute('aria-label', `Remove ${tag.path}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        selectedTags.delete(index);
        updateSendButton();
        updateSelectedSummary();
        // eslint-disable-next-line no-use-before-define
        render(lastVisibleTags);
      });
      chip.appendChild(removeBtn);

      selectedTagsSummary.appendChild(chip);
    });
  }

  function render(visibleTags) {
    lastVisibleTags = visibleTags;
    const isSearching = searchInput.value.trim().length > 0;
    renderTagList(
      resultsContainer,
      visibleTags,
      selectedTags,
      collapsedNamespaces,
      isSearching,
      (index, checked) => {
        if (checked) {
          selectedTags.add(index);
        } else {
          selectedTags.delete(index);
        }
        updateSendButton();
        updateSelectedSummary();
      },
      (namespace) => {
        if (collapsedNamespaces.has(namespace)) {
          collapsedNamespaces.delete(namespace);
        } else {
          collapsedNamespaces.add(namespace);
        }
        render(lastVisibleTags);
      },
    );
  }

  /**
   * Reads the document's current text selection (via `actions.getSelection`)
   * and loads whichever taxonomy paths it contains as the picker's
   * selection — replacing whatever was previously selected in the picker.
   * There's no push notification when the author changes the document
   * selection while the panel stays open (the SDK only exposes a pull,
   * request/response `getSelection`), so this is wired to a button the
   * author clicks whenever they want the picker to catch up to a new
   * selection, rather than something that happens automatically.
   *
   * Matches by substring (`text.includes(tag.path)`) rather than splitting
   * the selection on commas and comparing each piece exactly — the editor's
   * selection text isn't guaranteed to come back as a clean comma list (the
   * boundary pieces can pick up stray characters), but every known path
   * either appears intact somewhere in the selection or it doesn't, so
   * scanning for each one directly is more robust than trusting the split.
   */
  async function loadTagsFromSelection() {
    if (typeof actions.getSelection !== 'function') return;

    try {
      const selection = await actions.getSelection();
      const text = (typeof selection === 'string' ? selection : (selection?.text || ''))
        .replace(/\u00A0/g, ' ');
      if (!text.trim()) return;

      const matchedIndexes = tags.filter((tag) => text.includes(tag.path)).map((tag) => tag.index);

      selectedTags.clear();
      matchedIndexes.forEach((index) => selectedTags.add(index));
      render(lastVisibleTags);
      updateSendButton();
      updateSelectedSummary();
    } catch (error) {
      console.error('Error loading tags from selection:', error);
    }
  }

  readSelectionBtn.addEventListener('click', loadTagsFromSelection);

  function applySearchFilter() {
    const term = searchInput.value.trim().toLowerCase();
    searchClearBtn.hidden = term.length === 0;
    const filtered = term.length === 0 ? tags : tags.filter((tag) => (
      tag.tag.toLowerCase().includes(term)
      || tag.namespace.toLowerCase().includes(term)
      || tag.category.toLowerCase().includes(term)
      || tag.description.toLowerCase().includes(term)
    ));
    render(filtered);
  }

  searchInput.addEventListener('input', applySearchFilter);
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    applySearchFilter();
    searchInput.focus();
  });

  const actionContainer = document.createElement('div');
  actionContainer.className = 'action-container';
  container.appendChild(actionContainer);

  resetBtn.addEventListener('click', () => {
    selectedTags.clear();
    collapsedNamespaces.clear();
    searchInput.value = '';
    searchClearBtn.hidden = true;
    render(tags);
    updateSendButton();
    updateSelectedSummary();
  });

  sendSelectedBtn.addEventListener('click', async () => {
    if (selectedTags.size === 0) return;

    try {
      const selectedTagPaths = [...new Set([...selectedTags].map((index) => tags[index].path))];
      await actions.sendText(selectedTagPaths.join(', '));
    } catch (error) {
      console.error('Error sending selected tags to document:', error);

      const originalText = sendSelectedBtn.textContent;
      sendSelectedBtn.textContent = '✗ Error';
      sendSelectedBtn.className = 'btn btn-error';
      sendSelectedBtn.disabled = true;

      setTimeout(() => {
        sendSelectedBtn.textContent = originalText;
        sendSelectedBtn.className = 'btn btn-primary';
        sendSelectedBtn.disabled = false;
      }, 2000);
    }
  });

  actionContainer.appendChild(sendSelectedBtn);
  actionContainer.appendChild(readSelectionBtn);
  actionContainer.appendChild(resetBtn);

  render(tags);
  updateSendButton();
  updateSelectedSummary();

  document.body.appendChild(container);
}

async function init() {
  try {
    const { context, actions } = await DA_SDK;
    const taxonomyUrl = resolveTaxonomyUrl(context.org, context.repo);
    const taxonomyData = await fetchTaxonomy(actions, taxonomyUrl);
    displayTaxonomy(taxonomyData, actions);
  } catch (error) {
    console.error('Error initializing tags tool:', error);

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = '❌ Error initializing tags tool';
    document.body.appendChild(errorDiv);
  }
}

init();
