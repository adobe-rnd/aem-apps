# Library Setup Modal - Shared Component

## Overview
Created a shared `library-setup-modal` component to eliminate code duplication across Blocks, Templates, Icons, and Placeholders sections.

## Location
`/tools/apps/config-console/shared/components/library-setup-modal.js`

## Features

### 1. Smart Detection
- Automatically detects existing library configurations from other types
- Shows blue info box when detected: "We detected another library configured at `X`"
- Auto-selects the detected path

### 2. Smart Labeling
- "(recommended)" label **only** appears on the detected/suggested path
- Does NOT show "library (recommended)" when it's just the default
- Example:
  - If Blocks detected at `docs/library` → Shows `docs/library (recommended)`
  - If no detection → Shows `library` without "(recommended)"

### 3. Options
- Suggested/detected path (pre-selected, marked as recommended if detected)
- Alternative path (`docs/library` if not the detected one)
- Custom path input field

## Usage

### Import
```javascript
import '../../shared/components/library-setup-modal.js';
```

### Add to Render
```javascript
<library-setup-modal
  .open=${this._showLibrarySetup}
  .libraryType=${'Templates'}  // or 'Blocks', 'Icons', 'Placeholders'
  .options=${this._librarySetupOptions}
  .selectedPath=${this._selectedLibraryPath}
  .customPath=${this._customLibraryPathInput}
  @confirm=${this._handleLibrarySetupConfirm}
  @cancel=${this._handleLibrarySetupCancel}
></library-setup-modal>
```

### Event Handlers
```javascript
async _handleLibrarySetupConfirm(e) {
  const pathToRegister = e.detail.path;  // Selected or custom path
  // ... register library type
}

_handleLibrarySetupCancel() {
  this._showLibrarySetup = false;
  // ... cleanup
}
```

### Setup Options
Options come from `getSuggestedLibraryPaths()`:
```javascript
{
  suggested: 'library',        // The path to pre-select
  options: ['library', 'docs/library'],  // Available options
  detected: true               // Whether another library was detected
}
```

## Migration Status

- ✅ **Templates** - Migrated to shared component
- ✅ **Blocks** - Migrated to shared component
- ✅ **Icons** - Migrated to shared component
- ✅ **Placeholders** - Migrated to shared component

## Benefits

1. **DRY Principle** - Single source of truth for modal behavior
2. **Consistency** - All sections behave identically
3. **Maintainability** - Bug fixes apply to all sections
4. **Smart UX** - Auto-selects detected path, shows helpful messages

## Example Flow

**User sets up Blocks at `docs/library`, then sets up Templates:**

1. Modal appears: "Configure Templates Library Location"
2. Blue box shows: "We detected your Blocks library at `docs/library`. We recommend using the same location for templates."
3. Radio options:
   - ○ `docs/library (recommended)` ← **Auto-selected**
   - ○ `library`
   - ○ Custom path: ___________
4. User clicks "Save"
5. Templates configured at `docs/library`

**User sets up Templates first (no detection):**

1. Modal appears: "Configure Templates Library Location"
2. No detection message
3. Radio options:
   - ○ `library` ← **Auto-selected** (no "recommended" label)
   - ○ `docs/library`
   - ○ Custom path: ___________
4. User clicks "Save"
5. Templates configured at chosen path
