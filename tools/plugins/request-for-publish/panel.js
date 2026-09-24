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
/* eslint-disable no-underscore-dangle, import/no-unresolved */
import { LitElement, html, nothing } from 'da-lit';
import {
  normalizeContext, deriveView, pageLinks, sameRequest,
} from './workflow.js';

const style = new CSSStyleSheet();
style.replaceSync(await (await fetch(new URL('./request-for-publish.css', import.meta.url))).text());

function peopleList(label, people) {
  const unique = [...new Set(people)];
  if (!unique.length) return nothing;
  return html`<div class="detail"><span class="label">${label}</span>
    <ul class="people">${unique.map((email) => html`<li>${email}</li>`)}</ul></div>`;
}

class RequestForPublish extends LitElement {
  static properties = {
    context: { attribute: false },
    client: { attribute: false },
    _data: { state: true },
    _loading: { state: true },
    _busy: { state: true },
    _notice: { state: true },
    _error: { state: true },
    _confirmation: { state: true },
    _fieldError: { state: true },
    _receipt: { state: true },
    _unknown: { state: true },
    _expanded: { state: true },
  };

  _epoch = 0;

  _read = 0;

  _comment = '';

  _reason = '';

  _return = () => {
    if (!this._busy && !this._confirmation && document.visibilityState === 'visible') this.refresh();
  };

  // A class field would shadow Lit's reactive accessor, so initialize here.
  constructor() {
    super();
    this._expanded = new Set();
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    window.addEventListener('focus', this._return);
    document.addEventListener('visibilitychange', this._return);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._epoch += 1;
    window.removeEventListener('focus', this._return);
    document.removeEventListener('visibilitychange', this._return);
  }

  willUpdate(changed) {
    if (changed.has('context') || changed.has('client')) {
      this._epoch += 1;
      this._data = undefined;
      this._notice = undefined;
      this._receipt = undefined;
      this._unknown = undefined;
      this._confirmation = undefined;
      this._busy = undefined;
      this._comment = '';
      this._reason = '';
      this._expanded = new Set();
      this._fieldError = undefined;
      this._error = undefined;
      this._loading = !!this.page;
    }
  }

  updated(changed) {
    if (changed.has('context') || changed.has('client')) this.refresh();
    if (changed.has('_data')) {
      const { accentColor = '', accentColorHover = '' } = this._data?.settings || {};
      this.style.setProperty('--pw-accent', accentColor);
      this.style.setProperty('--pw-accent-hover', accentColorHover);
      this.toggleAttribute('themed', !!accentColor);
    }
  }

  get page() { return normalizeContext(this.context); }

  get state() { return deriveView(this.page, this._data); }

  get disabled() { return !!this._busy || !!this._loading; }

  toggle(index) {
    const expanded = new Set(this._expanded);
    if (!expanded.delete(index)) expanded.add(index);
    this._expanded = expanded;
  }

  expand(index) {
    if (this._expanded.has(index)) return;
    this._expanded = new Set(this._expanded).add(index);
  }

  async refresh() {
    const { page } = this;
    if (!page || !this.client || this._busy) return;
    const epoch = this._epoch;
    this._read += 1;
    const read = this._read;
    this._loading = true;
    this._error = undefined;
    try {
      const data = await this.client.load(page);
      if (epoch !== this._epoch || read !== this._read) return;
      const previous = this.state.request;
      this._data = data;
      if (previous && !this.state.request && !this._notice && !this._receipt) {
        this._notice = { text: 'This request is no longer pending. It has been approved, rejected or withdrawn.' };
      }
    } catch (error) {
      if (epoch !== this._epoch || read !== this._read) return;
      this._data = undefined;
      this._error = error;
    } finally {
      if (epoch === this._epoch && read === this._read) this._loading = false;
    }
  }

  confirm(action) {
    this._confirmation = action;
    this._fieldError = undefined;
    this._reason = '';
    this.expand(this.state.current);
    this.updateComplete.then(() => this.shadowRoot.querySelector(action === 'reject' ? '#reason' : '.confirm-primary')?.focus());
  }

  cancel() {
    const label = this._confirmation === 'reject' ? 'reject' : 'withdraw';
    this._confirmation = undefined;
    this._fieldError = undefined;
    this.updateComplete.then(() => this.shadowRoot.querySelector(`[data-action="${label}"]`)?.focus());
  }

