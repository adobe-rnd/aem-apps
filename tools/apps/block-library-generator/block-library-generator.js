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
  PROBE_TARGET,
  createProbeRequest,
  getProbeBlockReason,
  persistProbeRequest,
  readProbeRequest,
  readProbeResult,
  createProbePrompt,
  loadProbePointer,
  saveProbePointer,
} from './jobs.js';

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
  }

  createRenderRoot() {
    this.replaceChildren();
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.connectionState = window.parent === window ? 'unavailable' : 'waiting';
    this.connectionTimer = window.setTimeout(() => {
      if (this.connectionState === 'waiting') this.connectionState = 'unavailable';
    }, 10000);
    this.initialize();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearTimeout(this.connectionTimer);
    this.probeController?.abort();
  }

  async initialize() {
    try {
      const sdkOrigin = 'https://da.live/nx';
      const { default: sdk } = await import(`${sdkOrigin}/utils/sdk.js`);
      const { context, token, actions } = await sdk;
      if (!this.isConnected) return;

      const site = context?.site || context?.repo;
      this.context = {
        org: typeof context?.org === 'string' ? context.org : '',
        site: typeof site === 'string' ? site : '',
        path: typeof context?.path === 'string' ? context.path : '',
        ref: typeof context?.ref === 'string' ? context.ref : '',
      };
      this.hasToken = Boolean(token);
      this.hostContext = {
        view: typeof context?.view === 'string' ? context.view : '',
        branch: typeof context?.branch === 'string' ? context.branch : '',
        daOrigin: typeof context?.daOrigin === 'string' ? context.daOrigin : '',
      };
      this.hostActions = {
        daFetch: actions?.daFetch,
        setPrompt: actions?.setPrompt,
        closeLibrary: actions?.closeLibrary,
      };
      this.connectionState = this.context.org && this.context.site ? 'ready' : 'unavailable';
      if (!this.probeBlockReason) {
        try {
          this.savedProbe = loadProbePointer(window.localStorage);
        } catch (error) {
          this.probeError = error.message;
        }
      }
    } catch {
      if (this.isConnected) this.connectionState = 'error';
    } finally {
      window.clearTimeout(this.connectionTimer);
    }
  }

  get probeBlockReason() {
    return getProbeBlockReason({
      context: { ...this.context, ...this.hostContext },
      actions: this.hostActions,
      embedded: window.parent !== window,
      hasToken: this.hasToken,
    });
  }

  assertProbeAllowed() {
    const reason = this.probeBlockReason;
    if (reason) throw new Error(reason);
    if (!this.probeConfirmed) throw new Error('Confirm the Stage target and main branch first.');
  }

  async runProbeOperation(operation, onSuccess) {
    if (this.probeBusy) {
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
      if (this.isConnected && !controller.signal.aborted) onSuccess(value);
    } catch (error) {
      if (this.isConnected && !controller.signal.aborted) {
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
      const request = createProbeRequest();
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
      const pointer = loadProbePointer(window.localStorage);
      if (!pointer) throw new Error('No saved probe is available on this app origin.');
      const request = await readProbeRequest(this.hostActions.daFetch, pointer.jobId, { signal });
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

  renderProbe() {
    const blocked = this.probeBlockReason;
    const disabled = Boolean(blocked) || !this.probeConfirmed || this.probeBusy;
    const statuses = {
      idle: 'No probe prepared.',
      preparing: 'Writing and reading back the Stage request.',
      prepared: 'Request readback verified. Ready to review the prompt in chat.',
      requested: 'Handoff requested; submission and execution are not acknowledged. Check chat.',
      pending: 'No result received yet (HTTP 404). Refresh after the chat write completes.',
      received: 'Matching probe result received. Confirm the actual write tool operation in chat.',
      'agent-error': 'The agent reported a probe error.',
      error: 'Probe operation failed.',
    };
    return html`
      <section class="probe" aria-labelledby="probe-heading">
        <h2 id="probe-heading">Stage storage / chat probe</h2>
        <p>
          Target: Stage <strong>msagolj/ew</strong>, site code branch <strong>main</strong>.
          Only this run's scratch files under <code>/.da/block-library-generator/jobs/</code>
          may be written. No Cards analysis, library writes, or publication.
        </p>
        <dl class="context-fields" aria-label="Probe target">
          <div class="context-field">
            <dt>DA admin</dt><dd>${PROBE_TARGET.adminOrigin}</dd>
          </div>
          <div class="context-field">
            <dt>Host environment</dt>
            <dd>${this.hostContext.daOrigin || 'Not supplied; verify the editor uses da-admin=stage.'}</dd>
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
          I confirm that the parent editor and chat are using Stage msagolj/ew and the
          site code branch is main. If chat cannot target Stage, it must not write.
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
        </p>
      </section>
    `;
  }

  render() {
    const statuses = {
      waiting: 'Waiting for DA',
      ready: 'Connected',
      unavailable: 'No DA context',
      error: 'Connection error',
    };
    const fields = [
      ['Organization', this.context.org],
      ['Site', this.context.site],
      ['Path', this.context.path],
      ['Ref', this.context.ref],
      ['Session', this.hasToken ? 'Token available' : 'No token'],
    ];

    return html`
      <main>
        <header class="app-header">
          <h1>Block Library Generator</h1>
          <p class="connection-status" data-state=${this.connectionState} role="status">
            ${statuses[this.connectionState]}
          </p>
        </header>
        <dl class="context-fields" aria-label="DA context">
          ${fields.map(([label, value]) => html`
            <div class="context-field">
              <dt>${label}</dt>
              <dd>${value || 'Unavailable'}</dd>
            </div>
          `)}
        </dl>
        ${this.renderProbe()}
      </main>
    `;
  }
}

customElements.define('block-library-generator-app', BlockLibraryGeneratorApp);
