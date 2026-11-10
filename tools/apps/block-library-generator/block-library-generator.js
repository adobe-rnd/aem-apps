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
import discoverCachedBlocks from './discovery-cache.js';
import {
  collectAnalysisInput,
  createAnalysisRequest as createCardsRequest,
  createAnalysisPrompt as createCardsPrompt,
  validateAnalysisRequest as validateCardsRequest,
  validateBlockAnalysis as validateCardsAnalysis,
} from './block-analysis.js';
import {
  prepareCardsLibraryDryRun, buildCardsPage, buildBlockStarterPage, getBlockLibraryPaths,
} from './library-dry-run.js';
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

function sameDestinations(expected, actual) {
  return Boolean(expected && Object.keys(expected).length === Object.keys(actual).length
    && Object.entries(actual).every(([key, value]) => expected[key] === value));
}

function isAutomaticPageAction(flow) {
  return (flow?.mode === 'create' && flow.autoCreate === true)
    || (flow?.mode === 'recreate' && flow.autoRecreate === true);
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
    probeEnvironment: { state: true },
    discoveryRef: { state: true },
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
    chatNotice: { state: true },
    chatError: { state: true },
  };

  constructor() {
    super();
    this.context = {};
    this.hasToken = false;
    this.connectionState = 'waiting';
    this.hostContext = {};
    this.hostActions = {};
    this.probeEnvironment = 'prod';
    this.discoveryRef = 'main';
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
    this.chatNotice = '';
    this.chatError = '';
    this.chatTurnSupported = false;
    this.chatSubscriptionVersion = 0;
    this.chatTurnIds = new Set();
    this.pendingChatCheck = null;
    this.chatCheckPromise = null;
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
    this.stopChatNotifications();
    window.clearTimeout(this.connectionTimer);
    this.discoveryController?.abort();
    this.resetLibraryOverview();
    this.resetCardsAnalysis();
  }

  updated() {
    this.flushChatResultCheck();
  }

  async initialize() {
    try {
      const sdkOrigin = 'https://da.live/nx';
      const { default: sdk } = await import(`${sdkOrigin}/utils/sdk.js`);
      const {
        context, token, actions, capabilities,
      } = await sdk;
      if (!this.isConnected) return;

      this.stopChatNotifications();
      this.chatTurnSupported = capabilities?.chatTurnCompleted === 1;
      this.hasToken = Boolean(token);
      this.hostContext = {
        view: typeof context?.view === 'string' ? context.view : '',
        daOrigin: typeof context?.daOrigin === 'string' ? context.daOrigin : '',
        hash: typeof context?.hash === 'string' ? context.hash : '',
      };
      this.hostActions = {
        daFetch: actions?.daFetch,
        setPrompt: actions?.setPrompt,
        subscribeChatTurnCompleted: actions?.subscribeChatTurnCompleted,
      };
      if (this.hostContext.daOrigin && this.hostContext.daOrigin !== 'https://admin.da.live') {
        throw new Error('This release supports Production DA only. No request was redirected to another service.');
      }
      this.context = {
        org: '',
        site: '',
        path: '',
        ref: typeof context?.ref === 'string' ? context.ref : '',
      };
      this.connectionState = 'ready';
      this.choosingSite = true;
      let useAppsLinkTarget = false;
      if (this.isAppsContext) {
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
      this.restoreCardsPointer();
      this.restoreCreationReceipt();
      this.restorePageFlow();
      this.restoreLibrarySetupReceipt();
      if (useAppsLinkTarget) {
        await this.applySiteTarget({ fromLink: true });
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

  get isAppsContext() {
    return ['fullscreen', 'apps'].includes(this.hostContext.view);
  }

  appsTargetMatches(target = this.probeTarget) {
    return Boolean(target && this.hostContext.hash === `#/${target.org}/${target.site}`);
  }

  appsSiteURL(target = this.probeTarget) {
    const checked = getProbeTarget(target);
    const ref = this.context.ref || 'main';
    getProbeTarget('prod', { org: checked.org, site: checked.site, branch: ref });
    const url = new URL('https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator');
    url.searchParams.set('nxver', '2');
    url.searchParams.set('ref', ref);
    url.searchParams.set('da-admin', 'prod');
    url.hash = `/${checked.org}/${checked.site}`;
    return url.href;
  }

  isCurrentTarget(target) {
    const current = this.probeTarget;
    return Boolean(current && target
      && Object.keys(current).every((key) => current[key] === target[key]));
  }

  beginSiteSelection() {
    if (!this.isAppsContext || this.workflowBusy || this.discoveryBusy || this.librarySetupProposal
      || this.libraryOverviewBusy || this.pageFlow) return;
    this.manualOrg = this.context.org || this.manualOrg;
    this.manualSite = this.context.site || this.manualSite;
    this.targetError = '';
    this.choosingSite = true;
    this.updateComplete?.then(() => this.querySelector('#target-org')?.focus());
  }

  cancelSiteSelection() {
    if (!this.isAppsContext || !this.context.org || !this.context.site
      || this.workflowBusy || this.discoveryBusy || this.libraryOverviewBusy) return;
    this.manualOrg = this.context.org;
    this.manualSite = this.context.site;
    this.targetError = '';
    this.choosingSite = false;
    this.updateComplete?.then(() => this.querySelector('.target-change')?.focus());
  }

  async applySiteTarget({ fromLink = false } = {}) {
    if (this.workflowBusy || this.discoveryBusy || this.libraryOverviewBusy
      || this.pageFlow || this.librarySetupProposal) {
      this.targetError = 'Finish or cancel the pending action before changing sites.';
      return;
    }
    this.targetError = '';
    try {
      if (!this.isAppsContext || this.connectionState !== 'ready' || !this.hasToken
        || typeof this.hostActions.daFetch !== 'function') {
        throw new Error('Open this app through DA Apps with an authenticated session to choose a site.');
      }
      const target = getProbeTarget('prod', {
        org: this.manualOrg.trim(), site: this.manualSite.trim(), branch: 'main',
      });
      if (this.isAppsContext && !fromLink && !this.appsTargetMatches(target)) {
        const url = new URL(this.appsSiteURL(target));
        window.localStorage.setItem('block-library-generator:last-site:prod', JSON.stringify(target));
        if (!window.open(url.href, '_top')) throw new Error('The Apps site could not be opened. Use the site link to continue.');
        // A hash-only parent navigation does not refresh the iframe or its SDK context.
        if (window.location.search === url.search) {
          window.location.hash = url.hash;
          window.location.reload();
        }
        return;
      }
      this.stopChatNotifications();
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
      this.connectChatNotifications();
      await this.refreshWorkspace();
    } catch (error) {
      this.targetError = error instanceof Error ? error.message : String(error);
    }
  }

  stopChatNotifications() {
    this.chatSubscriptionVersion += 1;
    this.chatUnsubscribe?.();
    this.chatUnsubscribe = null;
    this.pendingChatCheck = null;
    this.chatTurnIds.clear();
    this.chatNotice = '';
    this.chatError = '';
  }

  connectChatNotifications() {
    if (this.chatUnsubscribe || !this.isAppsContext
      || this.discoveryBlockReason || !this.appsTargetMatches()
      || !this.chatTurnSupported || typeof this.hostActions.setPrompt !== 'function'
      || typeof this.hostActions.subscribeChatTurnCompleted !== 'function') return;
    const version = this.chatSubscriptionVersion;
    const target = { ...this.probeTarget };
    try {
      const unsubscribe = this.hostActions.subscribeChatTurnCompleted((detail) => {
        if (!this.isConnected || version !== this.chatSubscriptionVersion
          || !this.isCurrentTarget(target)) return undefined;
        return this.handleChatTurnCompleted(detail);
      });
      if (typeof unsubscribe !== 'function') throw new Error('The host did not return a chat unsubscribe function.');
      this.chatUnsubscribe = unsubscribe;
    } catch (error) {
      this.chatError = `Chat notifications are unavailable: ${error.message}`;
    }
  }

  handleChatTurnCompleted(detail) {
    try {
      const flow = this.pageFlow;
      if (!this.isAppsContext || !flow?.jobId || flow.status !== 'waiting'
        || !this.isCurrentTarget(flow.target) || !this.appsTargetMatches()
        || detail?.org !== flow.target.org || detail?.site !== flow.target.site
        || !['completed', 'aborted', 'error'].includes(detail?.status)) return undefined;
      const kind = flow.jobKind || 'analysis';
      const pointer = loadJobPointer(window.localStorage, this.probeTarget, kind, flow.name);
      if (pointer?.jobId !== flow.jobId || !pointer.handoffRequested) return undefined;
      if (typeof detail.sessionId === 'string' && typeof detail.turnId === 'string') {
        const key = JSON.stringify([detail.sessionId, detail.turnId]);
        if (this.chatTurnIds.has(key)) return undefined;
        this.chatTurnIds.add(key);
        if (this.chatTurnIds.size > 50) {
          this.chatTurnIds.delete(this.chatTurnIds.values().next().value);
        }
      }
      this.pendingChatCheck = {
        jobId: flow.jobId,
        name: flow.name,
        target: flow.target,
        status: detail.status,
        version: this.chatSubscriptionVersion,
      };
      this.chatNotice = flow.name === this.selectedBlock
        ? 'A chat turn ended. Checking the saved analysis.'
        : `A chat turn ended for ${readableLabel(flow.name)}. Resume that action to check its saved analysis.`;
      return this.flushChatResultCheck();
    } catch (error) {
      this.chatError = `The chat notification could not be processed: ${error.message}`;
      return undefined;
    }
  }

  flushChatResultCheck() {
    const pending = this.pendingChatCheck;
    if (!pending || this.chatCheckPromise) return undefined;
    const flow = this.pageFlow;
    if (!this.isConnected || flow?.jobId !== pending.jobId || flow.status !== 'waiting'
      || pending.version !== this.chatSubscriptionVersion
      || !this.isCurrentTarget(pending.target)) {
      this.pendingChatCheck = null;
      return undefined;
    }
    if (flow.name !== this.selectedBlock || this.workflowBusy
      || this.discoveryBusy || this.libraryOverviewBusy) return undefined;
    this.pendingChatCheck = null;
    const check = this.loadPageGeneration().then(() => {
      if (!this.isConnected || this.pageFlow?.jobId !== pending.jobId
        || pending.version !== this.chatSubscriptionVersion
        || !this.isCurrentTarget(pending.target)) return;
      if (this.pageFlow.status !== 'waiting' || this.cardsError) {
        this.chatNotice = '';
      } else if (this.selectedBlock !== pending.name) {
        this.chatNotice = `A chat turn ended for ${readableLabel(pending.name)}. Resume to check its saved analysis.`;
      } else if (this.cardsState === 'pending') {
        this.chatNotice = `A chat turn ended (${pending.status}). No saved result is available yet. Review chat or use Check result.`;
      }
    }).catch((error) => {
      if (this.isConnected && this.pageFlow?.jobId === pending.jobId
        && pending.version === this.chatSubscriptionVersion
        && this.isCurrentTarget(pending.target)) {
        this.chatError = `The saved analysis could not be checked: ${error.message}`;
      }
    }).finally(() => {
      if (this.chatCheckPromise === check) this.chatCheckPromise = null;
      this.flushChatResultCheck();
    });
    this.chatCheckPromise = check;
    return check;
  }

  get discoveryBlockReason() {
    if (this.connectionError) return this.connectionError;
    if (this.probeEnvironment !== 'prod') return 'This release supports Production DA only.';
    if (!this.isAppsContext) return 'Open the generator from DA Apps to access a site.';
    if (this.connectionState !== 'ready' || window.parent === window) {
      return 'Open this app from DA Apps to use an authenticated site session.';
    }
    if (!this.hasToken) {
      return 'Sign in to DA and reopen the generator to access a site.';
    }
    if (typeof this.hostActions.daFetch !== 'function') {
      return 'This DA host does not provide authenticated access. Open the generator from DA Apps.';
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
    this.selectedBlock = '';
    this.detailOpen = false;
    this.resetLibraryOverview();
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

  get workflowBusy() {
    return this.cardsBusy || this.libraryBusy;
  }

  get automaticPageActionActive() {
    return isAutomaticPageAction(this.pageFlow)
      && ['confirm', 'waiting', 'ready', 'blocked'].includes(this.pageFlow.status);
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
    if (this.automaticPageActionActive) {
      this.chatNotice = 'Wait for this page action to finish, or cancel it before selecting another block.';
      return;
    }
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
                <button class="primary-action nx-btn-accent" type="button" ?disabled=${disabled}
                  @click=${this.commitLibrarySetup}>Confirm initialize library</button>
                <button class="nx-action-btn" type="button" ?disabled=${this.workflowBusy}
                  @click=${this.cancelLibrarySetup}>Cancel</button>
              ` : html`
                <button class="primary-action nx-btn-accent" type="button" ?disabled=${disabled}
                  @click=${this.beginLibrarySetup}>Initialize library</button>
              `}
            ` : ''}
            ${interrupted ? html`
              <button class="nx-action-btn" type="button" ?disabled=${this.workflowBusy || this.libraryOverviewBusy}
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
    if (environment === this.probeEnvironment) {
      if (value?.jobId !== this.pageFlow?.jobId) {
        this.pendingChatCheck = null;
        this.chatNotice = '';
        this.chatError = '';
      }
      this.pageFlow = value;
    }
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
      if ((flow.autoCreate !== undefined && typeof flow.autoCreate !== 'boolean')
        || (flow.autoCreate && flow.mode !== 'create')
        || (flow.autoRecreate !== undefined && typeof flow.autoRecreate !== 'boolean')
        || (flow.autoRecreate && (flow.mode !== 'recreate' || flow.starter))
        || (flow.autoRecreate !== undefined && flow.mode === 'recreate' && !flow.snapshot)
        || (flow.autoSaveStarted !== undefined && typeof flow.autoSaveStarted !== 'boolean')
        || (flow.autoSaveStarted && (!isAutomaticPageAction(flow) || !flow.jobId))) {
        throw new Error('Invalid saved automatic page action.');
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
      if (flow.autoCreate) {
        const expected = getBlockLibraryPaths({
          library: { data: [{ title: 'Blocks', path: flow.createDestinations?.indexURL }] },
        }, target, flow.name);
        if (!sameDestinations(flow.createDestinations, expected)) {
          throw new Error('Invalid saved automatic Create destinations.');
        }
      }
      if (flow.status === 'completed') {
        this.savePageFlow(null);
      } else {
        if (isAutomaticPageAction(flow) && flow.status === 'confirm') {
          flow.status = 'failed';
          flow.error = `${readableLabel(flow.mode)} was interrupted before chat was sent. Cancel the action and start again.`;
        } else if (isAutomaticPageAction(flow) && flow.autoSaveStarted
          && !['failed', 'partial'].includes(flow.status)) {
          flow.status = 'partial';
          flow.error = `${readableLabel(flow.mode)} was interrupted during saving. Refresh and inspect the page and index before another action.`;
        }
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
    let preparedFlow;
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
      const autoCreate = mode === 'create' && this.isAppsContext;
      const createDestinations = autoCreate ? getBlockLibraryPaths({
        library: { data: [{ title: 'Blocks', path: this.libraryOverview.paths?.indexURL }] },
      }, this.probeTarget, name) : null;
      if (autoCreate && entry.pagePath !== createDestinations.pagePath) {
        throw new Error('The Create destination does not match the verified library. Refresh its status first.');
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
          ...(autoCreate ? { autoCreate: true, createDestinations } : {}),
          ...(mode === 'recreate' && this.isAppsContext ? { autoRecreate: false } : {}),
        });
        preparedFlow = this.pageFlow;
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
    if (preparedFlow?.autoCreate && this.pageFlow === preparedFlow) {
      await this.generatePageSuggestions();
    }
  }

  cancelPageAction() {
    const cancellableGeneration = isAutomaticPageAction(this.pageFlow)
      && !this.pageFlow.autoSaveStarted && !this.libraryCreating;
    if (this.workflowBusy && !cancellableGeneration) return;
    try {
      if (cancellableGeneration) this.resetCardsAnalysis();
      this.savePageFlow(null);
      this.libraryError = '';
    } catch (error) {
      this.libraryError = `Cannot clear the saved page action: ${error.message}`;
      if (cancellableGeneration) {
        this.pageFlow = null;
        this.libraryError += ' This tab has stopped the action, but the saved action may resume if reopened.';
      }
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
        <button class="nx-action-btn" type="button" ?disabled=${this.workflowBusy}
          @click=${() => this.selectBlock(flow.name)}>Resume</button>
        <button class="nx-action-btn" type="button" ?disabled=${this.workflowBusy}
          @click=${this.cancelPageAction}>Cancel action</button>
      </section>
    `;
  }

  async confirmAutomaticRecreate() {
    if (this.workflowBusy || this.libraryOverviewBusy) return;
    this.libraryError = '';
    try {
      const flow = this.pageFlow;
      if (!this.isAppsContext || flow?.mode !== 'recreate' || flow.status !== 'confirm'
        || flow.autoRecreate !== false || flow.name !== this.selectedBlock || !flow.snapshot
        || !this.isCurrentTarget(flow.target)) {
        throw new Error('Review the current Recreate action before confirming replacement.');
      }
      this.assertPageActionContext();
      this.savePageFlow({ ...flow, autoRecreate: true });
      await this.generatePageSuggestions();
    } catch (error) {
      this.libraryError = error instanceof Error ? error.message : String(error);
    }
  }

  async generatePageSuggestions() {
    const flow = this.pageFlow;
    if (!flow || flow.status !== 'confirm' || !['create', 'recreate'].includes(flow.mode)) {
      this.libraryError = 'Confirm a new Create or Recreate action first.';
      return;
    }
    if (flow.mode === 'recreate' && flow.autoRecreate === false) {
      this.libraryError = 'Confirm replacement of the entire page before starting Recreate.';
      return;
    }
    if (this.selectedBlock !== flow.name || !this.hasBlockCode(flow.name)) {
      this.libraryError = 'The selected block/code no longer matches this generation action.';
      return;
    }
    this.cardsConfirmed = true;
    this.cardsNewConfirmed = true;
    await this.prepareCardsAnalysis();
    if (!this.isConnected || this.pageFlow !== flow) return;
    try {
      if (this.cardsState !== 'prepared' || !this.cardsRequest) {
        if (isAutomaticPageAction(flow)) {
          this.savePageFlow({
            ...flow, status: 'failed', error: this.cardsError || 'The analysis request could not be prepared.',
          });
        }
        return;
      }
      if (Date.parse(this.cardsRequest.createdAt) < Date.parse(flow.startedAt)) {
        throw new Error('Recreation requires a fresh analysis, not an earlier saved result.');
      }
      this.savePageFlow({
        ...flow, jobId: this.cardsRequest.jobId, jobKind: this.cardsRequest.kind, status: 'waiting',
      });
      this.sendCardsAnalysis();
      if (isAutomaticPageAction(flow) && this.cardsError) {
        this.savePageFlow({
          ...this.pageFlow, status: 'failed', error: this.cardsError,
        });
      }
    } catch (error) {
      this.libraryError = error instanceof Error ? error.message : String(error);
    }
  }

  async loadPageGeneration() {
    const flow = this.pageFlow;
    if (!flow?.jobId || !['waiting', 'ready', 'blocked'].includes(flow.status)
      || flow.name !== this.selectedBlock || this.workflowBusy) return;
    if (this.pendingChatCheck?.jobId === flow.jobId) this.pendingChatCheck = null;
    this.chatNotice = '';
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
      if (this.pageFlow !== flow || this.selectedBlock !== flow.name
        || (flow.target && !this.isCurrentTarget(flow.target))) return;
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
    await this.completeAutomaticPageAction();
  }

  async completeAutomaticPageAction() {
    const flow = this.pageFlow;
    if (!isAutomaticPageAction(flow) || !flow.jobId || flow.autoSaveStarted
      || !['ready', 'blocked'].includes(flow.status) || flow.name !== this.selectedBlock
      || !this.isCurrentTarget(flow.target) || this.workflowBusy
      || this.automaticSaveJob === flow.jobId || this.cardsError) return;
    this.automaticSaveJob = flow.jobId;
    try {
      if (this.generationPageMode(flow.name) !== flow.mode) {
        throw new Error(flow.mode === 'create'
          ? 'Create stopped because the page is no longer known to be missing. Existing pages are never replaced automatically.'
          : 'Recreate stopped because the page is no longer known to exist. No new page was created.');
      }
      if (flow.mode === 'recreate' && flow.snapshot?.pagePath
        !== this.libraryOverview.blocks[flow.name].pagePath) {
        throw new Error('The Recreate destination changed. The confirmed page was not replaced.');
      }
      if (flow.status === 'blocked') {
        if (flow.mode === 'recreate') {
          this.savePageFlow({ ...flow, autoRecreate: false });
          return;
        }
        this.starterAnalysis();
        this.savePageFlow({
          ...flow, status: 'ready', starter: true, error: '',
        });
      }
      if (this.pageFlow?.jobId !== flow.jobId || !this.isCurrentTarget(flow.target)) return;
      this.savePageFlow({ ...this.pageFlow, autoSaveStarted: true });
      await this.commitPageAction();
    } catch (error) {
      if (this.isConnected && this.pageFlow?.jobId === flow.jobId
        && this.isCurrentTarget(flow.target)) {
        this.libraryError = error instanceof Error ? error.message : String(error);
        try {
          this.savePageFlow({ ...this.pageFlow, status: 'failed', error: this.libraryError });
        } catch (storageError) {
          this.libraryError += ` Progress could not be saved: ${storageError.message}`;
        }
      }
    } finally {
      if (this.automaticSaveJob === flow.jobId) this.automaticSaveJob = null;
    }
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
      if (flow.autoRecreate && flow.starter) {
        throw new Error('Replacing the page with an unfinished starter requires separate confirmation.');
      }
      if (flow.mode === 'create') {
        if (this.cardsRequest?.jobId !== flow.jobId || !this.hasBlockCode(flow.name)) {
          throw new Error('Fresh generation and current block code are required.');
        }
        this.libraryReviewConfirmed = true;
        await this.generateLibraryDryRun({ starter: flow.starter === true });
        if (!this.libraryPreview) throw new Error(this.libraryError || 'Could not prepare creation.');
        const { destinations } = this.libraryPreview;
        if (flow.autoCreate && !sameDestinations(flow.createDestinations, destinations)) {
          throw new Error('The library destination changed after Create was started. No page was saved.');
        }
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
        <button class="primary-action nx-btn-accent" type="button" ?disabled=${disabled || !blocked}
          @click=${this.commitPageAction}>${replacing
  ? 'Confirm replace with starter page' : 'Confirm create starter page'}</button>
        <button class="nx-action-btn" type="button" ?disabled=${disabled}
          @click=${this.backToBlockedAnalysis}>Back</button>
      </div>
      ${renderProblem(this.libraryError, 'The starter page action could not be completed. Review the details.')}
    `;
  }

  renderRecreateConsent(flow) {
    const disabled = this.workflowBusy || this.libraryOverviewBusy;
    return html`
      <section class="workflow-card page-action-confirm" aria-label="Recreate library page">
        <h3>Recreate ${readableLabel(flow.name)} library page</h3>
        <p class="probe-error">This replaces the entire page, including any author edits.</p>
        <p>After confirmation, the app analyses the block, submits the prompt,
          validates the result, replaces the page and previews it automatically.
          Nothing is published. Approve the analysis-result write in chat if asked.</p>
        <p>If analysis is blocked, the existing page stays unchanged.
          Replacing it with an unfinished default page requires separate confirmation.</p>
        <p>Examples use three bundled placeholder images.
          Missing copies will be added to this site's library media folder.</p>
        ${flow.snapshot?.pageETag === null ? html`
          <p class="probe-error">This page has no ETag. Replacement uses a final content-hash
            check and is not atomic. Avoid editing the page while Recreate runs.</p>
        ` : ''}
        <button class="primary-action nx-btn-accent" type="button" ?disabled=${disabled}
          @click=${this.confirmAutomaticRecreate}>Confirm replace entire page</button>
        <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
        ${renderProblem(this.libraryError, 'Recreate could not be started. Review the details.')}
      </section>
    `;
  }

  renderAutomaticPageAction(flow) {
    const recreating = flow.mode === 'recreate';
    const action = recreating ? 'Recreate' : 'Create';
    const cancelLabel = recreating ? 'Cancel Recreate' : 'Cancel creation';
    const problem = this.cardsError || this.libraryError || (flow.status === 'blocked' ? '' : flow.error);
    const failed = !['confirm', 'waiting', 'ready', 'blocked'].includes(flow.status) || Boolean(problem);
    const mayHaveSaved = flow.autoSaveStarted || flow.status === 'partial';
    const canCancel = !this.workflowBusy || (!flow.autoSaveStarted && !this.libraryCreating);
    let progress = 'Waiting for analysis in chat...';
    if (this.cardsBusy) {
      progress = this.cardsState === 'collecting'
        ? 'Reading block code and preparing analysis...' : 'Checking the saved analysis...';
    } else if (this.libraryBusy) {
      progress = this.libraryCreating ? 'Saving and previewing the page...' : 'Checking the page and library...';
    } else if (flow.status === 'confirm') {
      progress = 'Preparing analysis...';
    } else if (flow.status === 'ready' || flow.status === 'blocked') {
      progress = flow.starter || flow.status === 'blocked'
        ? 'Preparing the unfinished default page...' : 'Preparing the example page...';
    }
    return html`
      <section class="workflow-card page-action-confirm" aria-label="${action} library page"
        aria-busy=${this.workflowBusy ? 'true' : 'false'}>
        <h3>${action} ${readableLabel(flow.name)} library page</h3>
        ${failed ? renderProblem(problem || `${action} was interrupted.`, mayHaveSaved
    ? `${action} did not finish. Refresh and inspect the page and index before another action.`
    : `${action} could not be completed. ${recreating ? 'The existing page was not changed.' : 'No library page was saved.'}`) : html`
          <div class="create-progress" role="status">
            <span class="startup-spinner" aria-hidden="true"></span><p>${progress}</p>
          </div>
          <p>The page will be ${recreating ? 'replaced' : 'saved'} and previewed automatically.
            ${recreating
    ? 'If analysis is blocked, the existing page stays unchanged until you separately confirm a starter replacement.'
    : 'If working examples cannot be generated, an unfinished default page is saved.'}
            Approve the analysis-result write in chat if asked. Nothing is published.</p>
        `}
        <details class="create-recovery">
          <summary>Recovery options</summary>
          ${mayHaveSaved ? html`
            <p>A save may have been attempted. No automatic retry or rollback is performed.</p>
            <button class="nx-action-btn" type="button" ?disabled=${this.workflowBusy || this.libraryOverviewBusy}
              @click=${this.refreshWorkspace}>Refresh current state</button>
          ` : html`
            <p>If chat has finished but the page is not saved, check for pending approvals
              and check the result. If preparation was interrupted, cancel and choose ${action} again.</p>
            ${flow.jobId ? html`
              <button class="nx-action-btn" type="button" ?disabled=${this.workflowBusy || this.libraryOverviewBusy}
                @click=${this.loadPageGeneration}>Check result</button>
            ` : ''}
          `}
        </details>
        <p>Cancelling this action does not stop chat.</p>
        <button class="nx-action-btn" type="button" ?disabled=${!canCancel}
          @click=${this.cancelPageAction}>${mayHaveSaved && failed
  ? 'Dismiss saved action' : cancelLabel}</button>
      </section>
    `;
  }

  renderCreateAction(flow) {
    if (flow.autoCreate) return this.renderAutomaticPageAction(flow);
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
          <p>Prepare a prompt from this block's code. In ${this.isAppsContext ? 'the adjacent' : 'editor'} chat, review and send it,
            then approve the analysis result. Return here when it finishes.</p>
          <p>Examples use three bundled placeholder images. Missing placeholders will be
            added to this site's library media folder. Existing files are never overwritten.</p>
          <p>No library page will be saved until you confirm the next step.</p>
          <div class="page-actions">
            <button class="primary-action nx-btn-accent" type="button" ?disabled=${disabled}
              @click=${this.generatePageSuggestions}>Continue in chat</button>
            <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
          </div>
        ` : ''}
        ${!this.workflowBusy && flow.status === 'waiting' ? html`
          <p>Review and send the prepared prompt in chat, then approve the analysis result.
            ${this.isAppsContext
    ? 'The app checks the saved analysis when a chat turn ends. You can also choose Check result.'
    : 'When chat finishes, reopen the generator and choose Check result.'}</p>
          ${this.cardsState === 'pending' ? html`
            <p role="status">No result yet. Let chat finish, approve any pending result write,
              then check again.</p>
          ` : ''}
          <p>No library page has been saved. Cancelling creation does not stop chat.</p>
          <div class="page-actions">
            <button class="primary-action nx-btn-accent" type="button" ?disabled=${disabled}
              @click=${this.loadPageGeneration}>Check result</button>
            <button class="nx-action-btn" type="button" ?disabled=${disabled}
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
            <button class="primary-action nx-btn-accent" type="button" ?disabled=${disabled}
              @click=${this.commitPageAction}>Confirm create page</button>
            <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
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
            <button class="primary-action nx-btn-accent" type="button"
              ?disabled=${disabled || Boolean(this.cardsBlockReason) || !this.hasBlockCode(flow.name)}
              @click=${this.retryPageGeneration}>Retry analysis</button>
            <button class="nx-action-btn" type="button"
              ?disabled=${disabled || Boolean(this.cardsBlockReason) || !this.hasBlockCode(flow.name)
                || !['absent', 'missing-page'].includes(this.libraryOverview?.blocks[flow.name]?.status)}
              @click=${this.prepareDefaultExample}>Create a default example page</button>
            <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Dismiss</button>
          </div>
          ${renderProblem(this.libraryError, 'The requested action could not be completed. Review the details, then try again.')}
        ` : ''}
        ${failed ? html`
          ${problem ? renderProblem(problem, failureSummary) : html`<p role="alert">${failureSummary}</p>`}
          ${mayHaveSaved ? html`
            <p>No automatic retry or rollback.</p>
            <button class="nx-action-btn" type="button" ?disabled=${disabled}
              @click=${this.refreshWorkspace}>Refresh current state</button>
          ` : ''}
          <button class="nx-action-btn" type="button" ?disabled=${disabled}
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
    if (!isAutomaticPageAction(flow) && flow.status === 'blocked' && ['create', 'recreate'].includes(flow.mode)) {
      flow = { ...flow, mode: this.generationPageMode(flow.name) || flow.mode };
    }
    if (flow.mode === 'create') return this.renderCreateAction(flow);
    if (isAutomaticPageAction(flow)) return this.renderAutomaticPageAction(flow);
    if (flow.mode === 'recreate' && flow.status === 'confirm' && flow.autoRecreate === false) {
      return this.renderRecreateConsent(flow);
    }
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
          <button class=${flow.mode === 'delete' ? 'nx-action-btn' : 'primary-action nx-btn-accent'} type="button" ?disabled=${disabled}
            @click=${flow.mode === 'delete' ? this.commitPageAction : this.generatePageSuggestions}>
            ${flow.mode === 'delete' ? 'Confirm delete page and index entry' : 'Continue in chat'}
          </button>
          <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
        ` : ''}
        ${flow.status === 'waiting' ? html`
          <p>Chat handoff requested. Review and submit the prompt in chat, then approve the result
            write. ${this.isAppsContext
    ? 'The app checks the saved result after a chat turn ends.'
    : 'Reopen this app to check it.'} No library page has been changed.
            Cancelling this action does not stop chat.</p>
          <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.loadPageGeneration}>Check result</button>
          <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel page action</button>
        ` : ''}
        ${flow.status === 'ready' && !flow.starter ? html`
          ${!this.libraryBusy ? html`<p>Fresh output is ready. It is not yet saved to the library.
            ${flow.mode === 'recreate' ? 'Confirm to discard the current page contents and replace it.' : ''}
            The verified page and index will be previewed. Nothing is published.</p>` : ''}
          <button class="primary-action nx-btn-accent" type="button" ?disabled=${disabled}
            @click=${this.commitPageAction}>${flow.mode === 'recreate' ? 'Confirm replace entire page' : 'Confirm create page'}</button>
          <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Cancel</button>
        ` : ''}
        ${!this.workflowBusy && flow.status === 'ready' && flow.starter
    ? this.renderStarterConfirmation(flow) : ''}
        ${flow.starter && this.libraryBusy ? html`<p role="status">Saving starter page...</p>` : ''}
        ${flow.status === 'completed' ? html`<p role="status">Page action completed and readback verified.</p>
          <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Dismiss</button>` : ''}
        ${flow.status === 'blocked' ? html`
            ${renderProblem(
    flow.error,
    'Working examples could not be generated from the block\'s code. The existing library page was not changed.',
  )}
            <p>You can update the block's JavaScript or CSS and retry the analysis.
              Alternatively, start again with a default example by replacing the existing page.</p>
            <div class="page-actions">
              ${flow.mode === 'recreate' ? html`
                <button class="primary-action nx-btn-accent" type="button"
                  ?disabled=${disabled || Boolean(this.cardsBlockReason) || !this.hasBlockCode(flow.name)}
                  @click=${this.retryPageGeneration}>Retry analysis</button>
                <button class="nx-action-btn" type="button"
                  ?disabled=${disabled || Boolean(this.cardsBlockReason) || !this.hasBlockCode(flow.name)
                    || !['existing', 'unregistered'].includes(this.libraryOverview?.blocks[flow.name]?.status)}
                  @click=${this.prepareDefaultExample}>Replace with a default example page</button>
              ` : ''}
              <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Dismiss</button>
            </div>
            ${renderProblem(this.libraryError, 'The requested action could not be completed. Review the details, then try again.')}
        ` : ''}
        ${!['confirm', 'waiting', 'ready', 'completed', 'blocked'].includes(flow.status) ? html`
          <p role="alert">Outcome: ${flow.status}. ${flow.error}
            A page or index change may have succeeded. Refresh and inspect before another action.
            No automatic retry or rollback.</p>
          <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.refreshWorkspace}>Refresh current state</button>
          <button class="nx-action-btn" type="button" ?disabled=${disabled} @click=${this.cancelPageAction}>Dismiss saved action</button>
        ` : ''}
        ${renderProblem(this.cardsError, 'The analysis could not be checked. Review the details before starting another job.')}
      </section>
    `;
  }

  get cardsBlockReason() {
    if (this.discoveryBlockReason) return this.discoveryBlockReason;
    if (this.isAppsContext) {
      if (!this.appsTargetMatches()) {
        return 'Open the selected site with its canonical Apps link to align the generator and chat targets.';
      }
      if (!this.chatTurnSupported || typeof this.hostActions.setPrompt !== 'function'
        || typeof this.hostActions.subscribeChatTurnCompleted !== 'function') {
        return 'Apps chat is unavailable. Use the nx2 Apps shell (nxver=2) with Experience Workspace chat enabled for this site.';
      }
      if (!this.chatUnsubscribe) return this.chatError || 'Apps chat notifications are not connected. Reload the app.';
      return '';
    }
    return 'Open the generator from DA Apps to create or recreate pages.';
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
    if (this.cardsBusy || this.libraryBusy) {
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
      const input = await collectAnalysisInput({
        blockName: this.selectedBlock || 'cards',
        entryPaths: this.discoveryResult?.blocks
          .find((block) => block.name === (this.selectedBlock || 'cards'))?.files.map((file) => file.path),
        environment: this.probeEnvironment,
        target: this.probeTarget,
        daFetch: this.hostActions.daFetch,
        fetchCode: (url, options) => window.fetch(url, options),
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
      if (this.cardsBusy || this.libraryBusy || !this.cardsRequest) {
        throw new Error('Prepare or resume the analysis request first.');
      }
      if (this.cardsHandoff) throw new Error('Chat handoff already requested; do not resend this job.');
      const prompt = createCardsPrompt(this.cardsRequest);
      const autoSend = isAutomaticPageAction(this.pageFlow);
      if (autoSend && (this.pageFlow.status !== 'waiting'
        || this.pageFlow.jobId !== this.cardsRequest.jobId
        || this.pageFlow.name !== requestBlockName(this.cardsRequest)
        || !this.isCurrentTarget(this.pageFlow.target))) {
        throw new Error('The automatic page action does not match the prepared analysis job.');
      }
      saveJobPointer(window.localStorage, this.cardsRequest, true);
      this.cardsHandoff = true;
      this.cardsSaved = {
        jobId: this.cardsRequest.jobId, handoffRequested: true, kind: this.cardsRequest.kind,
      };
      this.cardsState = 'requested';
      this.cardsError = '';
      this.hostActions.setPrompt(prompt, { autoSend });
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
    if (this.libraryBusy || this.cardsBusy) {
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
    if (this.libraryBusy || this.cardsBusy) {
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

  renderSiteTarget() {
    if (window.parent !== window && this.connectionState !== 'ready') return '';
    if (window.parent === window || !this.isAppsContext) {
      return html`
        <section class="launch-notice" aria-labelledby="launch-notice-heading">
          <h2 id="launch-notice-heading">DA Apps required</h2>
          <p>This app can only be opened from DA Apps.</p>
        </section>
      `;
    }
    if (this.connectionState !== 'ready') return '';
    if (this.choosingSite) return this.renderSiteChooser();
    const refreshing = this.discoveryBusy || this.libraryOverviewBusy;
    return html`
      <section class="target-bar" aria-label="Current target">
        <div><span class="eyebrow">Site</span><strong>${this.context.org && this.context.site
    ? `${this.context.org}/${this.context.site}` : 'No site selected'}</strong></div>
        ${this.context.org ? html`
          <button class="target-change nx-action-btn" type="button"
            ?disabled=${this.workflowBusy || Boolean(this.pageFlow)
              || Boolean(this.librarySetupProposal) || refreshing}
            @click=${this.beginSiteSelection}>Change site</button>
        ` : ''}
        ${this.isAppsContext && this.context.org && !this.appsTargetMatches() ? html`
          <a href=${this.appsSiteURL()} target="_top">Open this site in Apps for chat</a>
        ` : ''}
        <button class="target-refresh primary-action nx-btn-accent" type="button"
          ?disabled=${Boolean(this.discoveryBlockReason) || refreshing || this.workflowBusy}
          @click=${this.refreshBlocks}>${refreshing ? 'Refreshing...' : 'Refresh blocks'}</button>
      </section>
    `;
  }

  renderSiteChooser() {
    if (window.parent === window || this.connectionState !== 'ready'
      || !this.isAppsContext || !this.choosingSite) return '';
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
            <button class="primary-action nx-btn-accent" type="submit"
              ?disabled=${this.connectionState !== 'ready' || !this.hasToken || this.workflowBusy
                || this.discoveryBusy || this.libraryOverviewBusy}>Use site</button>
            ${this.context.org && this.context.site ? html`
              <button class="nx-action-btn" type="button"
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
        <button class="back-to-blocks nx-action-btn-quiet" type="button"
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
            <a class="page-open primary-action nx-btn-accent" href=${entry.editorURL} target="_blank" rel="noopener noreferrer">Open</a>
            <button class="nx-action-btn" type="button" ?disabled=${actionDisabled}
              @click=${() => this.beginPageAction('delete')}>Delete</button>
            <button class="nx-action-btn" type="button" ?disabled=${actionDisabled || !supported}
              @click=${() => this.beginPageAction('recreate')}>Recreate</button>
          </div>
        ` : ''}
        ${entry && ['absent', 'missing-page'].includes(entry.status) && !creating ? html`
          ${this.isAppsContext ? html`<p>Create runs analysis in chat, saves the page and previews it.
            If working examples cannot be generated, an unfinished default page is saved.
            Chat may ask you to approve its result write. Nothing is published.</p>` : ''}
          <div class="page-actions">
            <button class="primary-action nx-btn-accent" type="button"
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
    if (window.parent === window || (!this.isAppsContext && this.connectionState === 'ready')) {
      return html`
        <main>
          <header class="app-header"><h1>Block Library Generator</h1></header>
          ${this.renderSiteTarget()}
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
            ${this.chatNotice ? html`<p class="probe-notice" role="status">${this.chatNotice}</p>` : ''}
            ${renderProblem(this.chatError, 'Chat could not be connected or its result checked. Review the details.')}
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
                  ?disabled=${this.libraryCreating || this.automaticPageActionActive}
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
