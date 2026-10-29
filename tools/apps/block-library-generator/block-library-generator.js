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
import { LitElement, html } from '../../deps/lit/dist/index.js';
import {
  getProbeTarget,
  createProbeRequest,
  getProbeBlockReason,
  persistProbeRequest,
  readProbeRequest,
  readProbeResult,
  createProbePrompt,
  loadProbePointer,
  saveProbePointer,
  persistJobRequest,
  readJobRequest,
  readJobResult,
  loadJobPointer,
  saveJobPointer,
  requestBlockName,
  cleanupCompletedAnalysisJob,
  saveJobCleanupReceipt,
  loadJobCleanupReceipt,
} from './jobs.js';
import { parseManualBlocks } from './discovery.js';
import discoverCachedBlocks from './discovery-cache.js';
import {
  collectAnalysisInput as collectCardsInput,
  createAnalysisRequest as createCardsRequest,
  createAnalysisPrompt as createCardsPrompt,
  validateAnalysisRequest as validateCardsRequest,
  validateBlockAnalysis as validateCardsAnalysis,
} from './block-analysis.js';
import { prepareCardsLibraryDryRun, buildCardsPage, buildBlockStarterPage } from './library-dry-run.js';
import inspectBlockLibrary from './library-inventory.js';
import {
  prepareLibraryAction, deleteLibraryPage, replaceLibraryPage,
} from './library-lifecycle.js';
import { createLibraryPresentation, applyLibraryPresentation } from './library-presentation.js';
import {
  createCardsLibrary, checkLibraryCreation, saveCreationReceipt, loadCreationReceipt,
} from './library-creation.js';
import {
  initializeBlockLibrary, saveLibrarySetupReceipt, loadLibrarySetupReceipt,
} from './library-setup.js';
import { ensurePlaceholderImages } from './placeholder-images.js';
import {
  previewLibraryContent, saveLibraryPreviewReceipt, loadLibraryPreviewReceipts,
  clearLibraryPagePreviewReceipt,
} from './library-preview.js';

