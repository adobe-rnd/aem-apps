/**
 * Library URL Migration Mixin
 *
 * Provides optional migration functionality for library sections (Blocks, Templates)
 * to convert preview URLs (*.aem.live) to content.da.live URLs.
 *
 * This mixin adds:
 * - Detection of preview URLs
 * - Migration banner UI
 * - One-click migration functionality
 *
 * Usage:
 * class MyLibrarySection extends LibraryUrlMigrationMixin(BaseSectionElement) {
 *   // Must implement:
 *   // - _getLibraryJsonPath() - returns the path to the JSON file
 *   // - _getLibraryType() - returns 'Blocks' or 'Templates'
 * }
 */

// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */

import { html, nothing } from 'da-lit';
import { isPreviewUrl, normalizeLibraryData } from '../utils/url-normalizer.js';

export const LibraryUrlMigrationProperties = {
  _hasPreviewUrls: { state: true },
  _migratingUrls: { state: true },
};

export function LibraryUrlMigrationMixin(superClass) {
  return class extends superClass {
    static properties = {
      ...superClass.properties,
      ...LibraryUrlMigrationProperties,
    };

    constructor() {
      super();
      this._hasPreviewUrls = false;
      this._migratingUrls = false;
    }

    /**
     * Detect if library data contains preview URLs
     * Call this after loading library data
     * @param {Array} libraryData - Array of library items with path fields
     */
    _detectPreviewUrls(libraryData) {
      if (!Array.isArray(libraryData)) {
        this._hasPreviewUrls = false;
        return;
      }

      this._hasPreviewUrls = libraryData.some((item) => item.path && isPreviewUrl(item.path));
    }

    /**
     * Migrate library URLs from preview format to content.da.live format
     * Subclasses must implement _getLibraryJsonPath() and _getLibraryType()
     */
    async _handleMigrateLibraryUrls() {
      this._migratingUrls = true;
      this._clearError();

      try {
        // Get the library JSON path from subclass
        const libraryPath = await this._getLibraryJsonPath();
        if (!libraryPath) {
          throw new Error('Library path not found');
        }

        // Fetch current library JSON
        const response = await fetch(libraryPath, {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch library JSON: ${response.status}`);
        }

        const data = await response.json();

        // Parse library data - handle different response structures
        let libraryData = null;
        let isMultiSheet = false;

        if (data?.blocks?.data && Array.isArray(data.blocks.data)) {
          // Multi-sheet structure: { blocks: { data: [...] } }
          libraryData = data.blocks.data;
          isMultiSheet = true;
        } else if (data?.data && Array.isArray(data.data)) {
          // Single nested structure: { data: [...] }
          libraryData = data.data;
        } else if (Array.isArray(data)) {
          // Plain array: [...]
          libraryData = data;
        }

        if (!libraryData) {
          throw new Error('Invalid library JSON structure');
        }

        // Normalize URLs
        const { data: normalizedData, migratedCount } = normalizeLibraryData(libraryData);

        if (migratedCount === 0) {
          this._setError('No preview URLs found to migrate');
          this._migratingUrls = false;
          return;
        }

        // Update the data structure
        let updatedData;
        if (isMultiSheet) {
          // Multi-sheet: { blocks: { data: [...] } }
          updatedData = { ...data, blocks: { ...data.blocks, data: normalizedData } };
        } else if (data?.data && Array.isArray(data.data)) {
          // Single nested: { data: [...] }
          updatedData = { ...data, data: normalizedData };
        } else {
          // Plain array
          updatedData = normalizedData;
        }

        // Save updated library JSON
        const updateUrl = libraryPath.replace('https://content.da.live/', 'https://admin.da.live/source/');
        const formData = new FormData();
        const blob = new Blob([JSON.stringify(updatedData, null, 2)], { type: 'application/json' });
        formData.set('data', blob);

        const updateResponse = await fetch(updateUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
          body: formData,
        });

        if (!updateResponse.ok) {
          throw new Error(`Failed to update library JSON: ${updateResponse.status}`);
        }

        // Reload the library data
        await this.loadData();

        this._migratingUrls = false;
        this._setError(`Successfully migrated ${migratedCount} preview URL${migratedCount > 1 ? 's' : ''} to content.da.live format`);

        // Track action if tracking method exists
        if (this._trackAction) {
          this._trackAction('library-urls-migrated', {
            type: this._getLibraryType(),
            count: migratedCount,
          });
        }

        // Clear success message after 5 seconds
        setTimeout(() => { this._clearError(); }, 5000);
      } catch (error) {
        this._setError(`Failed to migrate preview URLs: ${error.message}`);
        this._migratingUrls = false;
      }
    }

    /**
     * Render migration warning banner
     * Call this in your render method when _hasPreviewUrls is true
     */
    _renderMigrationBanner() {
      if (!this._hasPreviewUrls) {
        return nothing;
      }

      return html`
        <div class="library-migration-warning">
          <div class="migration-warning-content">
            <strong>Migration Recommended:</strong> Your ${this._getLibraryType().toLowerCase()} library uses preview URLs (*.aem.live).
            Migrating to content.da.live URLs improves reliability and performance.
          </div>
          <sl-button
            size="small"
            variant="primary"
            @click=${this._handleMigrateLibraryUrls}
            ?loading=${this._migratingUrls}
          >
            Migrate URLs
          </sl-button>
        </div>
      `;
    }

    /**
     * Subclasses must implement this to return the library JSON path
     * @returns {Promise<string>} - Full URL to the library JSON file
     */
    async _getLibraryJsonPath() {
      throw new Error('Subclass must implement _getLibraryJsonPath()');
    }

    /**
     * Subclasses must implement this to return the library type
     * @returns {string} - 'Blocks' or 'Templates'
     */
    _getLibraryType() {
      throw new Error('Subclass must implement _getLibraryType()');
    }
  };
}
