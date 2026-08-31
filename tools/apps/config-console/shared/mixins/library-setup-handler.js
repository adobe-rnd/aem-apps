/* eslint-disable no-underscore-dangle, class-methods-use-this */
/**
 * Library Setup Handler Mixin
 * Provides library setup modal functionality
 *
 * Usage:
 *   class MyClass extends LibrarySetupHandlerMixin(BaseClass) {
 *     static properties = {
 *       ...super.properties,
 *       ...LibrarySetupHandlerMixin.properties,
 *     };
 *   }
 */

import {
  getSuggestedLibraryPaths,
  registerLibraryType,
} from '../api/config-api.js';

/**
 * Properties required by this mixin
 */
export const LibrarySetupHandlerProperties = {
  _showLibrarySetup: { state: true },
  _librarySetupOptions: { state: true },
  _selectedLibraryPath: { state: true },
  _customLibraryPathInput: { state: true },
};

/**
 * Mixin that adds library setup modal handling
 * @param {Class} Base - Base class to extend
 * @returns {Class} Extended class with library setup handling
 */
export function LibrarySetupHandlerMixin(Base) {
  return class extends Base {
    constructor() {
      super();
      this._showLibrarySetup = false;
      this._librarySetupOptions = null;
      this._selectedLibraryPath = '';
      this._customLibraryPathInput = '';
    }

    /**
     * Override this to specify the library type name
     * @returns {string} Library type (e.g., 'Templates', 'Icons')
     */
    _getLibraryType() {
      return 'Library';
    }

    /**
     * Show library setup modal
     */
    async _showLibrarySetupModal() {
      try {
        const suggestions = await getSuggestedLibraryPaths(
          this.org,
          this.site,
          this._getLibraryType(),
          this.token,
        );

        this._librarySetupOptions = suggestions;
        this._selectedLibraryPath = suggestions.suggested;
        this._customLibraryPathInput = '';
        this._showLibrarySetup = true;
      } catch (error) {
        if (this._setError) {
          this._setError(`Failed to load library setup: ${error.message}`);
        }
      }
    }

    /**
     * Handle library path selection
     * @param {string} path - Selected path
     */
    _handleLibraryPathSelection(path) {
      this._selectedLibraryPath = path;
    }

    /**
     * Handle custom library path input
     * @param {Event} e - Input event
     */
    _handleCustomLibraryPathInput(e) {
      this._customLibraryPathInput = e.target.value;
    }

    /**
     * Handle library setup confirmation
     * Override this method to add custom logic after registration
     * @param {CustomEvent} e - Confirm event with path in detail
     */
    async _handleLibrarySetupConfirm(e) {
      try {
        if (this._setLoading) {
          this._setLoading(true);
        }
        if (this._clearError) {
          this._clearError();
        }

        const pathToRegister = e.detail.path;

        if (!pathToRegister) {
          throw new Error('Please select or enter a library path');
        }

        const result = await registerLibraryType(
          this.org,
          this.site,
          this._getLibraryType(),
          pathToRegister,
          this.token,
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to register library');
        }

        this._showLibrarySetup = false;

        // Call hook for subclass-specific logic
        if (this._onLibrarySetupComplete) {
          await this._onLibrarySetupComplete(pathToRegister);
        }

        // Reload data if method exists
        if (this.loadData) {
          await this.loadData();
        }

        if (this._setLoading) {
          this._setLoading(false);
        }
      } catch (error) {
        if (this._setLoading) {
          this._setLoading(false);
        }
        if (this._setError) {
          this._setError(`Failed to setup library: ${error.message}`);
        }
      }
    }

    /**
     * Handle library setup cancellation
     */
    _handleLibrarySetupCancel() {
      this._showLibrarySetup = false;
      this._librarySetupOptions = null;
      this._selectedLibraryPath = '';
      this._customLibraryPathInput = '';
    }
  };
}

export default LibrarySetupHandlerMixin;