  async act(action) {
    if (this.disabled || this._unknown) return;
    const context = this.page;
    const {
      request, canApprove, canWithdraw, view,
    } = this.state;
    if (!context || !this._data) return;
    if ((action === 'submit' && view !== 'request')
      || (['approve', 'reject'].includes(action) && !canApprove)
      || (['withdraw', 'resend'].includes(action) && !canWithdraw)
      || (action === 'complete' && !this._receipt)) return;
    const comment = this._comment.trim();
    if (action === 'submit' && this._data.settings.commentsRequired
      && comment.length < this._data.settings.commentsMinLength) {
      this._fieldError = `Enter at least ${this._data.settings.commentsMinLength} characters.`;
      this.updateComplete.then(() => this.shadowRoot.querySelector('#comment')?.focus());
      return;
    }
    if (action === 'reject' && !this._reason.trim()) {
      this._fieldError = 'Enter a reason for rejection.';
      this.updateComplete.then(() => this.shadowRoot.querySelector('#reason')?.focus());
      return;
    }
    const epoch = this._epoch;
    const { client } = this;
    const expected = action === 'complete' ? this._receipt : request;
    const { current, steps } = this.state;
    // Trailing steps without approvers are skipped, so the last staffed step publishes.
    const next = steps.find((step) => step.index > current && step.approvers.length > 0);
    const final = !next;
    const messages = {
      submit: 'Request sent. An approver can now review this page.',
      resend: 'Notification sent again. Your request is still pending.',
      withdraw: 'Request withdrawn. You can submit a new request.',
      reject: 'Request rejected.',
      approve: final
        ? 'Published. The publish request is complete.'
        : `Step approved. The reviewers for ${next.title} have been notified.`,
      complete: 'The publish request is now complete.',
    };
    this._busy = 'Working…';
    this._notice = undefined;
    this._fieldError = undefined;
    const phase = (label) => { if (epoch === this._epoch) this._busy = label; };
    try {
      if (action === 'submit') await client.submit(context, comment, phase);
      else if (action === 'reject') await client.reject(context, expected, this._reason);
      else if (action === 'approve') await client.approve(context, expected, { step: current, final }, phase);
      else if (action === 'complete') await client.complete(context, expected, { step: current });
      else await client[action](context, expected, phase);
      if (epoch !== this._epoch) return;
      this._notice = { type: 'success', text: messages[action] };
      if (action === 'submit') this._comment = '';
      if (action === 'approve' || action === 'complete') this._receipt = undefined;
      this._confirmation = undefined;
    } catch (error) {
      if (epoch !== this._epoch) return;
      if (error.published) this._receipt = expected;
      if (error.publishUnknown) this._unknown = expected;
      this._notice = { type: 'error', text: error.message };
    } finally {
      if (epoch === this._epoch) {
        this._busy = undefined;
        await this.refresh();
      }
    }
  }

  renderConfirmation() {
    if (!this._confirmation) return nothing;
    const reject = this._confirmation === 'reject';
    return html`<section class="confirmation" aria-label="${reject ? 'Reject request' : 'Withdraw request'}">
      <h3>${reject ? 'Reject this request?' : 'Withdraw your request?'}</h3>
      ${reject ? html`
        <label for="reason">Reason for rejection</label>
        <textarea id="reason" rows="3" required .value=${this._reason}
          aria-describedby="reason-hint field-error" aria-invalid=${this._fieldError ? 'true' : 'false'}
          ?disabled=${this.disabled} @input=${(e) => { this._reason = e.target.value; }}></textarea>
        <p id="reason-hint" class="hint">The requester will receive this reason.</p>
      ` : html`<p>This removes your pending request. You can request approval again later.</p>`}
      ${this.renderFieldError()}
      <div class="actions">
        <button class="negative confirm-primary" ?disabled=${this.disabled} @click=${() => this.act(reject ? 'reject' : 'withdraw')}>${reject ? 'Reject request' : 'Withdraw request'}</button>
        <button ?disabled=${this.disabled} @click=${this.cancel}>Cancel</button>
      </div>
    </section>`;
  }

  renderFieldError() {
    return html`<p id="field-error" class="field-error" role="alert">${this._fieldError || ''}</p>`;
  }

