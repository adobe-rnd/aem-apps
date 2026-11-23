# Configuration Console

A centralized DA (Document Authoring) tool for managing site and org-level configurations. The config console provides a unified interface to configure permissions, library settings, blocks, templates, icons, placeholders, and other settings across your DA sites.

## Overview

The Configuration Console provides a navigation-based interface where each section manages a specific aspect of DA configuration. Available sections depend on your current context (org-only or org + site).

### Available Sections

**Org-level sections:**
- **Permissions** — Manage read/write access control for org and site content

**Site-level sections:**
- **Library Settings** — Configure library base path with org/site inheritance
- **Blocks** — Discover and import blocks from GitHub repositories
- **Templates** — Manage document templates
- **Icons** — Configure icon libraries
- **Placeholders** — Manage placeholder text and labels
- **AEM Assets** — Configure AEM Assets integration
- **Translation** — Configure translation settings
- **Universal Editor** — Configure Universal Editor integration

## Usage

### Opening the Console

The config console works in two modes:

#### 1. Integrated Mode (from DA)
When launched from within the DA interface (e.g., from a menu, toolbar, or library action), the console automatically receives context via the DA SDK using `postMessage`:
- The org you're currently working in
- The site/repo (if applicable)
- Your authentication token

#### 2. Standalone Mode (direct access)
When opened directly, the console displays a toolbar where you can manually enter:
- **Organization** (required) - Your DA org name
- **Site** (optional) - Your DA site/repo name

**URL formats:**
```
# Standalone with manual entry
/tools/apps/config-console/config-console

# Direct access with URL parameters
/tools/apps/config-console/config-console?org=myorg
/tools/apps/config-console/config-console?org=myorg&site=mysite
/tools/apps/config-console/config-console?org=myorg&site=mysite#blocks
```

The console automatically detects which mode to use (DA SDK → URL params → manual entry) and displays the appropriate interface.

### Navigation

1. The left sidebar shows available sections based on your current context:
   - **Org-only**: Shows only org-level sections (Permissions)
   - **Org + Site**: Shows both org and site-level sections

2. Click a section to load its configuration interface

3. Each section provides its own UI for viewing, editing, and managing its specific configuration

### Section-Specific Features

#### Blocks
- Discover blocks from GitHub repositories
- Preview block metadata and structure
- Import blocks into the site's library
- Requires GitHub personal access token for private repositories

#### Library Settings
- Configure the library base path for the site
- View inherited settings from org level
- Override or use inherited values

#### Templates / Icons / Placeholders
- View and edit library JSON files
- Add, update, and remove items
- CSV import for bulk updates
- Search and filter functionality

#### Permissions
- Manage org and site-level access control
- Configure read/write permissions by path
- Group and user management
- Folder-based permission scoping

## GitHub Integration (Blocks Section)

The Blocks section can discover and import blocks from GitHub repositories. For private repositories, you can provide a GitHub Personal Access Token.

**Token Storage:**
- Optionally save your GitHub token in the browser for future use (checkbox provided)
- Tokens are stored locally in your browser only
- Tokens are never sent to DA servers or written to configuration files

## Security

- Authentication is handled via Adobe IMS
- GitHub tokens (if provided) are stored locally in your browser only
- All configuration changes use your authenticated DA session

## Installation & Registration

### For Integrated Mode (Recommended)

To use the config console from within DA, register it as a DA app:

1. Add the console to your DA app registry configuration
2. Configure the app with appropriate menu/toolbar integrations
3. Launch from DA - context will be provided automatically

### For Standalone Mode

No installation needed! Simply open the console directly:
- Visit `/tools/apps/config-console/config-console`
- Enter your org and optional site in the toolbar
- Click "Load" to access configuration sections

You can also bookmark URLs with parameters for quick access to specific contexts:
```
/tools/apps/config-console/config-console?org=myorg&site=mysite#permissions
```
