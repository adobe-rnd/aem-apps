/* eslint-disable no-underscore-dangle, class-methods-use-this */
/**
 * Library Items CRUD Mixin
 * Provides standard CRUD operations for library items (templates, icons, placeholders)
 *
 * Usage:
 *   class MySection extends LibraryItemsCRUDMixin(BaseClass) {
 *     static properties = {
 *       ...super.properties,
 *       ...LibraryItemsCRUDProperties,
 *     };
 *   }
 */

import { fetchLibraryJSON, getSheetDataArray } from '../api/library-api.js';
import { getLibraryPath } from '../api/config-api.js';

/**
 * Properties required by this mixin
 */
export const LibraryItemsCRUDProperties = {
  _items: { state: true },
  _searchQuery: { state: true },
};

/**
 * Mixin that adds library items CRUD functionality
 * @param {Class} Base - Base class to extend
 * @returns {Class} Extended class with CRUD capabilities
 */
export function LibraryItemsCRUDMixin(Base) {
  return class extends Base {
    constructor() {
      super();
      this._items = [];
      this._searchQuery = '';
    }

    /**
     * Override: Specify the library type name (lowercase)
     * Subclasses should return 'templates', 'icons', or 'placeholders'
     * @returns {string}
     */
    _getLibraryTypeLower() {
      return this._getLibraryType().toLowerCase();
    }

    /**
     * Override: Specify the API update function
     * Subclasses must implement this to return the appropriate update function
     * @returns {Function} API function (updateTemplates, updateIcons, etc.)
     */
    _getUpdateFunction() {
      throw new Error('Subclass must implement _getUpdateFunction()');
    }

    /**
     * Override: Extract item properties from form
     * Subclasses must implement this to convert form data to item object
     * @returns {Object} Item object to save
     */
    _getItemFromForm() {
      throw new Error('Subclass must implement _getItemFromForm()');
    }

    /**
     * Override: Populate form from item for editing
     * Subclasses must implement this to populate form fields from item
     * @param {Object} item - Item to edit
     */
    // eslint-disable-next-line no-unused-vars
    _populateFormFromItem(item) {
      throw new Error('Subclass must implement _populateFormFromItem()');
    }

    /**
     * Standard loadData implementation for library items
     */
    async loadData() {
      this._setLoading(true);
      const type = this._getLibraryTypeLower();
      this._trackAction(`${type}-load`, { org: this.org, site: this.site });

      try {
        const json = await fetchLibraryJSON(this.org, this.site, type, this.token);
        this._items = getSheetDataArray(json);
        this._setLoading(false);
      } catch (error) {
        this._setError(`Failed to load ${type}: ${error.message}`);
      }
    }

    /**
     * Standard add/update handler for library items
     */
    async _handleAdd() {
      if (!this._isFormValid()) return;

      const type = this._getLibraryTypeLower();
      const libraryPath = await getLibraryPath(this.org, this.site, type, this.token);

      if (!libraryPath) {
        await this._showLibrarySetupModal();
        return;
      }

      this._message = null;

      try {
        const newItem = this._getItemFromForm();
        const updateFn = this._getUpdateFunction();
        const result = await updateFn(this.org, this.site, [newItem], this.token);

        if (result.success) {
          const action = result.stats?.updated > 0 ? `${type}-update` : `${type}-add`;
          const message = result.stats?.updated > 0
            ? `${this._getLibraryType()} updated successfully`
            : `${this._getLibraryType()} added successfully`;

          this._trackAction(action, { org: this.org, site: this.site });
          this._form = this._getDefaultFormState();
          this._editingIndex = -1;
          this._showAddForm = false;
          await this.loadData();
          this._showMessage('success', message);
        } else {
          throw new Error(result.error || `Failed to add ${type}`);
        }
      } catch (error) {
        this._setError(`Failed to add ${type}: ${error.message}`);
      }
    }

    /**
     * Standard edit handler for library items
     */
    _handleEdit(item) {
      const index = this._items.indexOf(item);
      this._editingIndex = index;
      this._populateFormFromItem(item);
      this._showAddForm = true;
      this._clearMessage();
    }

    /**
     * Standard search handler
     */
    _handleSearch(e) {
      this._searchQuery = e.target.value;
    }

    /**
     * Get filtered items based on search query
     * Searches across all string properties of items
     * @returns {Array} Filtered items
     */
    _getFilteredItems() {
      if (!this._searchQuery) return this._items;
      const query = this._searchQuery.toLowerCase();
      // Search across all string values in the item
      return this._items.filter((item) => Object.values(item).some((val) => typeof val === 'string' && val.toLowerCase().includes(query)));
    }
  };
}

export default LibraryItemsCRUDMixin;