  renderReceipt() {
    const links = pageLinks(this.page);
    const canRetry = sameRequest(this.state.request, this._receipt);
    let nextStep = 'The request is no longer pending. Notification delivery could not be confirmed.';
    if (this._error) nextStep = 'Request status could not be checked. Refresh before taking another action.';
    if (canRetry) nextStep = 'The page was published. Retry only the request update; this will not publish again.';
    return html`<section class="receipt" role="status">
      <h2>Published; request update incomplete</h2>
      <p>${nextStep}</p>
      <a href=${links.live} target="_blank" rel="noopener noreferrer">Open live page ↗</a>
      ${canRetry ? html`<button ?disabled=${this.disabled} @click=${() => this.act('complete')}>Retry request update</button>` : nothing}
    </section>`;
  }

  renderLinks() {
    const links = pageLinks(this.page, new URLSearchParams(window.location.search).get('env'));
    return html`<div class="review-links">
      <a class="review-link" href=${links.diff} target="_blank" rel="noopener noreferrer">Review changes <span aria-hidden="true">↗</span></a>
      <a href=${links.preview} target="_blank" rel="noopener noreferrer">Open preview <span aria-hidden="true">↗</span></a>
      <p class="hint">Compare the current preview with the live page.</p>
    </div>`;
  }

  renderRequestForm() {
    const { settings } = this._data;
    return html`<div class="request-form">
      <label for="comment">Note to reviewers <span class="hint">${settings.commentsRequired ? '(required)' : '(optional)'}</span></label>
      <textarea id="comment" rows="3" .value=${this._comment} ?disabled=${this.disabled}
        ?required=${settings.commentsRequired} aria-invalid=${this._fieldError ? 'true' : 'false'}
        aria-describedby=${settings.commentsRequired ? 'comment-hint field-error' : 'field-error'} @input=${(e) => { this._comment = e.target.value; }}></textarea>
      ${settings.commentsRequired ? html`<p class="hint" id="comment-hint">At least ${settings.commentsMinLength} characters.</p>` : nothing}
      ${this.renderFieldError()}
      <button class="primary" ?disabled=${this.disabled} @click=${() => this.act('submit')}>Request publish</button>
    </div>`;
  }

