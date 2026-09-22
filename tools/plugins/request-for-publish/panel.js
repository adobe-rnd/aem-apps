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
import { normalizeContext, deriveView, pageLinks } from './workflow.js';

const style = new CSSStyleSheet();
style.replaceSync(await (await fetch(new URL('./request-for-publish.css', import.meta.url))).text());

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
  };

  _epoch = 0;

  _read = 0;

  _comment = '';

  _reason = '';

  _return = () => {
    if (!this._busy && !this._confirmation && document.visibilityState === 'visible') this.refresh();
  };

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

  updated(changed) {
    if (changed.has('context') || changed.has('client')) {
      this._epoch += 1;
      this._data = undefined;
      this._notice = undefined;
      this._receipt = undefined;
      this._confirmation = undefined;
      this._busy = undefined;
      this._comment = '';
      this._reason = '';
      this._fieldError = undefined;
      this.refresh();
    }
  }

  get page() { return normalizeContext(this.context); }

  get state() { return deriveView(this.page, this._data); }

  get disabled() { return !!this._busy || !!this._loading; }

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
        this._notice = { text: 'This request is no longer pending. Refreshing cannot tell whether it was approved, rejected or withdrawn.' };
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
    this.updateComplete.then(() => this.shadowRoot.querySelector(action === 'reject' ? '#reason' : '.confirm-primary')?.focus());
  }

  cancel() {
    const label = this._confirmation === 'reject' ? 'reject' : 'withdraw';
    this._confirmation = undefined;
    this._fieldError = undefined;
    this.updateComplete.then(() => this.shadowRoot.querySelector(`[data-action="${label}"]`)?.focus());
  }

  async act(action) {
    if (this.disabled) return;
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
    const messages = {
      submit: 'Request sent. An approver can now review this page.',
      resend: 'Notification sent again. Your request is still pending.',
      withdraw: 'Request withdrawn. You can submit a new request.',
      reject: 'Request rejected.',
      approve: 'Published. The publish request is complete.',
      complete: 'The publish request is now complete.',
    };
    this._busy = 'Working…';
    this._notice = undefined;
    this._fieldError = undefined;
    const phase = (label) => { if (epoch === this._epoch) this._busy = label; };
    try {
      if (action === 'submit') await client.submit(context, comment, phase);
      else if (action === 'reject') await client.reject(context, expected, this._reason);
      else await client[action](context, expected, phase);
      if (epoch !== this._epoch) return;
      this._notice = { type: 'success', text: messages[action] };
      if (action === 'submit') this._comment = '';
      if (action === 'approve' || action === 'complete') this._receipt = undefined;
      this._confirmation = undefined;
    } catch (error) {
      if (epoch !== this._epoch) return;
      if (error.published) this._receipt = expected;
      this._notice = { type: 'error', text: error.message };
    } finally {
      if (epoch === this._epoch) {
        this._busy = undefined;
        await this.refresh();
      }
    }
  }

  renderReviewers() {
    const people = [...new Set([...this._data.approvers, ...this._data.cc])];
    return html`<div class="detail"><span class="label">Reviewers</span>
      <ul class="people">${people.map((email) => html`<li>${email}</li>`)}</ul></div>`;
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

  renderContent() {
    if (this._error) {
      return html`<section class="empty"><h2>Request status unavailable</h2>
      <p>${this._error.status === 401 ? 'Your session has expired. Reopen the plugin after signing in.' : this._error.message}</p></section>`;
    }
    const { state } = this;
    if (state.view === 'loading') return html`<p class="loading" role="status">Checking publish request…</p>`;
    if (state.view === 'blocked') return html`<section class="empty"><h2>Publish request unavailable</h2><p>${state.message}</p></section>`;
    const { request } = state;
    const requesting = state.view === 'request';
    const links = pageLinks(this.page, new URLSearchParams(window.location.search).get('env'));
    const created = request?.created && new Date(request.created);
    const heading = state.canApprove ? 'Ready for your review' : 'Awaiting approval';
    const nextStep = state.canApprove
      ? 'Review the changes, then approve and publish or send them back.'
      : 'A reviewer needs to approve and publish this page.';
    return html`
      <section class="summary">
        <span class="status ${requesting ? 'neutral' : 'pending'}">${requesting ? 'Not requested' : 'Pending approval'}</span>
        <h2>${requesting ? 'Request approval' : heading}</h2>
        <p>${requesting ? 'Send this page to its reviewers before publishing.' : nextStep}</p>
      </section>
      ${request ? html`<dl class="metadata">
        <div><dt>Requested by</dt><dd>${state.canWithdraw ? 'You' : request.requester}</dd></div>
        ${created && !Number.isNaN(created.getTime()) ? html`<div><dt>Submitted</dt><dd><time datetime=${request.created}>${created.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></dd></div>` : nothing}
      </dl>` : nothing}
      ${this.renderReviewers()}
      ${request?.comment ? html`<div class="detail"><span class="label">Request note</span><p class="note">${request.comment}</p></div>` : nothing}
      <div class="review-links">
        <a class="review-link" href=${links.diff} target="_blank" rel="noopener noreferrer">Review changes <span aria-hidden="true">↗</span></a>
        <a href=${links.preview} target="_blank" rel="noopener noreferrer">Open preview <span aria-hidden="true">↗</span></a>
        <p class="hint">Compare the current preview with the live page.</p>
      </div>
      ${this._receipt ? html`<section class="receipt" role="status"><h3>Published; request update incomplete</h3>
        <p>The page was published. Check the request before retrying its update. This will not publish the page again.</p>
        <a href=${links.live} target="_blank" rel="noopener noreferrer">Open live page ↗</a>
        <button ?disabled=${this.disabled} @click=${() => this.act('complete')}>Retry request update</button>
      </section>` : html`
        ${requesting ? html`<div class="request-form">
          <label for="comment">Note to reviewers <span class="hint">${this._data.settings.commentsRequired ? '(required)' : '(optional)'}</span></label>
          <textarea id="comment" rows="3" .value=${this._comment} ?disabled=${this.disabled}
            ?required=${this._data.settings.commentsRequired} aria-invalid=${this._fieldError ? 'true' : 'false'}
            aria-describedby="comment-hint field-error" @input=${(e) => { this._comment = e.target.value; }}></textarea>
          <p class="hint" id="comment-hint">${this._data.settings.commentsRequired ? `At least ${this._data.settings.commentsMinLength} characters. ` : ''}Save your edits first. Requesting approval updates the preview.</p>
          ${this.renderFieldError()}
          <button class="primary" ?disabled=${this.disabled} @click=${() => this.act('submit')}>Request publish</button>
        </div>` : html`
          ${!this._confirmation ? html`<div class="decision-actions">
            ${state.canApprove ? html`<button class="primary" ?disabled=${this.disabled} @click=${() => this.act('approve')}>Approve & publish</button>
              <button class="quiet" data-action="reject" ?disabled=${this.disabled} @click=${() => this.confirm('reject')}>Reject…</button>` : nothing}
            ${state.canWithdraw ? html`<button class="quiet" ?disabled=${this.disabled} @click=${() => this.act('resend')}>Resend notification</button>
              <button class="quiet" data-action="withdraw" ?disabled=${this.disabled} @click=${() => this.confirm('withdraw')}>Withdraw…</button>` : nothing}
          </div>` : this.renderConfirmation()}
        `}
      `}
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