function readableLabel(value) {
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function renderProblem(message, summary) {
  if (!message) return '';
  return html`
    <div class="problem-panel">
      <p class="probe-error" role="alert">${summary}</p>
      <details><summary>Details</summary><p>${message}</p></details>
    </div>
  `;
}

class BlockLibraryGeneratorApp extends LitElement {
  static properties = {
    context: { state: true },
    hasToken: { state: true },
    connectionState: { state: true },
    probeConfirmed: { state: true },
    probeBusy: { state: true },
    probeRequest: { state: true },
    probeResult: { state: true },
    probeState: { state: true },
    probeError: { state: true },
    savedProbe: { state: true },
    handoffRequested: { state: true },
    newProbeConfirmed: { state: true },
    probeEnvironment: { state: true },
    discoveryRef: { state: true },
    githubRepository: { state: true },
    manualBlockNames: { state: true },
    discoveryBusy: { state: true },
    discoveryResult: { state: true },
    discoveryError: { state: true },
    discoveryCacheWarning: { state: true },
    cardsConfirmed: { state: true },
    cardsNewConfirmed: { state: true },
    cardsBusy: { state: true },
    cardsRequest: { state: true },
    cardsResult: { state: true },
    cardsState: { state: true },
    cardsError: { state: true },
    cardsSaved: { state: true },
    cardsHandoff: { state: true },
    libraryDraft: { state: true },
    libraryReviewConfirmed: { state: true },
    libraryBusy: { state: true },
    libraryPreview: { state: true },
    libraryError: { state: true },
    libraryCreating: { state: true },
    libraryCreationConfirmed: { state: true },
    libraryCreationReceipt: { state: true },
    selectedBlock: { state: true },
    detailOpen: { state: true },
    libraryOverview: { state: true },
    libraryOverviewBusy: { state: true },
    libraryOverviewError: { state: true },
    librarySetupProposal: { state: true },
    librarySetupReceipt: { state: true },
    librarySetupError: { state: true },
    selectedExampleIds: { state: true },
    libraryPresentation: { state: true },
    outputPreviewReady: { state: true },
    pageFlow: { state: true },
    manualOrg: { state: true },
    manualSite: { state: true },
    choosingSite: { state: true },
    targetError: { state: true },
    connectionError: { state: true },
    notice: { state: true },
    jobCleanupReceipt: { state: true },
    jobCleanupError: { state: true },
    libraryPreviewReceipts: { state: true },
    libraryPreviewError: { state: true },
    libraryPreviewing: { state: true },
  };

  constructor() {
    super();
    this.context = {};
    this.hasToken = false;
    this.connectionState = 'waiting';
    this.hostContext = {};
    this.hostActions = {};
    this.probeConfirmed = false;
    this.probeBusy = false;
    this.probeRequest = null;
    this.probeResult = null;
    this.probeState = 'idle';
    this.probeError = '';
    this.savedProbe = null;
    this.handoffRequested = false;
    this.newProbeConfirmed = false;
    this.probeEnvironment = 'prod';
    this.discoveryRef = 'main';
    this.githubRepository = '';
    this.manualBlockNames = '';
    this.discoveryBusy = false;
    this.discoveryResult = null;
    this.discoveryError = '';
    this.discoveryCacheWarning = '';
    this.cardsConfirmed = false;
    this.cardsNewConfirmed = false;
    this.cardsBusy = false;
    this.cardsRequest = null;
    this.cardsResult = null;
    this.cardsState = 'idle';
    this.cardsError = '';
    this.cardsSaved = null;
    this.cardsHandoff = false;
    this.resetLibraryDryRun();
    this.libraryCreationReceipt = null;
    this.selectedBlock = '';
    this.detailOpen = false;
    this.libraryOverview = null;
    this.libraryOverviewBusy = false;
    this.libraryOverviewError = '';
    this.librarySetupProposal = null;
    this.librarySetupReceipt = null;
    this.librarySetupError = '';
    this.pageFlow = null;
    this.manualOrg = '';
    this.manualSite = '';
    this.choosingSite = true;
    this.targetError = '';
    this.connectionError = '';
    this.notice = '';
    this.jobCleanupReceipt = null;
    this.jobCleanupError = '';
    this.libraryPreviewReceipts = [];
    this.libraryPreviewError = '';
    this.libraryPreviewing = false;
  }

  createRenderRoot() {
    this.replaceChildren();
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    if (window.parent === window) {
      this.connectionState = 'unavailable';
      return;
    }
    this.connectionState = 'waiting';
    this.connectionTimer = window.setTimeout(() => {
      if (this.connectionState === 'waiting') this.connectionState = 'unavailable';
    }, 10000);
    this.initialize();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearTimeout(this.connectionTimer);
    this.probeController?.abort();
    this.discoveryController?.abort();
    this.resetLibraryOverview();
    this.resetCardsAnalysis();
  }

  async initialize() {
    try {
      const sdkOrigin = 'https://da.live/nx';
      const { default: sdk } = await import(`${sdkOrigin}/utils/sdk.js`);
      const { context, token, actions } = await sdk;
      if (!this.isConnected) return;

      const site = context?.site || context?.repo;
      this.hasToken = Boolean(token);
      this.hostContext = {
        view: typeof context?.view === 'string' ? context.view : '',
        branch: typeof context?.branch === 'string' ? context.branch : '',
        daOrigin: typeof context?.daOrigin === 'string' ? context.daOrigin : '',
        editorOrg: typeof context?.org === 'string' ? context.org : '',
        editorSite: typeof site === 'string' ? site : '',
      };
      this.hostActions = {
        daFetch: actions?.daFetch,
        setPrompt: actions?.setPrompt,
        closeLibrary: actions?.closeLibrary,
      };
      if (this.hostContext.daOrigin && this.hostContext.daOrigin !== 'https://admin.da.live') {
        throw new Error('This release supports Production DA only. No request was redirected to another service.');
      }
      this.context = {
        org: this.isEditorContext && typeof context?.org === 'string' ? context.org : '',
        site: this.isEditorContext && typeof site === 'string' ? site : '',
        path: this.isEditorContext && typeof context?.path === 'string' ? context.path : '',
        ref: typeof context?.ref === 'string' ? context.ref : '',
      };
      if (this.isEditorContext && this.hostContext.branch) {
        this.discoveryRef = this.hostContext.branch;
      }
      if (this.isEditorContext) getProbeTarget('prod', { ...this.context, branch: this.discoveryRef });
      this.connectionState = 'ready';
      this.choosingSite = !this.isEditorContext;
      let useAppsLinkTarget = false;
      if (!this.isEditorContext) {
        const hash = ['fullscreen', 'apps'].includes(this.hostContext.view)
          ? window.location.hash : '';
        if (hash && hash !== '#') {
          try {
            const parts = hash.replace(/^#\/?/, '').split('/');
            if (parts.length !== 2) throw new Error('Expected exactly one organization and site.');
            const target = getProbeTarget('prod', { org: parts[0], site: parts[1] });
            this.manualOrg = target.org;
            this.manualSite = target.site;
            useAppsLinkTarget = true;
          } catch (error) {
            this.targetError = `Invalid app link target. Use #organization/site: ${error.message}`;
          }
        } else {
          try {
            const saved = window.localStorage.getItem('block-library-generator:last-site:prod');
            if (saved) {
              const target = getProbeTarget(JSON.parse(saved));
              this.manualOrg = target.org;
              this.manualSite = target.site;
            }
          } catch (error) {
            this.targetError = `The saved site could not be read. Choose it again: ${error.message}`;
          }
        }
      }
      this.restoreProbePointer();
      this.restoreCardsPointer();
      this.restoreCreationReceipt();
      this.restorePageFlow();
      this.restoreLibrarySetupReceipt();
      if (useAppsLinkTarget) {
        await this.applySiteTarget();
      } else if (this.isEditorContext) {
        this.updateComplete?.then(() => {
          if (this.isConnected && !this.discoveryBlockReason) this.refreshWorkspace();
        });
      }
    } catch (error) {
      if (this.isConnected) {
        this.connectionState = 'error';
        this.connectionError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      window.clearTimeout(this.connectionTimer);
    }
  }

  get probeTarget() {
    if (!this.context.org || !this.context.site) return null;
    return getProbeTarget(this.probeEnvironment, { ...this.context, branch: this.discoveryRef });
  }

  get isEditorContext() {
    return ['edit', 'canvas'].includes(this.hostContext.view)
      && Boolean(this.hostContext.editorOrg && this.hostContext.editorSite);
  }

  isCurrentTarget(target) {
    const current = this.probeTarget;
    return Boolean(current && target
      && Object.keys(current).every((key) => current[key] === target[key]));
  }

  beginSiteSelection() {
    if (this.isEditorContext || this.workflowBusy || this.discoveryBusy || this.librarySetupProposal
      || this.libraryOverviewBusy || this.pageFlow) return;
    this.manualOrg = this.context.org || this.manualOrg;
    this.manualSite = this.context.site || this.manualSite;
    this.targetError = '';
    this.choosingSite = true;
    this.updateComplete?.then(() => this.querySelector('#target-org')?.focus());
  }

  cancelSiteSelection() {
    if (this.isEditorContext || !this.context.org || !this.context.site
      || this.workflowBusy || this.discoveryBusy || this.libraryOverviewBusy) return;
    this.manualOrg = this.context.org;
    this.manualSite = this.context.site;
    this.targetError = '';
    this.choosingSite = false;
    this.updateComplete?.then(() => this.querySelector('.target-change')?.focus());
  }

  async applySiteTarget() {
    if (this.workflowBusy || this.discoveryBusy || this.libraryOverviewBusy
      || this.pageFlow || this.librarySetupProposal) {
      this.targetError = 'Finish or cancel the pending action before changing sites.';
      return;
    }
    this.targetError = '';
    try {
      if (this.isEditorContext || this.connectionState !== 'ready' || !this.hasToken
        || typeof this.hostActions.daFetch !== 'function') {
        throw new Error('Open this app through DA Apps with an authenticated session to choose a site.');
      }
      const target = getProbeTarget('prod', {
        org: this.manualOrg.trim(), site: this.manualSite.trim(), branch: 'main',
      });
      this.resetDiscovery();
      this.resetCardsAnalysis();
      this.libraryCreationReceipt = null;
      this.librarySetupReceipt = null;
      this.pageFlow = null;
      this.notice = '';
      this.discoveryRef = target.branch;
      this.context = {
        ...this.context, org: target.org, site: target.site, path: '',
      };
      window.localStorage.setItem('block-library-generator:last-site:prod', JSON.stringify(target));
      this.choosingSite = false;
      this.restorePageFlow();
      this.restoreLibrarySetupReceipt();
      await this.refreshWorkspace();
    } catch (error) {
      this.targetError = error instanceof Error ? error.message : String(error);
    }
  }

  get probeEnvironmentLabel() {
    return this.probeEnvironment === 'prod' ? 'Production' : 'Stage';
  }

  get probeBlockReason() {
    return getProbeBlockReason({
      context: { ...this.context, ...this.hostContext },
      actions: this.hostActions,
      embedded: window.parent !== window,
      hasToken: this.hasToken,
      environment: this.probeEnvironment,
    });
  }

  restoreProbePointer() {
    if (this.probeBlockReason) return;
    try {
      this.savedProbe = loadProbePointer(window.localStorage, this.probeEnvironment);
    } catch (error) {
      this.probeError = error.message;
      this.probeState = 'error';
    }
  }

  selectProbeEnvironment(environment) {
    if (this.libraryCreating) {
      this.libraryError = 'Wait for creation to finish before switching environments.';
      return;
    }
    try {
      getProbeTarget(environment);
    } catch (error) {
      this.probeError = error.message;
      return;
    }
    if (environment === this.probeEnvironment) return;
    this.resetDiscovery();
    this.resetCardsAnalysis();
    this.probeController?.abort();
    this.probeController = null;
    this.probeBusy = false;
    this.probeEnvironment = environment;
    this.probeConfirmed = false;
    this.newProbeConfirmed = false;
    this.probeRequest = null;
    this.probeResult = null;
    this.savedProbe = null;
    this.handoffRequested = false;
    this.probeError = '';
    this.probeState = 'idle';
    this.restoreProbePointer();
    this.restoreCardsPointer();
    this.libraryCreationReceipt = null;
    this.restoreCreationReceipt();
    this.pageFlow = null;
    this.restorePageFlow();
    this.librarySetupReceipt = null;
    this.restoreLibrarySetupReceipt();
  }

  get discoveryBlockReason() {
    if (this.connectionError) return this.connectionError;
    if (this.probeEnvironment !== 'prod') return 'This release supports Production DA only.';
    if (this.connectionState !== 'ready' || window.parent === window) {
      return 'Open this app from the DA editor or Apps to use an authenticated site session.';
    }
    if (!this.hasToken) {
      return 'Sign in to DA and reopen the generator to access a site.';
    }
    if (typeof this.hostActions.daFetch !== 'function') {
      return 'This DA host does not provide authenticated access. Open the generator from the editor or Apps.';
    }
    if (!this.context.org || !this.context.site) {
      return 'Choose a site to read its blocks and existing library.';
    }
    if (this.hostContext.daOrigin && this.hostContext.daOrigin !== this.probeTarget.adminOrigin) {
      return 'This release supports Production DA only. The host uses another service.';
    }
    return '';
  }

  resetDiscovery() {
    this.discoveryController?.abort();
    this.discoveryController = null;
    this.discoveryBusy = false;
    this.discoveryResult = null;
    this.discoveryError = '';
    this.discoveryCacheWarning = '';
    this.manualBlockNames = '';
    this.selectedBlock = '';
    this.detailOpen = false;
    this.resetLibraryOverview();
  }

  changeDiscoveryInput(field, value) {
    if (this.libraryCreating) {
      this.discoveryError = 'Wait for library creation to finish before changing the code reference.';
      return;
    }
    if (!['ref', 'repository'].includes(field)) {
      this.discoveryError = 'Invalid discovery input.';
      return;
    }
    this.resetDiscovery();
    if (field === 'ref') this.resetCardsAnalysis();
    if (field === 'ref') this.discoveryRef = value;
    else this.githubRepository = value;
  }

  async discoverInventory({ forceRefresh = false } = {}) {
    if (this.discoveryBusy) {
      this.discoveryError = 'Block discovery is already in progress.';
      return;
    }
    const controller = new AbortController();
    this.discoveryController = controller;
    try {
      const reason = this.discoveryBlockReason;
      if (reason) throw new Error(reason);
      this.discoveryBusy = true;
      this.discoveryError = '';
      this.discoveryCacheWarning = '';
      const result = await discoverCachedBlocks({
        target: this.probeTarget,
        forceRefresh,
        githubRepository: this.githubRepository,
        daFetch: this.hostActions.daFetch,
        fetchPublic: (url, options) => window.fetch(url, options),
        signal: controller.signal,
      });
      if (this.isConnected && this.discoveryController === controller
        && !controller.signal.aborted) {
        if (!result.complete && this.discoveryResult?.complete) {
          this.discoveryCacheWarning = 'Block discovery refresh failed. The previous block list is still shown.';
        } else {
          this.discoveryResult = result;
          this.discoveryCacheWarning = result.cacheWarning || '';
        }
        this.chooseInitialBlock();
      }
    } catch (error) {
      if (this.isConnected && this.discoveryController === controller
        && !controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.discoveryResult?.complete) {
          this.discoveryCacheWarning = `Block discovery refresh failed. The previous block list is still shown: ${message}`;
        } else {
          this.discoveryError = message;
        }
      }
    } finally {
      if (this.discoveryController === controller) {
        this.discoveryBusy = false;
        this.discoveryController = null;
      }
    }
  }

  useManualBlocks() {
    try {
      const reason = this.discoveryBlockReason;
      if (reason) throw new Error(reason);
      const result = parseManualBlocks(this.manualBlockNames);
      result.diagnostics = this.discoveryResult?.diagnostics || [];
      this.discoveryController?.abort();
      this.discoveryController = null;
      this.discoveryBusy = false;
      this.discoveryResult = result;
      this.discoveryError = '';
      this.discoveryCacheWarning = '';
      this.chooseInitialBlock();
    } catch (error) {
      this.discoveryError = error instanceof Error ? error.message : String(error);
    }
  }

  get workflowBusy() {
    return this.cardsBusy || this.probeBusy || this.libraryBusy;
  }

  get blockItems() {
    const found = new Map((this.discoveryResult?.blocks || []).map((block) => [block.name, block]));
    Object.keys(this.libraryOverview?.blocks || {}).forEach((name) => {
      if (!found.has(name)) found.set(name, { name, files: [] });
    });
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  hasBlockCode(name) {
    return this.discoveryResult?.complete === true
      && this.discoveryResult.blocks.some((block) => block.name === name);
  }

  get cardsAlreadyExists() {
    const status = this.libraryOverview?.blocks[this.selectedBlock || 'cards']?.status;
    return ['existing', 'unregistered'].includes(status);
  }

  resetLibraryOverview() {
    this.libraryOverviewController?.abort();
    this.libraryOverviewController = null;
    this.libraryOverview = null;
    this.libraryOverviewBusy = false;
    this.libraryOverviewError = '';
    this.librarySetupProposal = null;
    this.librarySetupError = '';
    this.libraryPreviewReceipts = [];
    this.libraryPreviewError = '';
    this.libraryPreviewing = false;
  }

  chooseInitialBlock() {
    const blocks = this.blockItems;
    if (!blocks.some((block) => block.name === this.selectedBlock)) {
      this.selectedBlock = blocks.some((block) => block.name === this.pageFlow?.name)
        ? this.pageFlow.name : blocks[0]?.name || '';
    }
    if (this.cardsRequest && requestBlockName(this.cardsRequest) !== this.selectedBlock) {
      this.resetCardsAnalysis();
    }
    this.restoreCardsPointer();
    this.restoreLibraryPreview();
  }

  async selectBlock(name) {
    if (this.libraryCreating) {
      this.libraryError = 'Wait for library creation to finish before changing blocks.';
      return;
    }
    if (!this.blockItems.some((block) => block.name === name)) {
      this.discoveryError = 'Select a block from the current discovered inventory.';
      return;
    }
    if ((this.cardsRequest && requestBlockName(this.cardsRequest) !== name)
      || (name !== this.selectedBlock && (this.cardsState === 'collecting' || this.cardsBusy))) {
      this.resetCardsAnalysis();
    }
    if (name !== 'cards' && this.cardsState === 'restoring') {
      this.cardsController?.abort();
      this.cardsController = null;
      this.cardsBusy = false;
      this.cardsState = 'idle';
      this.cardsError = '';
    }
    this.selectedBlock = name;
    this.restoreCardsPointer();
    this.libraryCreationReceipt = null;
    this.restoreCreationReceipt();
    this.restoreLibraryPreview();
    this.detailOpen = true;
    this.invalidateLibraryProposal();
    this.updateComplete?.then(() => {
      if (!this.isConnected || this.selectedBlock !== name) return;
      const heading = this.querySelector('#block-detail-heading');
      if (window.matchMedia('(width >= 800px)').matches) {
        const pane = this.querySelector('.detail-pane');
        if (pane) pane.scrollTop = 0;
        heading?.focus({ preventScroll: true });
      } else {
        heading?.focus();
      }
    });
    if (name === this.pageFlow?.name && ['waiting', 'ready'].includes(this.pageFlow.status)) {
      await this.loadPageGeneration();
    }
  }

  backToBlocks() {
    this.detailOpen = false;
    this.updateComplete?.then(() => this.querySelector('.block-nav-item[aria-current="true"]')?.focus());
  }

  blockStatus(name) {
    const entry = this.libraryOverview?.blocks[name];
    const labels = {
      existing: 'In library',
      'missing-page': 'Registered page missing',
      unregistered: 'Unregistered page exists',
      error: 'Library check failed',
      'setup-required': 'Library setup required',
    };
    if (this.pageFlow?.name === name) {
      if (this.libraryCreating) return 'Saving changes';
      const states = {
        confirm: 'Confirmation required',
        waiting: 'Waiting for chat',
        ready: 'Ready to save',
        blocked: 'Needs input',
        failed: 'Action needs attention',
        partial: 'Action needs attention',
        running: 'Saving changes',
      };
      if (states[this.pageFlow.status]) return states[this.pageFlow.status];
    }
    if (entry?.codeStatus === 'missing') return 'Block code missing';
    if (entry && labels[entry.status]) return labels[entry.status];
    if (entry?.status === 'absent') return 'No library page';
    return 'Library not checked';
  }

  async refreshLibraryOverview() {
    const controller = new AbortController();
    this.libraryOverviewController?.abort();
    this.libraryOverviewController = controller;
    this.libraryOverviewBusy = true;
    this.libraryOverviewError = '';
    this.libraryOverview = null;
    this.libraryPreview = null;
    this.libraryCreationConfirmed = false;
    this.librarySetupProposal = null;
    this.librarySetupError = '';
    try {
      if (this.discoveryBlockReason) throw new Error(this.discoveryBlockReason);
      const target = this.probeTarget;
      if (this.context.org !== target.org || this.context.site !== target.site) {
        throw new Error('The library target no longer matches the selected site.');
      }
      const result = await inspectBlockLibrary({
        daFetch: this.hostActions.daFetch,
        target: this.probeTarget,
        blockNames: this.discoveryResult?.blocks.map((block) => block.name) || [],
        codeComplete: this.discoveryResult?.complete === true,
        signal: controller.signal,
      });
      if (this.isConnected && this.libraryOverviewController === controller
        && !controller.signal.aborted) {
        this.libraryOverview = result;
        this.chooseInitialBlock();
        this.restoreLibrarySetupReceipt();
      }
    } catch (error) {
      if (this.isConnected && this.libraryOverviewController === controller
        && !controller.signal.aborted) {
        this.libraryOverviewError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (this.libraryOverviewController === controller) {
        this.libraryOverviewBusy = false;
        this.libraryOverviewController = null;
      }
    }
  }

  async refreshBlocks() {
    await this.refreshWorkspace({ forceRefresh: true });
  }

  async refreshWorkspace({ forceRefresh = false } = {}) {
    if (this.workflowBusy || this.libraryOverviewBusy) return;
    this.resetLibraryOverview();
    await this.discoverInventory({ forceRefresh });
    if (this.isConnected && this.discoveryResult) {
      await this.refreshLibraryOverview();
      if (['waiting', 'ready'].includes(this.pageFlow?.status)) await this.loadPageGeneration();
    }
  }

  restoreLibrarySetupReceipt() {
    this.librarySetupReceipt = null;
    if (!this.probeTarget) return;
    try {
      this.librarySetupReceipt = loadLibrarySetupReceipt(window.localStorage, this.probeTarget);
    } catch (error) {
      this.librarySetupError = `Cannot restore the saved setup outcome: ${error.message}`;
    }
  }

  recordLibrarySetupReceipt(receipt) {
    saveLibrarySetupReceipt(window.localStorage, receipt);
    if (this.isConnected && this.isCurrentTarget(receipt.target)) {
      this.librarySetupReceipt = receipt;
    }
  }

  beginLibrarySetup() {
    if (this.workflowBusy || this.libraryOverviewBusy) return;
    this.librarySetupError = '';
    try {
      this.assertPageActionContext();
      if (this.pageFlow) throw new Error('Finish or cancel the pending page action before initializing the library.');
      const setup = this.libraryOverview?.setup;
      if (setup?.status !== 'required' || !this.isCurrentTarget(setup.target)) {
        throw new Error('Refresh the selected site before confirming its library setup.');
      }
      this.librarySetupProposal = setup;
    } catch (error) {
      this.librarySetupError = error instanceof Error ? error.message : String(error);
    }
  }

  cancelLibrarySetup() {
    if (this.workflowBusy) return;
    this.librarySetupProposal = null;
    this.librarySetupError = '';
  }

  async commitLibrarySetup() {
    if (this.workflowBusy || this.libraryOverviewBusy) return;
    const proposal = this.librarySetupProposal;
    const controller = new AbortController();
    this.libraryController = controller;
    this.librarySetupError = '';
    try {
      this.assertPageActionContext();
      if (!proposal || !this.isCurrentTarget(proposal.target) || this.pageFlow) {
        throw new Error('Confirm setup for the current site and finish any pending page action first.');
      }
      this.libraryBusy = true;
      this.libraryCreating = true;
      this.notice = '';
      const outcome = await initializeBlockLibrary({
        daFetch: this.hostActions.daFetch,
        target: this.probeTarget,
        proposal,
        signal: controller.signal,
        onProgress: (receipt) => this.recordLibrarySetupReceipt(receipt),
        allowNonAtomicConfig: proposal.registerLibrary,
      });
      this.recordLibrarySetupReceipt(outcome);
      this.librarySetupProposal = null;
      const previewed = await this.previewSavedLibrary(outcome, controller.signal);
      if (this.isConnected && !controller.signal.aborted) {
        await this.refreshLibraryOverview();
        if (this.libraryOverviewError) {
          throw new Error(`Setup was saved, but library status could not be refreshed: ${this.libraryOverviewError}`);
        }
        this.notice = previewed ? 'Block library is ready.' : 'Block library setup was saved. Preview needs attention.';
      }
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (error.outcome) {
        try {
          this.recordLibrarySetupReceipt(error.outcome);
        } catch (storageError) {
          message += ` Setup progress could not be saved: ${storageError.message}`;
        }
      }
      if (this.isConnected && this.libraryController === controller) {
        this.librarySetupProposal = null;
        this.librarySetupError = message;
      }
    } finally {
      if (this.libraryController === controller) {
        this.libraryBusy = false;
        this.libraryCreating = false;
        this.libraryController = null;
      }
    }
  }

  renderLibrarySetup() {
    const setup = this.libraryOverview?.setup;
    const receipt = this.librarySetupReceipt;
    const interrupted = receipt && receipt.status !== 'completed' && !this.libraryCreating;
    if (setup?.status !== 'required' && !interrupted && !this.librarySetupError) return '';
    const proposal = this.librarySetupProposal;
    const disabled = this.workflowBusy || this.libraryOverviewBusy || Boolean(this.pageFlow);
    return html`
      <section class="library-setup" aria-labelledby="library-setup-heading">
        <h2 id="library-setup-heading">Set up your block library</h2>
        ${setup?.status === 'required' ? html`
          <p>${setup.createIndex ? 'The library index does not exist yet.' : 'The existing index is not registered as the Blocks library.'}
            Initialize setup before creating example pages.</p>
          <p>Index: <code>${setup.paths.indexPath}</code><br>
            Example pages: <code>${setup.examplesDirectory}/&lt;block-name&gt;.html</code></p>
          ${proposal ? html`
            <p>Production DA: <strong>${this.context.org}/${this.context.site}</strong></p>
            <ul>
              <li>${proposal.createIndex ? 'Create the missing empty index without overwriting an existing file.' : 'Preserve the existing index and all its entries.'}</li>
              <li>${proposal.registerLibrary ? 'Add one Blocks registration, preserving existing configuration sheets and rows.' : 'Keep the existing Blocks registration and its configured location.'}</li>
            </ul>
            ${proposal.registerLibrary ? html`
              <p class="probe-notice">Configuration updates cannot be made atomic. The current
                configuration is rechecked immediately before saving; avoid concurrent configuration edits.</p>
            ` : ''}
            <p>The verified index will be previewed for the Blocks selector.
              No example pages will be generated. Nothing will be published.</p>
          ` : ''}
        ` : ''}
        ${this.libraryCreating ? html`<p role="status">Initializing the block library...</p>` : ''}
        ${renderProblem(this.librarySetupError, 'Library setup did not finish. Inspect the saved outcome, then refresh before another attempt.')}
        ${interrupted ? html`
          <p role="alert">Saved setup outcome: ${receipt.status}. Index: ${receipt.index}.
            Registration: ${receipt.registration}. A change may have succeeded.
            No automatic retry, rollback or deletion.</p>
        ` : ''}
        ${setup?.status === 'required' || interrupted ? html`
          <div class="page-actions setup-actions">
            ${setup?.status === 'required' ? html`
              ${proposal ? html`
                <button class="primary-action" type="button" ?disabled=${disabled}
                  @click=${this.commitLibrarySetup}>Confirm initialize library</button>
                <button type="button" ?disabled=${this.workflowBusy}
                  @click=${this.cancelLibrarySetup}>Cancel</button>
              ` : html`
                <button class="primary-action" type="button" ?disabled=${disabled}
                  @click=${this.beginLibrarySetup}>Initialize library</button>
              `}
            ` : ''}
            ${interrupted ? html`
              <button type="button" ?disabled=${this.workflowBusy || this.libraryOverviewBusy}
                @click=${this.refreshWorkspace}>Refresh library status</button>
            ` : ''}
          </div>
        ` : ''}
      </section>
    `;
  }

  pageFlowKey(environment = this.probeEnvironment) {
    const target = getProbeTarget(environment, { ...this.context, branch: this.discoveryRef });
    return `block-library-generator:page-flow:v2:${environment}:${target.org}:${target.site}:${target.branch}`;
  }

  savePageFlow(flow) {
    if (!this.probeTarget || (flow?.target && !this.isCurrentTarget(flow.target))
      || (flow && flow.environment !== this.probeEnvironment)) {
      throw new Error('The page action does not belong to the selected site and branch.');
    }
    const environment = flow?.environment || this.probeEnvironment;
    const value = flow ? { ...flow, target: flow.target || { ...this.probeTarget } } : null;
    window.localStorage.setItem(this.pageFlowKey(environment), JSON.stringify(value));
    if (environment === this.probeEnvironment) this.pageFlow = value;
  }

  restorePageFlow() {
    this.pageFlow = null;
    if (!this.probeTarget) return;
    try {
      let text = window.localStorage.getItem(this.pageFlowKey());
      let legacy = false;
      const target = this.probeTarget;
      if (text === null && target.org === 'msagolj' && target.site === 'ew' && target.branch === 'main') {
        text = window.localStorage.getItem(`block-library-generator:page-flow:${target.environment}:msagolj:ew`);
        legacy = text !== null;
      }
      if (!text) return;
      const flow = JSON.parse(text);
      if (flow === null) return;
      if (!['create', 'recreate', 'delete'].includes(flow.mode)
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(flow.name)
        || flow.environment !== this.probeEnvironment
        || !Number.isFinite(Date.parse(flow.startedAt))
        || (flow.jobId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(flow.jobId))) {
        throw new Error('Invalid saved page action.');
      }
      if ((flow.starter !== undefined && typeof flow.starter !== 'boolean')
        || (flow.starter && !['create', 'recreate'].includes(flow.mode))) {
        throw new Error('Invalid saved starter-page action.');
      }
      if ((!flow.target && !legacy) || (flow.target && !this.isCurrentTarget(flow.target))) {
        throw new Error('The saved page action belongs to another site or branch.');
      }
      if (flow.snapshot && (flow.snapshot.name !== flow.name
        || !this.isCurrentTarget(flow.snapshot.target))) {
        throw new Error('The saved action snapshot belongs to another site or branch.');
      }
      if (flow.jobKind && !['cards', 'analysis'].includes(flow.jobKind)) {
        throw new Error('Invalid saved analysis job kind.');
      }
      if (flow.status === 'completed') {
        this.savePageFlow(null);
      } else {
        this.pageFlow = { ...flow, target: flow.target || { ...target } };
      }
    } catch (error) {
      this.libraryError = `Cannot restore the saved page action: ${error.message}`;
    }
  }

  assertPageActionContext() {
    if (this.discoveryBlockReason) throw new Error(this.discoveryBlockReason);
    if (this.context.org !== this.probeTarget.org || this.context.site !== this.probeTarget.site) {
      throw new Error('The page action no longer matches the selected site.');
    }
  }

  generationPageMode(name) {
    const status = this.libraryOverview?.blocks[name]?.status;
    if (['existing', 'unregistered'].includes(status)) return 'recreate';
    if (['absent', 'missing-page'].includes(status)) return 'create';
    return null;
  }

  async beginPageAction(mode, { retryBlocked = false } = {}) {
    if (this.workflowBusy || this.libraryOverviewBusy) return;
    const name = this.selectedBlock;
    const entry = this.libraryOverview?.blocks[name];
    const controller = new AbortController();
    this.libraryController = controller;
    this.libraryBusy = true;
    this.libraryError = '';
    try {
      this.assertPageActionContext();
      if (!['create', 'delete', 'recreate'].includes(mode) || !entry || entry.status === 'error') {
        throw new Error('Refresh the library and choose a supported page action.');
      }
      if (this.libraryOverview?.setup?.status === 'required' || this.librarySetupProposal) {
        throw new Error('Initialize the block library before starting a page action.');
      }
      if (mode !== 'delete' && (!this.hasBlockCode(name) || this.cardsBlockReason)) {
        throw new Error(this.cardsBlockReason || 'Generation requires verified block code for the selected branch.');
      }
      if (mode === 'create' && !['absent', 'missing-page'].includes(entry.status)) {
        throw new Error('Create requires a missing, unregistered page. Refresh library status.');
      }
      if (mode !== 'create' && !['existing', 'unregistered'].includes(entry.status)) {
        throw new Error('This action requires an existing example page.');
      }
      const blockedRetry = retryBlocked && this.pageFlow?.status === 'blocked'
        && ['create', 'recreate'].includes(mode)
        && ['create', 'recreate'].includes(this.pageFlow.mode)
        && this.pageFlow.name === name && this.pageFlow.environment === this.probeEnvironment
        && this.isCurrentTarget(this.pageFlow.target);
      if (retryBlocked && !blockedRetry) {
        throw new Error('Retry requires the blocked analysis for the selected block and site.');
      }
      if (this.pageFlow && this.pageFlow.status !== 'completed' && !blockedRetry) {
        throw new Error('Finish or cancel the pending page action first. No work has been replaced.');
      }
      this.notice = '';
      const snapshot = mode === 'create' ? null : await prepareLibraryAction({
        daFetch: this.hostActions.daFetch,
        target: this.probeTarget,
        name,
        pagePath: entry.pagePath,
        signal: controller.signal,
      });
      if (this.isConnected && this.libraryController === controller && !controller.signal.aborted) {
        this.savePageFlow({
          mode,
          name,
          environment: this.probeEnvironment,
          status: 'confirm',
          startedAt: new Date().toISOString(),
          snapshot,
          error: '',
        });
      }
    } catch (error) {
      if (this.libraryController === controller && !controller.signal.aborted) {
        this.libraryError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (this.libraryController === controller) {
        this.libraryBusy = false;
        this.libraryController = null;
      }
    }
  }

  cancelPageAction() {
    if (this.workflowBusy) return;
    try {
      this.savePageFlow(null);
      this.libraryError = '';
    } catch (error) {
      this.libraryError = `Cannot clear the saved page action: ${error.message}`;
    }
  }

  async retryPageGeneration() {
    if (this.workflowBusy || this.libraryOverviewBusy) return;
    const flow = this.pageFlow;
    if (!flow || flow.status !== 'blocked' || !['create', 'recreate'].includes(flow.mode)) {
      this.libraryError = 'Select a blocked Create or Recreate analysis before retrying.';
      return;
    }
    const mode = this.generationPageMode(flow.name) || flow.mode;
    await this.beginPageAction(mode, { retryBlocked: true });
    if (this.pageFlow !== flow && this.pageFlow?.status === 'confirm'
      && this.pageFlow.name === flow.name && this.isCurrentTarget(this.pageFlow.target)) {
      this.resetCardsAnalysis();
    }
  }

  starterAnalysis() {
    const flow = this.pageFlow;
    this.assertPageActionContext();
    this.assertCardsReadable();
    const mode = this.generationPageMode(flow?.name);
    if (!['create', 'recreate'].includes(flow?.mode) || !['blocked', 'ready'].includes(flow.status)
      || (flow.status === 'ready' && (!flow.starter || flow.mode !== mode))
      || flow.name !== this.selectedBlock || !this.isCurrentTarget(flow.target)
      || flow.environment !== this.probeEnvironment || !this.hasBlockCode(flow.name)
      || !mode
      || this.cardsRequest?.jobId !== flow.jobId || this.cardsResult?.status !== 'completed') {
      throw new Error('A default example requires the current blocked analysis and a missing Create page or existing page to replace.');
    }
    const { analysis } = this.cardsResult.payload;
    validateCardsAnalysis(analysis, this.cardsRequest, (markup) => this.parseAnalysisHTML(markup));
    if (analysis.generation?.status !== 'blocked') {
      throw new Error('A default starter requires a blocked analysis.');
    }
    return analysis;
  }

  async prepareDefaultExample() {
    if (this.workflowBusy || this.libraryOverviewBusy) return;
    this.libraryError = '';
    let controller;
    try {
      const flow = this.pageFlow;
      if (!['create', 'recreate'].includes(flow?.mode) || flow.status !== 'blocked'
        || flow.name !== this.selectedBlock || !this.isCurrentTarget(flow.target)) {
        throw new Error('Select the current blocked Create or Recreate analysis before preparing a default example.');
      }
      await this.loadPageGeneration();
      if (this.cardsError) throw new Error(this.cardsError);
      this.starterAnalysis();
      const current = this.pageFlow;
      const mode = this.generationPageMode(current.name);
      controller = new AbortController();
      this.libraryController = controller;
      this.libraryBusy = true;
      const snapshot = mode === 'recreate' ? await prepareLibraryAction({
        daFetch: this.hostActions.daFetch,
        target: current.target,
        name: current.name,
        pagePath: this.libraryOverview.blocks[current.name].pagePath,
        expectedPaths: current.snapshot?.paths,
        signal: controller.signal,
      }) : null;
      if (!this.isConnected || controller.signal.aborted
        || this.libraryController !== controller || this.pageFlow !== current) return;
      this.savePageFlow({
        ...current, mode, snapshot, status: 'ready', starter: true, error: '',
      });
      this.invalidateLibraryProposal();
    } catch (error) {
      if (!controller || this.libraryController === controller) {
        this.libraryError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (controller && this.libraryController === controller) {
        this.libraryBusy = false;
        this.libraryController = null;
      }
    }
  }

  backToBlockedAnalysis() {
    if (this.workflowBusy || !this.pageFlow?.starter) return;
    try {
      const analysis = this.starterAnalysis();
      this.savePageFlow({
        ...this.pageFlow, status: 'blocked', starter: false, error: analysis.generation.reason,
      });
      this.invalidateLibraryProposal();
    } catch (error) {
      this.libraryError = error instanceof Error ? error.message : String(error);
    }
  }

  finishPageAction() {
    const flow = this.pageFlow;
    if (!flow) return;
    const past = { create: 'created', recreate: 'recreated', delete: 'deleted' };
    if (flow.starter) {
      const outcome = flow.mode === 'recreate' ? 'page replaced with a starter' : 'starter page created';
      this.notice = `${readableLabel(flow.name)} ${outcome}. Complete its placeholder values in DA.`;
    } else {
      this.notice = `${readableLabel(flow.name)} page ${past[flow.mode]}.`;
    }
    this.savePageFlow(null);
  }

  renderPendingAction() {
    const flow = this.pageFlow;
    if (!flow || !this.selectedBlock || this.discoveryBusy || this.libraryOverviewBusy
      || flow.name === this.selectedBlock || flow.status === 'completed') return '';
    return html`
      <section class="pending-action" role="status">
        <div><strong>${readableLabel(flow.name)}</strong>: ${this.blockStatus(flow.name)}.
          <p>Finish or cancel this action before starting another.</p></div>
        ${flow.jobId ? html`<p>Cancelling this action does not stop chat.</p>` : ''}
        <button type="button" ?disabled=${this.workflowBusy}
          @click=${() => this.selectBlock(flow.name)}>Resume</button>
        <button type="button" ?disabled=${this.workflowBusy}
          @click=${this.cancelPageAction}>Cancel action</button>
      </section>
    `;
  }

  async generatePageSuggestions() {
    const flow = this.pageFlow;
    if (!flow || flow.status !== 'confirm' || !['create', 'recreate'].includes(flow.mode)) {
      this.libraryError = 'Confirm a new Create or Recreate action first.';
      return;
    }
    if (this.selectedBlock !== flow.name || !this.hasBlockCode(flow.name)) {
      this.libraryError = 'The selected block/code no longer matches this generation action.';
      return;
    }
    this.cardsConfirmed = true;
    this.cardsNewConfirmed = true;
    await this.prepareCardsAnalysis();
    if (this.cardsState !== 'prepared' || !this.cardsRequest) return;
    try {
      if (Date.parse(this.cardsRequest.createdAt) < Date.parse(flow.startedAt)) {
        throw new Error('Recreation requires a fresh analysis, not an earlier saved result.');
      }
      this.savePageFlow({
        ...flow, jobId: this.cardsRequest.jobId, jobKind: this.cardsRequest.kind, status: 'waiting',
      });
      this.sendCardsAnalysis();
    } catch (error) {
      this.libraryError = error instanceof Error ? error.message : String(error);
    }
  }

  async loadPageGeneration() {
    const flow = this.pageFlow;
    if (!flow?.jobId || !['waiting', 'ready', 'blocked'].includes(flow.status)
      || flow.name !== this.selectedBlock || this.workflowBusy) return;
    await this.runCardsOperation(async (signal) => {
      const request = validateCardsRequest(await readJobRequest(
        this.hostActions.daFetch,
        flow.jobId,
        {
          environment: this.probeEnvironment, target: this.probeTarget, kind: flow.jobKind || 'cards', signal,
        },
      ));
      if (request.jobId !== flow.jobId || requestBlockName(request) !== flow.name
        || Date.parse(request.createdAt) < Date.parse(flow.startedAt)) {
        throw new Error('This page action requires its newly generated analysis.');
      }
      const result = await this.readCardsAnalysisResult(request, signal);
      return { request, result };
    }, ({ request, result }) => {
      this.cardsRequest = request;
      this.acceptCardsAnalysisResult(result);
      if (result?.status === 'completed') {
        const blocked = result.payload.analysis.generation?.status === 'blocked';
        const starter = ['create', 'recreate'].includes(flow.mode) && flow.starter === true && blocked;
        this.savePageFlow({
          ...flow,
          ...(flow.starter ? { starter } : {}),
          status: blocked && !starter ? 'blocked' : 'ready',
          error: blocked && !starter ? result.payload.analysis.generation.reason : '',
        });
      } else if (result?.status === 'error') {
        this.savePageFlow({ ...flow, status: 'failed', error: result.error });
      }
    }, { readOnly: true });
  }

  async commitPageAction() {
    const flow = this.pageFlow;
    if (this.workflowBusy) return;
    const permitted = flow && ((flow.mode === 'delete' && flow.status === 'confirm')
      || (flow.mode !== 'delete' && flow.status === 'ready'));
    if (!permitted || flow.name !== this.selectedBlock
      || flow.environment !== this.probeEnvironment) {
      this.libraryError = 'Confirm the current page action before changing content.';
      return;
    }
    this.libraryError = '';
    try {
      this.assertPageActionContext();
      if (flow.target && !this.isCurrentTarget(flow.target)) throw new Error('This action belongs to another site or branch.');
      if (flow.mode !== 'delete' && this.cardsBlockReason) throw new Error(this.cardsBlockReason);
      if (flow.mode !== 'delete') this.assertCardsReadable();
      if (flow.snapshot && (flow.snapshot.name !== flow.name
        || !this.isCurrentTarget(flow.snapshot.target))) {
        throw new Error('The saved action snapshot does not match this block/environment.');
      }
      if (flow.mode === 'create') {
        if (this.cardsRequest?.jobId !== flow.jobId || !this.hasBlockCode(flow.name)) {
          throw new Error('Fresh generation and current block code are required.');
        }
        this.libraryReviewConfirmed = true;
        await this.generateLibraryDryRun({ starter: flow.starter === true });
        if (!this.libraryPreview) throw new Error(this.libraryError || 'Could not prepare creation.');
        this.libraryCreationConfirmed = true;
        await this.createApprovedLibrary({ starter: flow.starter === true });
        if (this.libraryError || this.libraryCreationReceipt?.status !== 'completed'
          || this.libraryCreationReceipt.jobId !== flow.jobId) {
          throw new Error(this.libraryError || 'Creation is incomplete; check the saved outcome.');
        }
        this.savePageFlow({
          ...flow, status: 'completed', receipt: this.libraryCreationReceipt, error: '',
        });
        this.finishPageAction();
        return;
      }
      const controller = new AbortController();
      this.libraryController = controller;
      this.libraryBusy = true;
      this.libraryCreating = true;
      try {
        if (flow.mode === 'recreate' && (!this.hasBlockCode(flow.name)
          || this.cardsRequest?.jobId !== flow.jobId)) {
          throw new Error('Fresh generation and current block code are required for recreation.');
        }
        const onProgress = (receipt) => this.savePageFlow({
          ...flow, status: receipt.status, receipt, error: receipt.error,
        });
        const options = {
          daFetch: this.hostActions.daFetch,
          snapshot: flow.snapshot,
          signal: controller.signal,
          onProgress,
        };
        const outcome = flow.mode === 'delete'
          ? await deleteLibraryPage(options)
          : await replaceLibraryPage({
            ...options,
            allowNonAtomicReplace: flow.snapshot.pageETag === null,
            html: (flow.starter ? buildBlockStarterPage : buildCardsPage)(
              this.cardsRequest,
              flow.starter ? this.starterAnalysis() : this.selectedAnalysis(),
              (markup) => this.parseAnalysisHTML(markup),
            ),
          });
        const receipt = flow.starter ? { ...outcome, starter: true } : outcome;
        if (flow.starter) {
          this.savePageFlow({
            ...flow, status: 'completed', receipt, error: '',
          });
        }
        await this.previewSavedLibrary(receipt, controller.signal);
        if (flow.mode === 'recreate' && !flow.starter) {
          await this.cleanupSavedAnalysis(
            this.cardsRequest,
            { ...receipt, jobId: flow.jobId },
            controller.signal,
          );
        }
        this.savePageFlow({
          ...flow, status: 'completed', receipt, error: '',
        });
        this.finishPageAction();
      } finally {
        this.libraryBusy = false;
        this.libraryCreating = false;
        this.libraryController = null;
      }
      await this.refreshLibraryOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.libraryError = message;
      try {
        const creationReceipt = this.libraryCreationReceipt?.jobId === flow.jobId
          ? this.libraryCreationReceipt : null;
        this.savePageFlow({
          ...flow,
          status: error.outcome || creationReceipt?.status === 'partial' ? 'partial' : 'failed',
          receipt: error.outcome || creationReceipt,
          error: message,
        });
      } catch (storageError) {
        this.libraryError += ` Progress could not be saved: ${storageError.message}`;
      }
    }
  }

  renderStarterConfirmation(flow) {
    const disabled = this.workflowBusy || this.libraryOverviewBusy;
    const blocked = this.cardsResult?.status === 'completed'
      && this.cardsResult?.payload?.analysis?.generation?.status === 'blocked';
    const replacing = flow.mode === 'recreate';
    return html`
      <p role="status">One unfinished starter, not a working example.</p>
      <p>Open the saved page in DA to complete the block's placeholder values.
        It may render empty or report errors until completed.</p>
      <p>${replacing
    ? 'This replaces the whole page, including later author edits.'
    : 'No existing page will be replaced.'}
        The saved page and index will be previewed. Nothing is published.
        The blocked analysis is retained.</p>
      <div class="page-actions">
        <button class="primary-action" type="button" ?disabled=${disabled || !blocked}
          @click=${this.commitPageAction}>${replacing
  ? 'Confirm replace with starter page' : 'Confirm create starter page'}</button>
        <button type="button" ?disabled=${disabled}
          @click=${this.backToBlockedAnalysis}>Back</button>
      </div>
      ${renderProblem(this.libraryError, 'The starter page action could not be completed. Review the details.')}
    `;
  }

  renderCreateAction(flow) {
    const disabled = this.workflowBusy || this.libraryOverviewBusy;
    const receipt = flow.receipt || (flow.jobId
      && this.libraryCreationReceipt?.jobId === flow.jobId ? this.libraryCreationReceipt : null);
    const mayHaveSaved = flow.status === 'partial'
      || ['attempted', 'written', 'verified', 'unknown', 'different'].includes(receipt?.page);
    const saveStage = flow.status === 'ready' || this.libraryBusy || mayHaveSaved;
    const count = this.selectedExampleIds?.length;
    const readyMessage = count ? `${count} ${count === 1 ? 'example is' : 'examples are'} ready.` : 'Examples are ready.';
    const problem = this.cardsError || this.libraryError || flow.error;
    const failed = !['confirm', 'waiting', 'ready', 'blocked'].includes(flow.status);
    const failureSummary = mayHaveSaved
      ? 'Creation did not finish. The page or library entry may have been saved. Refresh and inspect before another action.'
      : 'Creation could not be completed. No library page was saved.';
    let progress = '';
    if (this.cardsBusy) {
      progress = this.cardsState === 'collecting' ? 'Preparing examples...' : 'Checking result...';
    } else if (this.libraryBusy) {
      progress = this.libraryCreating ? 'Saving library page...' : 'Checking the page and library...';
    }
    return html`
      <section class="workflow-card page-action-confirm" aria-label="Create library page"
        aria-busy=${this.workflowBusy ? 'true' : 'false'}>
        <h3>Create ${readableLabel(flow.name)} ${flow.starter ? 'starter' : 'library'} page</h3>
        <ol class="create-steps" aria-label="Creation steps">
          <li aria-current=${saveStage ? 'false' : 'step'}>Prepare examples</li>
          <li aria-current=${saveStage ? 'step' : 'false'}>Save library page</li>
        </ol>
        ${progress ? html`
          <div class="create-progress" role="status">
            <span class="startup-spinner" aria-hidden="true"></span><p>${progress}</p>
          </div>
        ` : ''}
        ${!this.workflowBusy && flow.status === 'confirm' ? html`
          <p>Prepare a prompt from this block's code. In the editor chat, review and send it,
            then approve the analysis result. Return here when it finishes.</p>
          <p>Examples use three bundled placeholder images. Missing placeholders will be
            added to this site's library media folder. Existing files are never overwritten.</p>
          <p>No library page will be saved until you confirm the next step.</p>
          <div class="page-actions">
            <button class="primary-action" type="button" ?disabled=${disabled}
              @click=${this.generatePageSuggestions}>Continue in chat</button>
            <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
          </div>
        ` : ''}
        ${!this.workflowBusy && flow.status === 'waiting' ? html`
          <p>Review and send the prepared prompt in the editor chat, then approve the analysis
            result. When chat finishes, reopen the generator and choose Check result.</p>
          ${this.cardsState === 'pending' ? html`
            <p role="status">No result yet. Let chat finish, approve any pending result write,
              then check again.</p>
          ` : ''}
          <p>No library page has been saved. Cancelling creation does not stop chat.</p>
          <div class="page-actions">
            <button class="primary-action" type="button" ?disabled=${disabled}
              @click=${this.loadPageGeneration}>Check result</button>
            <button type="button" ?disabled=${disabled}
              @click=${this.cancelPageAction}>Cancel creation</button>
          </div>
        ` : ''}
        ${!this.workflowBusy && flow.status === 'ready' && !flow.starter ? html`
          <p role="status">${readyMessage}</p>
          <p>Save the new library page and make its examples available in the Blocks selector.
            No existing page will be replaced. The saved page and index will be previewed.
            Nothing is published.</p>
          <p>After saving, open the page to review and edit the examples.</p>
          <div class="page-actions">
            <button class="primary-action" type="button" ?disabled=${disabled}
              @click=${this.commitPageAction}>Confirm create page</button>
            <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
          </div>
        ` : ''}
        ${!this.workflowBusy && flow.status === 'ready' && flow.starter
    ? this.renderStarterConfirmation(flow) : ''}
        ${flow.status === 'blocked' ? html`
          ${renderProblem(
    flow.error,
    'Working examples could not be generated from the block\'s code. No library page was saved.',
  )}
          <p>You can update the block's JavaScript or CSS and retry the analysis.
            Alternatively, create a default example page as a starting point,
            then edit the block in DA to provide usable values.</p>
          <div class="page-actions">
            <button class="primary-action" type="button"
              ?disabled=${disabled || Boolean(this.cardsBlockReason) || !this.hasBlockCode(flow.name)}
              @click=${this.retryPageGeneration}>Retry analysis</button>
            <button type="button"
              ?disabled=${disabled || Boolean(this.cardsBlockReason) || !this.hasBlockCode(flow.name)
                || !['absent', 'missing-page'].includes(this.libraryOverview?.blocks[flow.name]?.status)}
              @click=${this.prepareDefaultExample}>Create a default example page</button>
            <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Dismiss</button>
          </div>
          ${renderProblem(this.libraryError, 'The requested action could not be completed. Review the details, then try again.')}
        ` : ''}
        ${failed ? html`
          ${problem ? renderProblem(problem, failureSummary) : html`<p role="alert">${failureSummary}</p>`}
          ${mayHaveSaved ? html`
            <p>No automatic retry or rollback.</p>
            <button type="button" ?disabled=${disabled}
              @click=${this.refreshWorkspace}>Refresh current state</button>
          ` : ''}
          <button type="button" ?disabled=${disabled}
            @click=${this.cancelPageAction}>${mayHaveSaved ? 'Dismiss saved action' : 'Cancel creation'}</button>
        ` : ''}
        ${!failed && flow.status !== 'blocked' ? renderProblem(
    problem,
    'This step could not be completed. No library page was saved. Review the details before continuing.',
  ) : ''}
      </section>
    `;
  }

  renderPageAction() {
    let flow = this.pageFlow;
    if (!flow || flow.name !== this.selectedBlock || flow.status === 'completed') return '';
    if (flow.status === 'blocked' && ['create', 'recreate'].includes(flow.mode)) {
      flow = { ...flow, mode: this.generationPageMode(flow.name) || flow.mode };
    }
    if (flow.mode === 'create') return this.renderCreateAction(flow);
    const disabled = this.workflowBusy || this.libraryOverviewBusy;
    return html`
      <section class="workflow-card page-action-confirm" aria-label="Page action">
        <h3>${readableLabel(flow.mode)} ${readableLabel(flow.name)}</h3>
        ${flow.mode === 'delete' ? html`
          <p>This deletes the example page and removes its library-index entry.
            The updated index will be previewed.
            Block code, images and unrelated entries are not deleted.</p>
        ` : html`
          ${!flow.starter ? html`<p>Prepare a fresh analysis of ${readableLabel(flow.name)} in chat.
            Nothing is saved to the library until you confirm the result.</p>` : ''}
          ${flow.status === 'confirm' ? html`<p>Examples use three bundled placeholder images.
            Missing placeholders will be added to this site's library media folder.
            Existing files are never overwritten.</p>` : ''}
          ${flow.mode === 'recreate' && !flow.starter ? html`<p class="probe-error">
            Recreation replaces the whole page, including later author edits.
            The current page stays in place until replacement is ready and you confirm.</p>` : ''}
        `}
        ${flow.status === 'confirm' ? html`
          <button class=${flow.mode === 'delete' ? '' : 'primary-action'} type="button" ?disabled=${disabled}
            @click=${flow.mode === 'delete' ? this.commitPageAction : this.generatePageSuggestions}>
            ${flow.mode === 'delete' ? 'Confirm delete page and index entry' : 'Continue in chat'}
          </button>
          <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
        ` : ''}
        ${flow.status === 'waiting' ? html`
          <p>Chat handoff requested. Review and submit the prompt in chat, then approve the result
            write. Reopen this app to check it. No library page has been changed.
            Cancelling this action does not stop chat.</p>
          <button type="button" ?disabled=${disabled} @click=${this.loadPageGeneration}>Check result</button>
          <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel page action</button>
        ` : ''}
        ${flow.status === 'ready' && !flow.starter ? html`
          ${!this.libraryBusy ? html`<p>Fresh output is ready. It is not yet saved to the library.
            ${flow.mode === 'recreate' ? 'Confirm to discard the current page contents and replace it.' : ''}
            The verified page and index will be previewed. Nothing is published.</p>` : ''}
          <button class="primary-action" type="button" ?disabled=${disabled}
            @click=${this.commitPageAction}>${flow.mode === 'recreate' ? 'Confirm replace entire page' : 'Confirm create page'}</button>
          <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
        ` : ''}
        ${!this.workflowBusy && flow.status === 'ready' && flow.starter
    ? this.renderStarterConfirmation(flow) : ''}
        ${flow.starter && this.libraryBusy ? html`<p role="status">Saving starter page...</p>` : ''}
        ${flow.status === 'completed' ? html`<p role="status">Page action completed and readback verified.</p>
          <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Dismiss</button>` : ''}
        ${flow.status === 'blocked' ? html`
            ${renderProblem(
    flow.error,
    'Working examples could not be generated from the block\'s code. The existing library page was not changed.',
  )}
            <p>You can update the block's JavaScript or CSS and retry the analysis.
              Alternatively, start again with a default example by replacing the existing page.</p>
            <div class="page-actions">
              ${flow.mode === 'recreate' ? html`
                <button class="primary-action" type="button"
                  ?disabled=${disabled || Boolean(this.cardsBlockReason) || !this.hasBlockCode(flow.name)}
                  @click=${this.retryPageGeneration}>Retry analysis</button>
                <button type="button"
                  ?disabled=${disabled || Boolean(this.cardsBlockReason) || !this.hasBlockCode(flow.name)
                    || !['existing', 'unregistered'].includes(this.libraryOverview?.blocks[flow.name]?.status)}
                  @click=${this.prepareDefaultExample}>Replace with a default example page</button>
              ` : ''}
              <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Dismiss</button>
            </div>
            ${renderProblem(this.libraryError, 'The requested action could not be completed. Review the details, then try again.')}
        ` : ''}
        ${!['confirm', 'waiting', 'ready', 'completed', 'blocked'].includes(flow.status) ? html`
          <p role="alert">Outcome: ${flow.status}. ${flow.error}
            A page or index change may have succeeded. Refresh and inspect before another action.
            No automatic retry or rollback.</p>
          <button type="button" ?disabled=${disabled} @click=${this.refreshWorkspace}>Refresh current state</button>
          <button type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Dismiss saved action</button>
        ` : ''}
        ${renderProblem(this.cardsError, 'The analysis could not be checked. Review the details before starting another job.')}
      </section>
    `;
  }

  assertProbeAllowed() {
    const reason = this.probeBlockReason;
    if (reason) throw new Error(reason);
    if (!this.probeConfirmed) {
      throw new Error(`Confirm the ${this.probeEnvironmentLabel} target and main branch first.`);
    }
    if (this.probeRequest && this.probeRequest.target?.environment !== this.probeEnvironment) {
      throw new Error('The loaded probe belongs to a different environment. Resume the selected environment.');
    }
  }

  async runProbeOperation(operation, onSuccess) {
    if (this.probeBusy || this.cardsBusy || this.libraryBusy) {
      this.probeError = 'Another probe operation is still in progress.';
      return;
    }
    const controller = new AbortController();
    this.probeController = controller;
    try {
      this.assertProbeAllowed();
      this.probeBusy = true;
      this.probeError = '';
      this.probeResult = null;
      const value = await operation(controller.signal);
      if (this.isConnected && this.probeController === controller && !controller.signal.aborted) {
        onSuccess(value);
      }
    } catch (error) {
      if (this.isConnected && this.probeController === controller && !controller.signal.aborted) {
        this.probeError = error instanceof Error ? error.message : String(error);
        this.probeState = 'error';
      }
    } finally {
      if (this.probeController === controller) {
        this.probeBusy = false;
        this.probeController = null;
      }
    }
  }

  async prepareProbe() {
    await this.runProbeOperation(async (signal) => {
      if (this.savedProbe && !this.newProbeConfirmed) {
        throw new Error('Confirm replacing the saved resume pointer before preparing a new probe.');
      }
      const request = createProbeRequest({ environment: this.probeEnvironment });
      saveProbePointer(window.localStorage, request);
      this.savedProbe = { jobId: request.jobId, handoffRequested: false };
      this.probeRequest = null;
      this.handoffRequested = false;
      this.newProbeConfirmed = false;
      this.probeState = 'preparing';
      return persistProbeRequest(this.hostActions.daFetch, request, { signal });
    }, (request) => {
      this.probeRequest = request;
      this.probeState = 'prepared';
    });
  }

  async resumeProbe() {
    await this.runProbeOperation(async (signal) => {
      const environment = this.probeEnvironment;
      const pointer = loadProbePointer(window.localStorage, environment);
      if (!pointer) throw new Error('No saved probe is available on this app origin.');
      const request = await readProbeRequest(this.hostActions.daFetch, pointer.jobId, {
        signal, environment,
      });
      return { pointer, request };
    }, ({ pointer, request }) => {
      this.savedProbe = pointer;
      this.probeRequest = request;
      this.handoffRequested = pointer.handoffRequested;
      this.probeState = pointer.handoffRequested ? 'requested' : 'prepared';
    });
  }

  sendProbe() {
    try {
      this.assertProbeAllowed();
      if (this.probeBusy || !this.probeRequest) throw new Error('Prepare or resume the probe first.');
      if (this.handoffRequested) {
        throw new Error('Handoff was already requested. Check chat instead of resending this job.');
      }
      const prompt = createProbePrompt(this.probeRequest);
      saveProbePointer(window.localStorage, this.probeRequest, true);
      this.handoffRequested = true;
      this.savedProbe = { jobId: this.probeRequest.jobId, handoffRequested: true };
      this.probeError = '';
      this.probeState = 'requested';
      this.hostActions.setPrompt(prompt, { autoSend: false });
      this.hostActions.closeLibrary();
    } catch (error) {
      this.probeError = error instanceof Error ? error.message : String(error);
      if (!this.handoffRequested) this.probeState = 'error';
    }
  }

  async checkProbeResult() {
    await this.runProbeOperation((signal) => {
      if (!this.probeRequest) throw new Error('Prepare or resume the probe first.');
      return readProbeResult(this.hostActions.daFetch, this.probeRequest, { signal });
    }, (result) => {
      this.probeResult = result;
      if (!result) this.probeState = 'pending';
      else if (result.status === 'completed') this.probeState = 'received';
      else {
        this.probeState = 'agent-error';
        this.probeError = result.error;
      }
    });
  }

  get cardsBlockReason() {
    if (this.discoveryBlockReason) return this.discoveryBlockReason;
    if (!this.isEditorContext) {
      return this.hostContext.view === 'fullscreen'
        ? 'Create and Recreate require the editor extension. Chat integration is not available in Apps yet.'
        : 'Open the generator from a document of the selected site to create or recreate pages.';
    }
    if (this.context.org !== this.hostContext.editorOrg
      || this.context.site !== this.hostContext.editorSite) {
      return 'The selected site does not match the editor. Reopen from a document of that site.';
    }
    if (['setPrompt', 'closeLibrary'].some((name) => typeof this.hostActions[name] !== 'function')) {
      return 'This editor does not provide the required chat handoff. Open a supported editor.';
    }
    if (!this.context.path?.startsWith('/')) return 'Open an editor document before creating examples.';
    return this.hostContext.branch && this.discoveryRef.trim() !== this.hostContext.branch
      ? 'The code reference must match the editor site branch.' : '';
  }

  parseAnalysisHTML(markup) {
    const template = this.ownerDocument.createElement('template');
    template.innerHTML = markup;
    return template.content;
  }

  resetCardsAnalysis() {
    this.cardsController?.abort();
    this.cardsController = null;
    this.cardsBusy = false;
    this.cardsConfirmed = false;
    this.cardsNewConfirmed = false;
    this.cardsRequest = null;
    this.cardsResult = null;
    this.cardsState = 'idle';
    this.cardsError = '';
    this.cardsSaved = null;
    this.cardsHandoff = false;
    this.jobCleanupReceipt = null;
    this.jobCleanupError = '';
    this.resetLibraryDryRun();
  }

  restoreCardsPointer() {
    if (this.cardsBlockReason) return;
    try {
      const name = this.selectedBlock || 'cards';
      const pointer = loadJobPointer(window.localStorage, this.probeTarget, 'analysis', name);
      this.cardsSaved = pointer ? { ...pointer, kind: 'analysis' } : null;
      if (!pointer && name === 'cards') {
        const old = loadJobPointer(window.localStorage, this.probeTarget, 'cards');
        this.cardsSaved = old ? { ...old, kind: 'cards' } : null;
      }
      this.restoreJobCleanupReceipt();
    } catch (error) {
      this.cardsError = error.message;
      this.cardsState = 'error';
    }
  }

  restoreJobCleanupReceipt() {
    const pointer = this.cardsSaved;
    const name = this.selectedBlock || 'cards';
    const current = this.jobCleanupReceipt;
    if (current && this.isCurrentTarget(current.target) && current.blockName === name
      && (current.jobId === pointer?.jobId || (!pointer && current.status === 'completed'))) return;
    this.jobCleanupReceipt = null;
    this.jobCleanupError = '';
    if (!pointer || !this.probeTarget) return;
    try {
      const receipt = loadJobCleanupReceipt(window.localStorage, this.probeTarget, pointer.jobId);
      if (receipt && receipt.blockName !== name) throw new Error('Cleanup status belongs to another block.');
      this.jobCleanupReceipt = receipt;
      if (receipt && receipt.status !== 'completed') {
        this.jobCleanupError = receipt.error
          || 'Temporary analysis cleanup was interrupted. Some job files may remain.';
      }
    } catch (error) {
      this.jobCleanupError = `Cannot restore analysis cleanup status: ${error.message}`;
    }
  }

  recordJobCleanupReceipt(receipt) {
    saveJobCleanupReceipt(window.localStorage, receipt);
    if (this.isConnected && this.isCurrentTarget(receipt.target)
      && (this.selectedBlock || 'cards') === receipt.blockName
      && (!this.cardsRequest || this.cardsRequest.jobId === receipt.jobId)) {
      this.jobCleanupReceipt = receipt;
      this.jobCleanupError = receipt.status === 'failed' ? receipt.error : '';
    }
  }

  markPageActionSaved(request, completion) {
    const flow = this.pageFlow;
    if (flow?.jobId === request.jobId && ['create', 'recreate'].includes(flow.mode)) {
      this.savePageFlow({
        ...flow, status: 'completed', receipt: completion, error: '',
      });
    }
  }

  async cleanupSavedAnalysis(request, completion, signal) {
    try {
      if (completion.status !== 'completed' || completion.page !== 'verified'
        || completion.index !== 'verified') {
        throw new Error('Temporary analysis cleanup requires verified page and index saving.');
      }
      this.markPageActionSaved(request, completion);
      await cleanupCompletedAnalysisJob({
        daFetch: this.hostActions.daFetch,
        request,
        completion,
        storage: window.localStorage,
        onProgress: (receipt) => this.recordJobCleanupReceipt(receipt),
        signal,
      });
      if (this.cardsRequest?.jobId === request.jobId && this.isCurrentTarget(request.target)) {
        this.cardsRequest = null;
        this.cardsResult = null;
        this.cardsSaved = null;
        this.cardsState = 'idle';
        this.cardsHandoff = false;
        this.cardsConfirmed = false;
        this.cardsNewConfirmed = false;
        this.libraryDraft = '';
        this.selectedExampleIds = null;
        this.libraryPresentation = null;
      }
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      const receipt = error.outcome || {
        schemaVersion: 1,
        kind: 'job-cleanup',
        target: request.target,
        jobId: request.jobId,
        jobKind: request.kind,
        blockName: requestBlockName(request),
        status: 'failed',
        request: 'pending',
        result: 'pending',
        error: message,
        updatedAt: new Date().toISOString(),
      };
      try {
        saveJobCleanupReceipt(window.localStorage, receipt);
      } catch (storageError) {
        message += ` Cleanup status could not be saved: ${storageError.message}`;
      }
      if (this.isConnected && this.isCurrentTarget(request.target)
        && (this.selectedBlock || 'cards') === requestBlockName(request)
        && (!this.cardsRequest || this.cardsRequest.jobId === request.jobId)) {
        this.jobCleanupReceipt = receipt;
        this.jobCleanupError = message;
      }
    }
  }

  renderJobCleanupWarning() {
    if (!this.jobCleanupError) return '';
    const details = this.jobCleanupReceipt
      ? `Job ${this.jobCleanupReceipt.jobId}: ${this.jobCleanupError}` : this.jobCleanupError;
    const summary = this.jobCleanupReceipt
      ? 'The library page was saved, but temporary analysis data could not be fully removed. Your library page is unaffected.'
      : 'Temporary analysis cleanup status could not be read. Check the details before another action.';
    return renderProblem(details, summary);
  }

  restoreLibraryPreview() {
    this.libraryPreviewReceipts = [];
    this.libraryPreviewError = '';
    if (!this.probeTarget) return;
    try {
      this.libraryPreviewReceipts = loadLibraryPreviewReceipts(
        window.localStorage,
        this.probeTarget,
        this.selectedBlock,
      );
    } catch (error) {
      this.libraryPreviewError = `Cannot restore selector Preview status: ${error.message}`;
    }
  }

  async previewSavedLibrary(completion, signal) {
    const controller = this.libraryController;
    this.libraryPreviewing = true;
    this.libraryPreviewError = '';
    try {
      if (completion.mode === 'delete') {
        clearLibraryPagePreviewReceipt(window.localStorage, completion.target, completion.name);
      }
      const receipts = await previewLibraryContent({
        daFetch: this.hostActions.daFetch,
        completion,
        signal,
        onProgress: (receipt) => {
          saveLibraryPreviewReceipt(window.localStorage, receipt);
          if (this.isConnected && this.libraryController === controller
            && this.isCurrentTarget(receipt.target)) this.restoreLibraryPreview();
        },
      });
      return receipts.every((receipt) => receipt.status === 'completed');
    } catch (error) {
      if (this.isConnected && this.libraryController === controller
        && this.isCurrentTarget(completion.target)) {
        this.libraryPreviewError = error instanceof Error ? error.message : String(error);
      }
      return false;
    } finally {
      if (this.libraryController === controller) this.libraryPreviewing = false;
    }
  }

  renderLibraryPreviewWarning() {
    if (this.libraryPreviewing) return html`<p role="status">Preparing block selector previews...</p>`;
    const unfinished = this.libraryPreviewReceipts.filter((receipt) => receipt.status !== 'completed');
    if (!unfinished.length && !this.libraryPreviewError) return '';
    const details = [
      this.libraryPreviewError,
      ...unfinished.map((receipt) => `${receipt.sourcePath}: ${receipt.error || 'Preview was interrupted or not confirmed.'}`),
    ].filter(Boolean).join(' ');
    return html`
      ${renderProblem(details, unfinished.length
    ? 'DA changes were saved. The last selector Preview attempt was not confirmed; no rollback.'
    : 'Block selector Preview status could not be completed or restored. Review the details.')}
      <p>Open the listed files in DA and choose Preview, not Publish, then reload the editor.
        Cached missing-file responses may take a short time to clear.
        Reopening this app does not retry Preview automatically.</p>
    `;
  }

  assertCardsReadable() {
    if (this.cardsRequest && requestBlockName(this.cardsRequest) !== (this.selectedBlock || 'cards')) {
      throw new Error('The loaded analysis belongs to a different block.');
    }
    if (this.cardsBlockReason) throw new Error(this.cardsBlockReason);
    if (this.cardsRequest?.target.environment
      && this.cardsRequest.target.environment !== this.probeEnvironment) {
      throw new Error('The analysis job belongs to another service.');
    }
    if (this.cardsRequest && !this.isCurrentTarget(this.cardsRequest.target)) {
      throw new Error('The analysis job belongs to another site or branch.');
    }
  }

  assertCardsAllowed() {
    this.assertCardsReadable();
    if (!this.cardsConfirmed) throw new Error('Confirm the analysis target and scratch-only writes.');
  }

  async runCardsOperation(operation, onSuccess, { readOnly = false } = {}) {
    if (this.cardsBusy || this.probeBusy || this.libraryBusy) {
      this.cardsError = 'Another job operation is in progress.';
      return;
    }
    const controller = new AbortController();
    this.cardsController = controller;
    try {
      if (readOnly) this.assertCardsReadable();
      else this.assertCardsAllowed();
      this.resetLibraryDryRun();
      this.cardsBusy = true;
      this.cardsError = '';
      this.cardsResult = null;
      const value = await operation(controller.signal);
      if (this.isConnected && this.cardsController === controller && !controller.signal.aborted) {
        onSuccess(value);
      }
    } catch (error) {
      if (this.isConnected && this.cardsController === controller && !controller.signal.aborted) {
        this.cardsError = error instanceof Error ? error.message : String(error);
        this.cardsState = 'error';
      }
    } finally {
      if (this.cardsController === controller) {
        this.cardsBusy = false;
        this.cardsController = null;
      }
    }
  }

  async prepareCardsAnalysis() {
    await this.runCardsOperation(async (signal) => {
      if (this.cardsSaved && !this.cardsNewConfirmed) {
        throw new Error('Confirm replacing the saved analysis pointer first.');
      }
      this.cardsState = 'collecting';
      const input = await collectCardsInput({
        blockName: this.selectedBlock || 'cards',
        entryPaths: this.discoveryResult?.blocks
          .find((block) => block.name === (this.selectedBlock || 'cards'))?.files.map((file) => file.path),
        environment: this.probeEnvironment,
        target: this.probeTarget,
        daFetch: this.hostActions.daFetch,
        fetchLocal: (url, options) => window.fetch(url, options),
        signal,
      });
      input.images = await ensurePlaceholderImages({
        target: this.probeTarget,
        daFetch: this.hostActions.daFetch,
        fetchLocal: (url, options) => window.fetch(url, options),
        signal,
      });
      signal.throwIfAborted();
      const request = createCardsRequest({
        environment: this.probeEnvironment, target: this.probeTarget, input,
      });
      createCardsPrompt(request);
      saveJobPointer(window.localStorage, request);
      this.cardsSaved = { jobId: request.jobId, handoffRequested: false, kind: request.kind };
      this.cardsRequest = null;
      this.cardsHandoff = false;
      this.cardsNewConfirmed = false;
      await persistJobRequest(this.hostActions.daFetch, request, { signal });
      return request;
    }, (request) => {
      this.cardsRequest = request;
      this.cardsState = 'prepared';
    });
  }

  async resumeCardsAnalysis() {
    const readSaved = (signal) => this.readSavedCardsRequest(signal);
    await this.runCardsOperation(readSaved, ({ request, pointer }) => {
      this.cardsRequest = request;
      this.cardsSaved = pointer;
      this.cardsHandoff = pointer.handoffRequested;
      this.cardsState = pointer.handoffRequested ? 'requested' : 'prepared';
    }, { readOnly: true });
  }

  async readSavedCardsRequest(signal) {
    const name = this.selectedBlock || 'cards';
    let kind = 'analysis';
    let pointer = loadJobPointer(window.localStorage, this.probeTarget, kind, name);
    if (!pointer && name === 'cards') {
      kind = 'cards';
      pointer = loadJobPointer(window.localStorage, this.probeTarget, kind);
    }
    if (!pointer) throw new Error('No saved analysis exists for this site and branch.');
    const request = validateCardsRequest(await readJobRequest(
      this.hostActions.daFetch,
      pointer.jobId,
      {
        environment: this.probeEnvironment, target: this.probeTarget, kind, signal,
      },
    ));
    if (requestBlockName(request) !== name) throw new Error('Saved analysis belongs to another block.');
    createCardsPrompt(request);
    return { request, pointer: { ...pointer, kind } };
  }

  async readCardsAnalysisResult(request, signal) {
    const result = await readJobResult(this.hostActions.daFetch, request, { signal });
    if (result?.status === 'completed') {
      const parseHTML = (markup) => this.parseAnalysisHTML(markup);
      validateCardsAnalysis(result.payload.analysis, request, parseHTML);
    }
    return result;
  }

  acceptCardsAnalysisResult(result) {
    this.cardsResult = result;
    this.cardsState = result?.status || 'pending';
    if (result?.status === 'error') this.cardsError = result.error;
    if (result?.status === 'completed') {
      this.libraryDraft = JSON.stringify(result.payload.analysis, null, 2);
      this.ensureLibraryCopy(result.payload.analysis);
    }
  }

  async loadSavedCardsDraft() {
    if (!this.cardsSaved || this.workflowBusy
      || this.cardsResult?.status === 'completed') return;
    this.cardsState = 'restoring';
    await this.runCardsOperation(async (signal) => {
      const saved = await this.readSavedCardsRequest(signal);
      const result = await this.readCardsAnalysisResult(saved.request, signal);
      return { ...saved, result };
    }, ({ request, pointer, result }) => {
      this.cardsRequest = request;
      this.cardsSaved = pointer;
      this.cardsHandoff = pointer.handoffRequested;
      this.acceptCardsAnalysisResult(result);
    }, { readOnly: true });
  }

  sendCardsAnalysis() {
    try {
      this.assertCardsAllowed();
      if (this.cardsBusy || this.probeBusy || this.libraryBusy || !this.cardsRequest) {
        throw new Error('Prepare or resume the analysis request first.');
      }
      if (this.cardsHandoff) throw new Error('Chat handoff already requested; do not resend this job.');
      const prompt = createCardsPrompt(this.cardsRequest);
      saveJobPointer(window.localStorage, this.cardsRequest, true);
      this.cardsHandoff = true;
      this.cardsSaved = {
        jobId: this.cardsRequest.jobId, handoffRequested: true, kind: this.cardsRequest.kind,
      };
      this.cardsState = 'requested';
      this.cardsError = '';
      this.hostActions.setPrompt(prompt, { autoSend: false });
      this.hostActions.closeLibrary();
    } catch (error) {
      this.cardsError = error instanceof Error ? error.message : String(error);
    }
  }

  async checkCardsAnalysis() {
    await this.runCardsOperation(async (signal) => {
      if (!this.cardsRequest) throw new Error('Prepare or resume the analysis request first.');
      return this.readCardsAnalysisResult(this.cardsRequest, signal);
    }, (result) => this.acceptCardsAnalysisResult(result), { readOnly: true });
  }

  resetLibraryDryRun() {
    this.libraryController?.abort();
    this.libraryController = null;
    this.libraryDraft = '';
    this.libraryReviewConfirmed = false;
    this.libraryBusy = false;
    this.libraryPreview = null;
    this.libraryError = '';
    this.libraryCreating = false;
    this.libraryCreationConfirmed = false;
    this.selectedExampleIds = null;
    this.libraryPresentation = null;
    this.outputPreviewReady = false;
  }

  changeLibraryDraft(value) {
    this.resetLibraryDryRun();
    this.libraryDraft = value;
  }

  invalidateLibraryProposal() {
    this.libraryController?.abort();
    this.libraryController = null;
    this.libraryBusy = false;
    this.libraryPreview = null;
    this.libraryReviewConfirmed = false;
    this.libraryCreationConfirmed = false;
    this.libraryError = '';
    this.outputPreviewReady = false;
  }

  ensureLibraryCopy(analysis) {
    if (this.libraryPresentation === null) {
      const parseHTML = (markup) => this.parseAnalysisHTML(markup);
      this.libraryPresentation = createLibraryPresentation(analysis, parseHTML);
    }
    if (this.selectedExampleIds === null) {
      const defaults = this.libraryPresentation.filter((copy) => copy.selected);
      this.selectedExampleIds = defaults.map((copy) => copy.id);
    }
    return this.libraryPresentation;
  }

  selectedAnalysis() {
    let analysis;
    try {
      analysis = JSON.parse(this.libraryDraft);
    } catch (cause) {
      throw new Error('The reviewed analysis is not valid JSON.', { cause });
    }
    this.ensureLibraryCopy(analysis);
    return applyLibraryPresentation(analysis, this.libraryPresentation, this.selectedExampleIds);
  }

  toggleExample(id, checked) {
    if (this.libraryBusy) return;
    try {
      const analysis = JSON.parse(this.libraryDraft);
      if (!analysis.examples.some((example) => example.id === id)) {
        throw new Error('The example is not part of this draft.');
      }
      this.ensureLibraryCopy(analysis);
      const ids = new Set(this.selectedExampleIds);
      if (checked) ids.add(id);
      else ids.delete(id);
      this.invalidateLibraryProposal();
      this.selectedExampleIds = [...ids];
    } catch (error) {
      this.libraryError = `Cannot update example selection: ${error.message}`;
    }
  }

  editExample(id, field, value) {
    if (this.libraryBusy || !['name', 'description'].includes(field)) return;
    try {
      const analysis = JSON.parse(this.libraryDraft);
      this.ensureLibraryCopy(analysis);
      const copy = this.libraryPresentation.find((item) => item.id === id);
      if (!copy) throw new Error('The example is not part of this draft.');
      this.invalidateLibraryProposal();
      this.libraryPresentation = this.libraryPresentation.map((item) => (
        item.id === id ? { ...item, [field]: value } : item
      ));
    } catch (error) {
      this.libraryError = `Cannot update the reviewed example: ${error.message}`;
    }
  }

  previewLibraryOutput() {
    try {
      const analysis = this.selectedAnalysis();
      const parseHTML = (markup) => this.parseAnalysisHTML(markup);
      validateCardsAnalysis(analysis, this.cardsRequest, parseHTML);
      this.libraryError = '';
      this.outputPreviewReady = true;
      this.updateComplete?.then(() => this.querySelector('#library-output-heading')?.focus());
    } catch (error) {
      this.outputPreviewReady = false;
      this.libraryError = error instanceof Error ? error.message : String(error);
    }
  }

  async generateLibraryDryRun({ starter = false } = {}) {
    if (this.libraryBusy || this.cardsBusy || this.probeBusy) {
      this.libraryError = 'Another job operation is in progress.';
      return;
    }
    const controller = new AbortController();
    this.libraryController = controller;
    this.libraryPreview = null;
    this.libraryCreationConfirmed = false;
    this.libraryError = '';
    try {
      this.assertCardsReadable();
      if (this.cardsAlreadyExists) throw new Error(`${readableLabel(this.selectedBlock || 'cards')} already exists in the library. Overwrite is not supported.`);
      if (this.cardsState !== 'completed' || !this.cardsResult || !this.cardsRequest) {
        throw new Error('Load a validated analysis result before preparing a library page.');
      }
      if (!this.libraryReviewConfirmed) throw new Error('Review the dry-run draft and confirm it first.');
      if (new TextEncoder().encode(this.libraryDraft).byteLength > 1024 * 1024) {
        throw new Error('The dry-run draft exceeds the 1 MiB limit.');
      }
      const analysis = starter ? this.starterAnalysis() : this.selectedAnalysis();
      this.libraryBusy = true;
      const preview = await prepareCardsLibraryDryRun({
        daFetch: this.hostActions.daFetch,
        request: this.cardsRequest,
        analysis,
        signal: controller.signal,
        parseHTML: (markup) => this.parseAnalysisHTML(markup),
        allowRegistered: this.pageFlow?.mode === 'create',
        starter,
      });
      if (this.isConnected && this.libraryController === controller && !controller.signal.aborted) {
        this.libraryPreview = preview;
      }
    } catch (error) {
      if (this.isConnected && this.libraryController === controller && !controller.signal.aborted) {
        this.libraryError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (this.libraryController === controller) {
        this.libraryBusy = false;
        this.libraryController = null;
      }
    }
  }

  restoreCreationReceipt() {
    if (this.cardsBlockReason) return;
    try {
      this.libraryCreationReceipt = loadCreationReceipt(window.localStorage, this.probeTarget, this.selectedBlock || 'cards');
    } catch (error) {
      this.libraryError = error.message;
    }
  }

  recordCreationReceipt(receipt) {
    if (this.isCurrentTarget(receipt.target)
      && (receipt.blockName || 'cards') === (this.selectedBlock || 'cards')) {
      this.libraryCreationReceipt = receipt;
    }
    saveCreationReceipt(window.localStorage, receipt);
  }

  async runCreationOperation(verifyOnly, { starter = false } = {}) {
    if (this.libraryBusy || this.cardsBusy || this.probeBusy) {
      this.libraryError = 'Another job operation is in progress.';
      return;
    }
    const controller = new AbortController();
    this.libraryController = controller;
    this.libraryError = '';
    try {
      this.assertCardsReadable();
      if (!verifyOnly && this.cardsAlreadyExists) {
        throw new Error(`${readableLabel(this.selectedBlock || 'cards')} already exists in the library. Overwrite is not supported.`);
      }
      if (!verifyOnly && (!this.libraryCreationConfirmed || !this.libraryReviewConfirmed
        || !this.libraryPreview || !this.cardsRequest)) {
        throw new Error('Approve the exact current page/index proposal before creating content.');
      }
      if (verifyOnly && !this.libraryCreationReceipt) {
        throw new Error('No saved creation receipt exists for this environment.');
      }
      this.libraryBusy = true;
      this.libraryCreating = !verifyOnly;
      const request = this.cardsRequest;
      const result = verifyOnly
        ? await checkLibraryCreation({
          daFetch: this.hostActions.daFetch,
          receipt: this.libraryCreationReceipt,
          signal: controller.signal,
        })
        : await createCardsLibrary({
          daFetch: this.hostActions.daFetch,
          request,
          analysis: starter ? this.starterAnalysis() : this.selectedAnalysis(),
          proposal: this.libraryPreview,
          parseHTML: (markup) => this.parseAnalysisHTML(markup),
          signal: controller.signal,
          onProgress: (receipt) => this.recordCreationReceipt(receipt),
          allowRegistered: this.pageFlow?.mode === 'create',
          starter,
        });
      this.recordCreationReceipt(result);
      if (!verifyOnly) {
        this.markPageActionSaved(request, result);
        await this.previewSavedLibrary(result, controller.signal);
        if (!starter) await this.cleanupSavedAnalysis(request, result, controller.signal);
      }
      if (!verifyOnly && this.libraryController === controller) this.libraryPreview = null;
      if (!verifyOnly && this.isConnected && this.libraryController === controller
        && !controller.signal.aborted) await this.refreshLibraryOverview();
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (error.outcome) {
        try {
          this.recordCreationReceipt(error.outcome);
        } catch (storageError) {
          message += ` Receipt persistence failed: ${storageError.message}`;
        }
      }
      if (this.isConnected && this.libraryController === controller) this.libraryError = message;
    } finally {
      if (this.libraryController === controller) {
        this.libraryBusy = false;
        this.libraryCreating = false;
        this.libraryCreationConfirmed = false;
        this.libraryController = null;
      }
    }
  }

  createApprovedLibrary({ starter = false } = {}) {
    return this.runCreationOperation(false, { starter });
  }

  verifyLibraryCreation() {
    return this.runCreationOperation(true);
  }

  renderCreationReceipt() {
    const receipt = this.libraryCreationReceipt;
    if (!receipt) return '';
    const disabled = Boolean(this.cardsBlockReason)
      || this.libraryBusy || this.cardsBusy || this.probeBusy;
    return html`
      <div class="library-creation-receipt">
        <h3>Saved library creation outcome</h3>
        <p role="status">${receipt.target.environment}: ${receipt.status}.
          Page: ${receipt.page}. Index: ${receipt.index}.</p>
        ${receipt.error ? html`<p class="probe-error" role="alert">${receipt.error}</p>` : ''}
        <p>These two writes are not atomic. If interrupted or partial, content may exist.
          Check the saved outcome before further action. No automatic retry, rollback or deletion.
          Closing the dialog may interrupt readback, not undo an accepted write.</p>
        <button type="button" ?disabled=${disabled}
          @click=${this.verifyLibraryCreation}>Check saved creation outcome (read only)</button>
        <details>
          <summary>Creation receipt</summary>
          <pre>${JSON.stringify(receipt, null, 2)}</pre>
        </details>
      </div>
    `;
  }

  renderLibraryDryRun() {
    const existing = this.libraryOverview?.blocks[this.selectedBlock || 'cards'];
    if (this.cardsAlreadyExists) {
      return html`
        <div class="existing-library">
          <h3>Existing library stays unchanged</h3>
          <p>This preview does not update the existing Cards page. Overwriting is not supported.</p>
          <a href=${existing.editorURL} target="_blank" rel="noopener noreferrer">Open existing Cards page</a>
          ${this.libraryError ? html`<p class="probe-error" role="alert">${this.libraryError}</p>` : ''}
        </div>
      `;
    }
    if (this.cardsState !== 'completed' || !this.cardsResult) {
      return html`
        ${this.libraryError ? html`<p class="probe-error" role="alert">${this.libraryError}</p>` : ''}
        ${this.renderCreationReceipt()}
      `;
    }
    const disabled = Boolean(this.cardsBlockReason)
      || this.workflowBusy || this.libraryOverview?.blocks[this.selectedBlock || 'cards']?.status !== 'absent';
    const preview = this.libraryPreview;
    let status = 'Dry run does not write. Creation requires separate approval; publication is not enabled.';
    if (this.libraryBusy) status = 'Reading current library state.';
    if (this.libraryCreating) status = 'Creating the approved page/index with conditional writes.';
    return html`
      <div class="library-dry-run">
        <h3>Create the selected examples</h3>
        <p>Preview the library output, then prepare the destination changes.
          Creation still requires a separate approval.</p>
        ${!this.libraryOverview ? html`
          <p class="probe-notice">Check the current library before proposing creation.</p>
          <button type="button" ?disabled=${this.workflowBusy || this.libraryOverviewBusy}
            @click=${this.refreshLibraryOverview}>Check library status</button>
        ` : ''}
        <label class="probe-confirmation">
          <input type="checkbox" .checked=${this.libraryReviewConfirmed}
            ?disabled=${disabled || !this.outputPreviewReady}
            @change=${(event) => {
    this.libraryReviewConfirmed = event.target.checked;
    if (!this.libraryReviewConfirmed) this.libraryPreview = null;
  }}>
          I reviewed the selected examples. Prepare a proposal only; do not write or publish.
        </label>
        <div class="probe-actions">
          <button type="button" ?disabled=${disabled || !this.libraryReviewConfirmed || !this.outputPreviewReady}
            @click=${this.generateLibraryDryRun}>Review proposed changes</button>
        </div>
        <p role="status">${status}</p>
        ${this.libraryError ? html`<p class="probe-error" role="alert">${this.libraryError}</p>` : ''}
        ${preview ? html`
          <h4>Proposed changes - no writes performed</h4>
          <p>Create <code>${preview.destinations.pagePath}</code> and add one Cards row to
            <code>${preview.destinations.indexPath}</code>. Preserve all existing rows and metadata.
            No library registration change is proposed.</p>
          <details class="technical-details">
            <summary>Developer diagnostics: generated source and index (not example content)</summary>
            <h4>Generated HTML</h4><pre>${preview.operations[0].content}</pre>
            <h4>Index before</h4><pre>${JSON.stringify(preview.operations[1].before, null, 2)}</pre>
            <h4>Index after</h4><pre>${JSON.stringify(preview.operations[1].after, null, 2)}</pre>
          </details>
          <ul>${preview.warnings.map((warning) => html`<li>${warning}</li>`)}</ul>
          <label class="probe-confirmation">
            <input type="checkbox" .checked=${this.libraryCreationConfirmed}
              ?disabled=${disabled}
              @change=${(event) => { this.libraryCreationConfirmed = event.target.checked; }}>
            I approve creating ${preview.destinations.pagePath} and adding the Cards row to
            ${preview.destinations.indexPath} in ${this.probeEnvironmentLabel}.
            No overwrite, configuration change, deletion or publication.
          </label>
          <button type="button" ?disabled=${disabled || !this.libraryCreationConfirmed}
            @click=${this.createApprovedLibrary}>Create Cards page and register</button>
        ` : ''}
      </div>
    `;
  }

  renderFindings(value) {
    if (value === null || value === undefined) return html`<p>Not supplied.</p>`;
    if (Array.isArray(value)) {
      return value.length ? html`<ul class="findings-list">
        ${value.map((entry) => html`<li>${this.renderFindings(entry)}</li>`)}</ul>` : html`<p>None reported.</p>`;
    }
    if (typeof value !== 'object') return html`<span>${String(value)}</span>`;
    return html`<dl class="findings">
      ${Object.entries(value).map(([key, entry]) => html`
        <div><dt>${readableLabel(key)}</dt><dd>${this.renderFindings(entry)}</dd></div>
      `)}
    </dl>`;
  }

  renderExampleReview() {
    if (this.cardsResult?.status !== 'completed') return '';
    let analysis;
    try {
      analysis = JSON.parse(this.libraryDraft);
      if (!Array.isArray(analysis.examples)
        || analysis.examples.some((example) => !example
          || typeof example.name !== 'string' || typeof example.description !== 'string'
          || !Array.isArray(example.options) || !Array.isArray(example.body)
          || example.body.some((row) => !Array.isArray(row)))) {
        throw new Error('Examples must contain names, descriptions, options and row/cell arrays.');
      }
    } catch (error) {
      return html`<p class="probe-error" role="alert">Cannot display this draft: ${error.message}.
        Correct it under Advanced: edit analysis JSON below.</p>`;
    }
    let copies;
    try {
      copies = this.ensureLibraryCopy(analysis);
    } catch (error) {
      return html`<p class="probe-error" role="alert">Cannot prepare library copy: ${error.message}</p>`;
    }
    return html`
      <section class="workflow-card example-review" aria-labelledby="example-review-heading">
        <h3 id="example-review-heading">Choose examples</h3>
        <p>The names and descriptions below are library content. Analysis notes stay separate
          and are not copied to the library.</p>
        <p class="review-caution">Suggestions still need review. Advanced structures are optional.</p>
        <p>${this.selectedExampleIds.length}
          of ${analysis.examples.length} examples selected</p>
        ${copies.filter((copy) => !copy.advanced).map((copy) => this.renderLibraryChoice(copy, analysis))}
        ${copies.some((copy) => copy.advanced) ? html`
          <details class="advanced-examples">
            <summary>Optional advanced examples (not selected by default)</summary>
            <p>These contain images and text in the same cell. This is a content grouping,
              not a claim that every mixed structure is a recommended default.</p>
            ${copies.filter((copy) => copy.advanced).map((copy) => this.renderLibraryChoice(copy, analysis))}
          </details>
        ` : ''}
        <button class="primary-action" type="button" ?disabled=${this.workflowBusy || !this.selectedExampleIds.length}
          @click=${this.previewLibraryOutput}>Preview library output</button>
        ${this.libraryError ? html`<p class="probe-error" role="alert">${this.libraryError}</p>` : ''}
      </section>
    `;
  }

  renderLibraryChoice(copy, analysis) {
    const example = analysis.examples.find((item) => item.id === copy.id);
    return html`
          <article class="example-card">
            <label class="example-select">
              <input type="checkbox"
                .checked=${this.selectedExampleIds.includes(example.id)}
                ?disabled=${this.workflowBusy}
                @change=${(event) => this.toggleExample(example.id, event.target.checked)}>
              <strong>${copy.name}</strong>
            </label>
            <p>${copy.description}</p>
            <details><summary>Edit library name and description</summary>
            <label class="example-field">Library name
              <input type="text" .value=${copy.name} ?disabled=${this.workflowBusy}
                @input=${(event) => this.editExample(example.id, 'name', event.target.value)}>
            </label>
            <label class="example-field">Library description
              <textarea rows="2" .value=${copy.description} ?disabled=${this.workflowBusy}
                @input=${(event) => this.editExample(example.id, 'description', event.target.value)}></textarea>
            </label>
            </details>
          </article>
    `;
  }

  renderOutputNode(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    const children = [...node.childNodes].map((child) => this.renderOutputNode(child));
    switch (node.tagName) {
      case 'IMG': {
        const src = node.getAttribute('src');
        if (!this.cardsRequest.input.images.some((image) => image.src === src)) {
          return html`<p class="probe-error">Image is not in the approved asset set.</p>`;
        }
        const alt = node.getAttribute('alt') || 'Decorative image';
        return html`<figure class="output-image" role="img" aria-label=${alt} data-image-src=${src}>
          <span aria-hidden="true">Image</span><figcaption>${alt}</figcaption>
        </figure>`;
      }
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
        return html`<p class="output-content-heading">${children}</p>`;
      case 'P': return html`<p>${children}</p>`;
      case 'UL': return html`<ul>${children}</ul>`;
      case 'OL': return html`<ol>${children}</ol>`;
      case 'LI': return html`<li>${children}</li>`;
      case 'STRONG': case 'B': return html`<strong>${children}</strong>`;
      case 'EM': case 'I': return html`<em>${children}</em>`;
      case 'PRE': return html`<pre>${children}</pre>`;
      case 'CODE': return html`<code>${children}</code>`;
      case 'BLOCKQUOTE': return html`<blockquote>${children}</blockquote>`;
      case 'A': return html`<span class="output-link">${children}</span>
        <small class="output-link-destination"> (${node.getAttribute('href')})</small>`;
      case 'BR': return html`<br>`;
      default: return children;
    }
  }

  renderLibraryOutput() {
    if (!this.outputPreviewReady) return '';
    const analysis = this.selectedAnalysis();
    return html`
      <section class="workflow-card library-output" aria-labelledby="library-output-heading">
        <span class="output-label">Library content only</span>
        <h3 id="library-output-heading" tabindex="-1">This will appear in your library</h3>
        <p>Only these selected names, descriptions and block contents are proposed.
          Source reasoning, analysis warnings, prompts and job details are not included.</p>
        <p class="review-caution">Content preview with labelled image placeholders, not a live site render.
          Original image URLs are kept in the generated page. Your existing library is unchanged.</p>
        ${analysis.examples.map((example) => html`
          <article class="output-example">
            <h4>${example.name}</h4><p>${example.description}</p>
            <div class="output-rows">
              ${example.body.map((row) => html`<div class="output-row">
                ${row.map((markup) => html`<div class="output-cell">
                  ${[...this.parseAnalysisHTML(markup).childNodes].map((node) => this.renderOutputNode(node))}
                </div>`)}
              </div>`)}
            </div>
          </article>
        `)}
        ${this.renderLibraryDryRun()}
      </section>
    `;
  }

  renderCardsAnalysis() {
    const disabled = Boolean(this.cardsBlockReason) || !this.cardsConfirmed || this.workflowBusy;
    const readDisabled = Boolean(this.cardsBlockReason) || this.workflowBusy;
    const analysis = this.cardsResult?.payload?.analysis;
    const complete = this.cardsState === 'completed' && Boolean(analysis);
    const saved = Boolean(this.cardsSaved);
    let analysisSummary = 'Get example suggestions';
    if (saved) analysisSummary = 'Start a new analysis (optional)';
    if (complete) analysisSummary = 'Analysis details (not included in library)';
    const states = {
      idle: 'Start a new analysis or resume your saved job.',
      restoring: 'Loading saved suggestions (read only).',
      collecting: 'Collecting sources and approved assets; preparing the scratch request.',
      prepared: 'Inputs verified. Review the prompt in chat before submitting.',
      requested: 'Prompt handed to chat. Submit and approve there, then reopen and resume.',
      pending: 'No result yet. Check again after chat finishes writing.',
      completed: 'Draft received. Review its examples, warnings and evidence below.',
      error: 'Analysis needs attention.',
    };
    return html`
      ${!complete && saved ? html`
        <section class="workflow-card saved-suggestions">
          <h3>Saved example suggestions</h3>
          <p role="status">${this.cardsState === 'restoring'
    ? 'Loading the saved analysis. No new analysis or content write is started.'
    : states[this.cardsState]}</p>
          <p>Viewing a saved result does not require write approval.</p>
          ${this.cardsError ? html`<p class="probe-error" role="alert">${this.cardsError}</p>` : ''}
          <button type="button" ?disabled=${readDisabled}
            @click=${this.loadSavedCardsDraft}>Load saved suggestions (read only)</button>
        </section>
      ` : ''}
      ${complete ? html`<p class="saved-suggestions-note review-caution">
        Saved suggestions loaded from the earlier analysis. They are not a live read of the existing
        library page, and viewing them does not update it.</p>` : ''}
      ${complete ? this.renderExampleReview() : ''}
      ${complete ? this.renderLibraryOutput() : ''}
      ${this.libraryCreationReceipt && this.libraryCreationReceipt.status !== 'completed'
    ? this.renderCreationReceipt() : ''}
      <details class="analysis-details" ?open=${!complete && !saved}>
      <summary>${analysisSummary}</summary>
      <section class="workflow-card cards-analysis">
        <h3>${complete ? 'Analysis job' : 'Get Cards examples'}</h3>
        <p>Analyse Cards JS/CSS and shared styles on <strong>${this.discoveryRef}</strong>.
          Uses up to six existing images and the verified <code>/index</code> example link.
          Only job request/result files are written at this step.</p>
        ${this.cardsBlockReason ? html`<p class="probe-notice">${this.cardsBlockReason}</p>` : ''}
        <label class="probe-confirmation">
          <input type="checkbox" .checked=${this.cardsConfirmed}
            ?disabled=${Boolean(this.cardsBlockReason) || this.workflowBusy}
            @change=${(event) => { this.cardsConfirmed = event.target.checked; }}>
          I confirm ${this.probeEnvironmentLabel} msagolj/ew/main for this analysis.
          Authorize only scratch request/result writes, not library changes.
        </label>
        <div class="probe-actions">
          ${this.cardsSaved ? html`
            <button type="button" ?disabled=${readDisabled}
              @click=${this.resumeCardsAnalysis}>Resume saved analysis</button>
          ` : ''}
          <button class="primary-action" type="button"
            ?disabled=${disabled || (this.cardsSaved && !this.cardsNewConfirmed)}
            @click=${this.prepareCardsAnalysis}>${this.cardsSaved ? 'Prepare new analysis' : 'Prepare analysis'}</button>
          <button type="button" ?disabled=${disabled || !this.cardsRequest || this.cardsHandoff}
            @click=${this.sendCardsAnalysis}>Review prompt in chat</button>
          <button type="button" ?disabled=${readDisabled || !this.cardsRequest}
            @click=${this.checkCardsAnalysis}>Check analysis result</button>
        </div>
        ${this.cardsSaved ? html`
          <details><summary>Start another analysis</summary>
            <label class="probe-confirmation">
              <input type="checkbox" .checked=${this.cardsNewConfirmed} ?disabled=${disabled}
                @change=${(event) => { this.cardsNewConfirmed = event.target.checked; }}>
              Replace the saved resume pointer. Previous files remain; earlier chat is not cancelled.
            </label>
          </details>
        ` : ''}
        <p role="status">${this.cardsBusy ? 'Analysis operation in progress.' : states[this.cardsState]}</p>
        ${this.cardsError ? html`<p class="probe-error" role="alert">${this.cardsError}</p>` : ''}
        ${complete ? html`
          <p>Everything in this section is review-only, not library copy.</p>
          <div class="analysis-summary">
            ${[['Options', analysis.optionAnalysis], ['Structure', analysis.structure],
    ['Content rules', analysis.contentRules], ['Derived behavior', analysis.derivedBehavior],
    ['Shared behavior', analysis.sharedBehavior], ['Warnings', analysis.warnings],
    ['Unknowns', analysis.unknowns]].map(([label, value]) => html`
              <details><summary>${label}</summary>${this.renderFindings(value)}</details>
            `)}
            <details><summary>Example reasoning (not library descriptions)</summary>
              ${analysis.examples.map((example) => html`
                <h4>${example.name}</h4>
                ${this.renderFindings({
    implementationNotes: example.description,
    assumptions: example.assumptions,
    evidence: example.evidence,
  })}
              `)}
            </details>
          </div>
        ` : ''}
        <details class="technical-details"><summary>Developer diagnostics (not included in library)</summary>
          ${this.cardsSaved ? html`<p>Job: <code>${this.cardsSaved.jobId}</code></p>` : ''}
          ${this.cardsRequest ? html`
            <details><summary>Captured inputs</summary><pre>${JSON.stringify(this.cardsRequest, null, 2)}</pre></details>
            <details><summary>Chat prompt</summary><pre>${createCardsPrompt(this.cardsRequest)}</pre></details>
          ` : ''}
          ${this.cardsResult ? html`<pre>${JSON.stringify(this.cardsResult, null, 2)}</pre>` : ''}
          ${complete ? html`
            <details><summary>Advanced: edit analysis JSON (local copy)</summary>
              <p>This edits analysis notes/recipes, not library copy. It resets local names,
                descriptions and example selection; review them again afterward.</p>
              <label class="library-draft-label">Reviewed analysis JSON
                <textarea rows="12" .value=${this.libraryDraft} ?disabled=${this.libraryBusy}
                  @input=${(event) => this.changeLibraryDraft(event.target.value)}></textarea>
              </label>
            </details>
          ` : ''}
          ${this.renderCreationReceipt()}
        </details>
      </section>
      </details>
    `;
  }

  renderSiteTarget() {
    if (window.parent === window) {
      return html`
        <section class="launch-notice" aria-labelledby="launch-notice-heading">
          <h2 id="launch-notice-heading">Open through DA</h2>
          <p>This page was opened directly. It needs a DA host to provide an
            authenticated session; entering a site here cannot sign you in.</p>
          <ol>
            <li>Open <a href="https://da.live/" target="_blank" rel="noopener noreferrer">DA</a>
              and sign in.</li>
            <li>Open a document on your target site.</li>
            <li>Choose <strong>Outline</strong>, then <strong>Block Library Generator</strong>.</li>
          </ol>
          <p>For local development, launch the configured editor extension pointing to this app URL.
            You can also use DA Apps when this app version is registered there.</p>
        </section>
      `;
    }
    if (this.connectionState !== 'ready') return '';
    if (!this.isEditorContext && this.choosingSite) return this.renderSiteChooser();
    const refreshing = this.discoveryBusy || this.libraryOverviewBusy;
    return html`
      <section class="target-bar" aria-label="Current target">
        <div><span class="eyebrow">Site</span><strong>${this.context.org && this.context.site
    ? `${this.context.org}/${this.context.site}` : 'No site selected'}</strong></div>
        ${!this.isEditorContext && this.context.org ? html`
          <button class="target-change" type="button"
            ?disabled=${this.workflowBusy || Boolean(this.pageFlow)
              || Boolean(this.librarySetupProposal) || refreshing}
            @click=${this.beginSiteSelection}>Change site</button>
        ` : ''}
        <button class="target-refresh primary-action" type="button"
          ?disabled=${Boolean(this.discoveryBlockReason) || refreshing || this.workflowBusy}
          @click=${this.refreshBlocks}>${refreshing ? 'Refreshing...' : 'Refresh blocks'}</button>
      </section>
    `;
  }

  renderSiteChooser() {
    if (window.parent === window || this.connectionState !== 'ready'
      || this.isEditorContext || !this.choosingSite) return '';
    return html`
      <section class="site-chooser" aria-labelledby="site-chooser-heading">
        <h2 id="site-chooser-heading">Choose a site</h2>
        <p>Select the content site whose block library you want to manage.</p>
        <form @submit=${(event) => { event.preventDefault(); this.applySiteTarget(); }}>
          <div class="site-fields">
            <label>Organization
              <input id="target-org" type="text" required autocomplete="off" spellcheck="false"
                .value=${this.manualOrg}
                @input=${(event) => { this.manualOrg = event.target.value; }}>
            </label>
            <label>Site
              <input id="target-site" type="text" required autocomplete="off" spellcheck="false"
                .value=${this.manualSite}
                @input=${(event) => { this.manualSite = event.target.value; }}>
            </label>
          </div>
          ${this.targetError ? html`<p class="probe-error" role="alert">${this.targetError}</p>` : ''}
          <div class="site-actions">
            <button class="primary-action" type="submit"
              ?disabled=${this.connectionState !== 'ready' || !this.hasToken || this.workflowBusy
                || this.discoveryBusy || this.libraryOverviewBusy}>Use site</button>
            ${this.context.org && this.context.site ? html`
              <button type="button"
                ?disabled=${this.workflowBusy || this.discoveryBusy || this.libraryOverviewBusy}
                @click=${this.cancelSiteSelection}>Cancel</button>
            ` : ''}
          </div>
        </form>
      </section>
    `;
  }

  renderBlockDetail() {
    const name = this.selectedBlock;
    if (!name) {
      return html`
      <div class="empty-state"><h2>Select a block</h2>
        <p>Refresh blocks to read the site inventory, then choose a block to inspect.</p></div>
    `;
    }
    const entry = this.libraryOverview?.blocks[name];
    const supported = this.hasBlockCode(name) && !this.cardsBlockReason;
    const actionDisabled = this.workflowBusy || Boolean(this.pageFlow);
    const creating = this.pageFlow?.name === name && this.pageFlow.mode === 'create'
      && this.pageFlow.status !== 'completed';
    return html`
      <section class="block-detail probe" aria-labelledby="block-detail-heading">
        <button class="back-to-blocks" type="button"
          @click=${this.backToBlocks}>Back to blocks</button>
        <header class="detail-header">
          <div><p class="eyebrow">Selected block</p><h2 id="block-detail-heading" tabindex="-1">${readableLabel(name)}</h2></div>
          <span class="status-badge" data-state=${entry?.status || 'unknown'}>${this.blockStatus(name)}</span>
        </header>
        ${entry?.pagePath ? html`<p class="page-location">${['absent', 'missing-page'].includes(entry.status)
    ? 'Page to be created:' : 'Example page:'} <code>${entry.pagePath}</code></p>` : ''}
        ${entry?.status === 'error'
    ? renderProblem(entry.error, 'This library page could not be verified. Refresh its status before making changes.') : ''}
        ${entry?.status === 'missing-page' ? html`<p class="probe-error" role="alert">
          This block is registered but its page is missing. Create will restore the missing page
          without adding another index entry.</p>` : ''}
        ${entry?.status === 'setup-required' ? html`<p class="probe-notice">
          Initialize the site's block library before creating example pages.</p>` : ''}
        ${entry?.codeStatus === 'missing' ? html`<p class="probe-notice">
          Block code missing. This library page has no matching block in the complete code inventory.
          You can open or delete it; recreation is unavailable.</p>` : ''}
        ${entry?.codeStatus === 'unknown' ? html`<p class="probe-notice">
          Block code status is unknown because discovery was unavailable or incomplete.</p>` : ''}
        ${entry && ['existing', 'unregistered'].includes(entry.status) ? html`
          <div class="page-actions">
            <a class="page-open primary-action" href=${entry.editorURL} target="_blank" rel="noopener noreferrer">Open</a>
            <button type="button" ?disabled=${actionDisabled}
              @click=${() => this.beginPageAction('delete')}>Delete</button>
            <button type="button" ?disabled=${actionDisabled || !supported}
              @click=${() => this.beginPageAction('recreate')}>Recreate</button>
          </div>
        ` : ''}
        ${entry && ['absent', 'missing-page'].includes(entry.status) && !creating ? html`
          <div class="page-actions">
            <button class="primary-action" type="button"
              ?disabled=${actionDisabled || !supported}
              @click=${() => this.beginPageAction('create')}>Create</button>
          </div>
        ` : ''}
        ${!supported ? html`<p class="review-caution">${this.cardsBlockReason
    || 'Generation requires verified block code for this branch.'}
          Existing pages can still be opened or deleted.</p>` : ''}
        ${!creating ? renderProblem(this.libraryError, 'The page action could not be completed. Refresh and inspect the current page before retrying.') : ''}
        ${!creating && this.cardsBusy ? html`<p role="status">${this.cardsState === 'collecting'
    ? 'Preparing analysis...' : 'Checking analysis...'}</p>` : ''}
        ${!creating && this.libraryBusy ? html`<p role="status">${this.libraryCreating
    ? 'Saving changes...' : 'Checking the current page and library...'}</p>` : ''}
        ${this.renderPageAction()}
      </section>
    `;
  }

  renderDiscovery() {
    const result = this.discoveryResult;
    const blocked = this.discoveryBlockReason;
    const providers = {
      'code-bus': 'Synced code (Helix 6)',
      github: 'Repository source (public GitHub)',
      manual: 'Manually supplied names',
    };
    return html`
      <section class="discovery" aria-labelledby="discovery-heading">
        <h2 id="discovery-heading">Available blocks</h2>
        <p>
          Discover entry files for ${this.context.org || 'the editor organization'}/${this.context.site || 'site'}.
          Code inspection is read-only. Complete inventories are saved as shared metadata under
          this site's <code>/.da/block-library-generator/cache/</code> folder.
          No code sync, migration, publishing or chat submission.
          Code metadata uses the global Admin/API services and your existing permissions.
        </p>
        <div class="discovery-inputs">
          <p>Site code branch: <strong>${this.discoveryRef}</strong> (not the plugin reference).</p>
          <label>
            Public GitHub fallback repository (optional override)
            <input type="text" .value=${this.githubRepository} placeholder="owner/repository"
              @input=${(event) => this.changeDiscoveryInput('repository', event.target.value)}>
          </label>
        </div>
        ${blocked ? html`<p class="discovery-notice">${blocked}</p>` : ''}
        <button type="button" ?disabled=${Boolean(blocked) || this.discoveryBusy}
          @click=${() => this.discoverInventory({ forceRefresh: true })}>Discover blocks</button>
        <p role="status">
          ${this.discoveryBusy ? 'Discovering blocks and checking entry files.' : ''}
          ${result?.provider ? `${result.blocks.length} block candidates from ${providers[result.provider]}.` : ''}
          ${result && !result.provider ? 'Automatic discovery is unavailable. Review the errors, retry with a public repository, or enter names below.' : ''}
        </p>
        ${result?.cache ? html`<p>Code inventory last refreshed: ${result.cache.updatedAt}.
          ${result.cache.fromCache ? 'Loaded from the shared saved list.' : 'Discovered in this session.'}
          Refresh blocks checks for code changes. Library-page checks are always fresh.</p>` : ''}
        ${this.discoveryError ? html`<p class="discovery-error" role="alert">${this.discoveryError}</p>` : ''}
        ${result?.diagnostics.length ? html`
          <div class="discovery-notice">
            <strong>Provider diagnostics</strong>
            <ul>${result.diagnostics.map((entry) => html`<li>${entry.provider}: ${entry.message}</li>`)}</ul>
          </div>
        ` : ''}
        ${result?.provider ? html`
          <p>
            ${result.provider === 'code-bus' ? 'Complete entry-file inventory of the listed synced code, not an authorability guarantee.' : ''}
            ${result.provider === 'github' ? 'Repository inventory, not proof that these files are synced or available on the site.' : ''}
            ${result.provider === 'manual' ? 'Completeness and source-file availability are unverified.' : ''}
          </p>
          ${result.coordinates ? html`
            <p>
              Code repository: ${result.coordinates.owner || 'unresolved'}/${result.coordinates.repo || 'unresolved'};
              GitHub: ${result.coordinates.githubRepository || 'unresolved'};
              branch/reference: ${result.coordinates.ref}.
            </p>
          ` : ''}
          ${result.revision ? html`<p>GitHub revision: <code>${result.revision}</code></p>` : ''}
          <ul class="discovery-blocks">
            ${result.blocks.map((block) => html`
              <li>
                <strong>${block.name}</strong>
                ${block.files.length ? html`
                  <ul>${block.files.map((file) => html`<li><code>${file.path}</code></li>`)}</ul>
                ` : html`<p>Names only; no entry files verified.</p>`}
              </li>
            `)}
          </ul>
          ${!result.blocks.length ? html`<p>No conventional block entry files were found.</p>` : ''}
        ` : ''}
        <details ?open=${Boolean(result && !result.provider)}>
          <summary>Manual block names</summary>
          <label>
            Names separated by commas, spaces, or new lines; no options or paths
            <textarea rows="4" .value=${this.manualBlockNames}
              @input=${(event) => { this.manualBlockNames = event.target.value; }}></textarea>
          </label>
          <button type="button" ?disabled=${Boolean(blocked) || this.discoveryBusy}
            @click=${this.useManualBlocks}>Use manual block names</button>
        </details>
      </section>
    `;
  }

  renderProbe() {
    const target = this.probeTarget;
    const label = this.probeEnvironmentLabel;
    const blocked = this.probeBlockReason;
    const disabled = Boolean(blocked) || !this.probeConfirmed || this.probeBusy;
    const statuses = {
      idle: 'No probe prepared.',
      preparing: `Writing and reading back the ${label} request.`,
      prepared: 'Request readback verified. Ready to review the prompt in chat.',
      requested: 'Handoff requested; submission and execution are not acknowledged. Check chat.',
      pending: 'No result received yet (HTTP 404). Refresh after the chat write completes.',
      received: 'Matching probe result received. Confirm the actual write tool operation in chat.',
      'agent-error': 'The agent reported a probe error.',
      error: 'Probe operation failed.',
    };
    return html`
      <section class="probe" aria-labelledby="probe-heading">
        <h2 id="probe-heading">${label} storage / chat probe</h2>
        ${this.probeEnvironment === 'prod' ? html`
          <p class="probe-notice">
            <strong>Production test:</strong> preparing this probe creates a real production
            scratch request. Submitting in chat may create its production result.
            Only msagolj/ew is allowed; there is no fallback to Stage.
          </p>
        ` : ''}
        <p>
          Target: ${label} <strong>msagolj/ew</strong>, site code branch <strong>main</strong>.
          Only this run's scratch files under <code>/.da/block-library-generator/jobs/</code>
          may be written. No Cards analysis, library writes, or publication.
        </p>
        <dl class="context-fields" aria-label="Probe target">
          <div class="context-field">
            <dt>DA admin</dt><dd>${target.adminOrigin}</dd>
          </div>
          <div class="context-field">
            <dt>Host environment</dt>
            <dd>${this.hostContext.daOrigin || `Not supplied; verify the editor and chat use ${label} before confirming.`}</dd>
          </div>
          <div class="context-field">
            <dt>Site code branch</dt>
            <dd>${this.hostContext.branch || 'Not supplied; explicitly confirm main below. Plugin ref is not used.'}</dd>
          </div>
        </dl>
        ${blocked ? html`<p class="probe-notice">${blocked}</p>` : ''}
        <label class="probe-confirmation">
          <input type="checkbox"
            .checked=${this.probeConfirmed}
            ?disabled=${Boolean(blocked) || this.probeBusy}
            @change=${(event) => { this.probeConfirmed = event.target.checked; }}>
          I confirm that the parent editor and chat are using ${label} msagolj/ew,
          the site code branch is main, and I authorize only this run's scratch request/result
          in ${label}. If chat cannot target ${label}, it must not write.
        </label>
        ${this.savedProbe ? html`
          <label class="probe-confirmation">
            <input type="checkbox"
              .checked=${this.newProbeConfirmed}
              ?disabled=${disabled}
              @change=${(event) => { this.newProbeConfirmed = event.target.checked; }}>
            Preparing a new probe replaces the resume pointer, keeps previous scratch files,
            and does not cancel any previous chat task.
          </label>
        ` : ''}
        <div class="probe-actions">
          <button type="button"
            ?disabled=${disabled || (this.savedProbe && !this.newProbeConfirmed)}
            @click=${this.prepareProbe}>
            ${this.savedProbe ? 'Prepare new probe' : 'Prepare probe'}
          </button>
          <button type="button"
            ?disabled=${disabled || !this.savedProbe}
            @click=${this.resumeProbe}>Resume saved probe</button>
          <button type="button"
            ?disabled=${disabled || !this.probeRequest || this.handoffRequested}
            @click=${this.sendProbe}>Review in chat</button>
          <button type="button"
            ?disabled=${disabled || !this.probeRequest}
            @click=${this.checkProbeResult}>Check result</button>
        </div>
        <p role="status">${this.probeBusy ? 'Probe operation in progress.' : statuses[this.probeState]}</p>
        ${this.probeError ? html`<p class="probe-error" role="alert">${this.probeError}</p>` : ''}
        ${this.savedProbe ? html`<p>Saved job: <code>${this.savedProbe.jobId}</code></p>` : ''}
        ${this.probeRequest ? html`
          <p>Request: <code>${this.probeRequest.requestPath}</code></p>
          <p>Result: <code>${this.probeRequest.resultPath}</code></p>
          <details>
            <summary>Prepared request</summary>
            <pre>${JSON.stringify(this.probeRequest, null, 2)}</pre>
          </details>
          <details>
            <summary>Prompt to review in chat</summary>
            <pre>${createProbePrompt(this.probeRequest)}</pre>
          </details>
        ` : ''}
        ${this.probeResult ? html`
          <h3>Returned JSON</h3>
          <pre>${JSON.stringify(this.probeResult, null, 2)}</pre>
        ` : ''}
        <p>
          Review in chat closes this dialog without auto-sending. Submit and approve there,
          then reopen, confirm the target, resume, and check the result.
          Closing the dialog stops its requests, not the chat task. No polling is enabled yet.
          Switching environments clears confirmation and loaded results, but does not undo
          an in-flight write or cancel a chat task. After reopening, select the same environment.
        </p>
      </section>
    `;
  }

  render() {
    if (window.parent !== window && this.connectionState === 'waiting') {
      return html`
        <main aria-busy="true">
          <header class="app-header"><h1>Block Library Generator</h1></header>
          <div class="startup-loading" role="status">
            <span class="startup-spinner" aria-hidden="true"></span>
            <p>Connecting to DA...</p>
          </div>
        </main>
      `;
    }
    const statuses = {
      unavailable: 'No DA context',
      error: 'Connection error',
    };
    const blocks = this.blockItems;
    const refreshing = this.discoveryBusy || this.libraryOverviewBusy;
    const standalone = window.parent === window;
    const hasWorkspace = Boolean(this.context.org && !this.choosingSite);

    return html`
      <main>
        <div class="app-toolbar">
          <header class="app-header">
            <h1>Block Library Generator</h1>
            ${!standalone && this.connectionState !== 'ready' ? html`
              <p class="connection-status" data-state=${this.connectionState} role="status">
              ${statuses[this.connectionState]}
              </p>
            ` : ''}
          </header>
          <p class="app-intro">Create starter examples, then review and edit the pages in DA. Nothing is published.</p>
          ${!this.choosingSite ? this.renderSiteTarget() : ''}
        </div>
        <div class="app-body" data-workspace=${hasWorkspace}>
          <div class="app-feedback">
            ${this.choosingSite ? this.renderSiteTarget() : ''}
            ${!standalone && this.discoveryBlockReason ? html`<p class="probe-notice">${this.discoveryBlockReason}</p>` : ''}
            ${this.notice ? html`<p class="success-notice" role="status">${this.notice}
              ${this.libraryOverview?.blocks[this.selectedBlock]?.status === 'existing'
    ? 'Open the page to review and edit it.' : ''}</p>` : ''}
            ${this.renderJobCleanupWarning()}
            ${this.renderLibraryPreviewWarning()}
            ${this.renderPendingAction()}
            ${this.renderLibrarySetup()}
            ${renderProblem(this.discoveryError, 'Blocks could not be loaded. Check site access, then refresh.')}
            ${renderProblem(this.discoveryCacheWarning, 'The shared block-list cache needs attention. Review the details.')}
            ${renderProblem(this.libraryOverviewError, 'The library could not be verified. Check site access and its Blocks registration.')}
            ${this.discoveryResult && !this.discoveryResult.provider ? renderProblem(
    this.discoveryResult.diagnostics?.map(({ provider, message }) => `${provider}: ${message}`).join('; ')
      || 'No complete block inventory could be loaded.',
    'Block discovery is unavailable. Check site access and code configuration, then refresh blocks.',
  ) : ''}
          </div>
          ${hasWorkspace ? html`<div class="block-workspace" data-detail-open=${this.detailOpen}>
            <nav class="block-sidebar" aria-label="Discovered blocks">
              <header><h2>Blocks <span class="block-count">${blocks.length}</span></h2>
                ${refreshing ? html`<p role="status">Reading site state...</p>` : ''}
              </header>
              ${!blocks.length ? html`<p class="empty-list">Refresh blocks to get started.
                No analysis or content write happens during discovery.</p>` : ''}
              <ul>${blocks.map((block) => html`
                <li><button type="button" class="block-nav-item"
                  aria-current=${this.selectedBlock === block.name ? 'true' : 'false'}
                  ?disabled=${this.libraryCreating}
                  @click=${() => this.selectBlock(block.name)}>
                  <strong>${readableLabel(block.name)}</strong>
                  <span class="status-badge"
                    data-state=${this.libraryOverview?.blocks[block.name]?.status || 'unknown'}>${this.blockStatus(block.name)}</span>
                </button></li>
              `)}</ul>
            </nav>
            <div class="detail-pane">${this.renderBlockDetail()}</div>
          </div>` : ''}
        </div>
      </main>
    `;
  }
}

customElements.define('block-library-generator-app', BlockLibraryGeneratorApp);