  renderStepBody(step, state, inline = false) {
    if (step.state === 'approved') {
      const when = step.approvedAt && new Date(step.approvedAt);
      return html`<dl class="metadata">
        <div><dt>Approved by</dt><dd>${step.approvedBy}</dd></div>
        ${when && !Number.isNaN(when.getTime()) ? html`<div><dt>Approved</dt><dd><time datetime=${step.approvedAt}>${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></dd></div>` : nothing}
      </dl>`;
    }
    if (step.state === 'skipped') {
      return html`<p class="hint">No approvers are configured for this step, so it is skipped.</p>`;
    }
    if (step.state === 'upcoming' || !state.request) {
      return html`${peopleList('Approvers', step.approvers)}
        ${peopleList('Also notified', step.cc)}`;
    }
    if (this._confirmation) return this.renderConfirmation();
    const approveInline = inline && state.canApprove;
    const actionable = approveInline || state.canApprove || state.canWithdraw;
    return html`
      ${peopleList('Approvers', step.approvers)}
      ${peopleList('Also notified', step.cc)}
      ${state.request.comment ? html`<div class="detail"><span class="label">Request note</span><p class="note">${state.request.comment}</p></div>` : nothing}
      ${this.renderLinks()}
      ${actionable ? html`<div class="decision-actions">
        ${approveInline ? html`<button class="primary" ?disabled=${this.disabled} @click=${() => this.act('approve')}>${state.current >= state.lastStaffed ? 'Approve & publish' : 'Approve'}</button>` : nothing}
        ${state.canApprove ? html`<button class="quiet" data-action="reject" ?disabled=${this.disabled} @click=${() => this.confirm('reject')}>Reject…</button>` : nothing}
        ${state.canWithdraw ? html`<button class="quiet" ?disabled=${this.disabled} @click=${() => this.act('resend')}>Resend notification</button>
          <button class="quiet" data-action="withdraw" ?disabled=${this.disabled} @click=${() => this.confirm('withdraw')}>Withdraw…</button>` : nothing}
      </div>` : nothing}`;
  }

  renderStep(step, state) {
    const expanded = this._expanded.has(step.index);
    const current = step.state === 'current';
    const actionable = current && state.canApprove && state.request && !this._confirmation;
    return html`<li class="step ${step.state}">
      <div class="step-head">
        <button class="step-toggle" aria-expanded=${expanded ? 'true' : 'false'} @click=${() => this.toggle(step.index)}>
          <span class="marker" aria-hidden="true"></span>
          <span class="step-text">
            <span class="step-title">${step.title}</span>
            ${step.description ? html`<span class="step-description">${step.description}</span>` : nothing}
            ${step.approvedBy ? html`<span class="step-meta">Approved by ${step.approvedBy}</span>` : nothing}
            ${step.state === 'skipped' ? html`<span class="step-meta">Skipped — no approvers</span>` : nothing}
          </span>
        </button>
        ${actionable ? html`<button class="primary step-action" ?disabled=${this.disabled} @click=${() => this.act('approve')}>${state.current >= state.lastStaffed ? 'Approve & publish' : 'Approve'}</button>` : nothing}
      </div>
      ${expanded ? html`<div class="step-body">${this.renderStepBody(step, state)}</div>` : nothing}
    </li>`;
  }

  renderContent() {
    if (this._unknown && this.page) {
      return html`<section class="receipt" role="status"><h2>Publication outcome unknown</h2>
        <p>The publish response was lost or could not be confirmed. The page may already be live. Check it before taking another action; do not publish again just to retry the request.</p>
        <a href=${pageLinks(this.page).live} target="_blank" rel="noopener noreferrer">Open live page ↗</a>
      </section>`;
    }
    if (this._receipt && this.page) return this.renderReceipt();
    if (this._error) {
      return html`<section class="empty"><h2>Request status unavailable</h2>
      <p>${this._error.status === 401 ? 'Your session has expired. Reopen the plugin after signing in.' : this._error.message}</p></section>`;
    }
    const { state } = this;
    if (state.view === 'loading') return html`<p class="loading" role="status">Checking publish request…</p>`;
    if (state.view === 'blocked') return html`<section class="empty"><h2>Publish request unavailable</h2><p>${state.message}</p></section>`;
    const { request } = state;
    const requesting = state.view === 'request';
    const created = request?.created && new Date(request.created);
    const waiting = state.canApprove ? 'Ready for your review' : 'Awaiting approval';
    const nextStep = state.canApprove
      ? 'Review the changes, then approve this step.'
      : 'A reviewer needs to approve the current step.';
    const status = state.bare ? 'Pending approval' : `Step ${state.current} of ${state.count}`;
    const intro = state.bare
      ? 'Send this page to its reviewers before publishing.'
      : 'Send this page through its approval steps before publishing.';
    const current = state.steps.find((step) => step.state === 'current') || state.steps[0];
    return html`
      <section class="summary">
        <span class="status ${requesting ? 'neutral' : 'pending'}">${requesting ? 'Ready to request' : status}</span>
        <h2>${requesting ? 'Request approval' : waiting}</h2>
        <p>${requesting ? intro : nextStep}</p>
      </section>
      ${request ? html`<dl class="metadata">
        <div><dt>Requested by</dt><dd>${state.canWithdraw ? 'You' : request.requester}</dd></div>
        ${created && !Number.isNaN(created.getTime()) ? html`<div><dt>Submitted</dt><dd><time datetime=${request.created}>${created.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></dd></div>` : nothing}
      </dl>` : nothing}
      ${state.bare
    ? html`${current ? this.renderStepBody(current, state, true) : nothing}`
    : html`<ol class="steps">${state.steps.map((step) => this.renderStep(step, state))}</ol>`}
      ${requesting ? html`${this.renderLinks()}${this.renderRequestForm()}` : nothing}
    `;
  }

  render() {
    const links = this.page && pageLinks(this.page, new URLSearchParams(window.location.search).get('env'));
    return html`<div class="panel" aria-busy=${this.disabled ? 'true' : 'false'}>
      <header class="page-header"><div><span class="eyebrow">Publish request</span><p class="page-path">${this.page?.path || 'No page selected'}</p></div>
        <button class="quiet refresh" ?disabled=${this.disabled || !this.page} @click=${this.refresh}>Refresh</button>
      </header>
      ${this._notice ? html`<div class="notice ${this._notice.type || ''}" role=${this._notice.type === 'error' ? 'alert' : 'status'}>${this._notice.text}</div>` : nothing}
      ${this._busy ? html`<p class="progress" role="status">${this._busy}</p>` : nothing}
      ${this.renderContent()}
      ${links ? html`<footer><a href=${this.state.canWithdraw ? links.myRequests : links.inbox} target="_blank" rel="noopener noreferrer">Open inbox <span aria-hidden="true">↗</span></a>
        ${this._data?.settings.supportContact ? html`<a href=${`mailto:${this._data.settings.supportContact}`}>Contact support</a>` : nothing}
      </footer>` : nothing}
    </div>`;
  }
}

customElements.define('request-for-publish', RequestForPublish);
