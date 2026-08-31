/* eslint-disable no-underscore-dangle */
/**
 * Message Handler Mixin
 * Provides message display functionality with auto-dismiss
 *
 * Usage:
 *   class MyClass extends MessageHandlerMixin(BaseClass) {
 *     static properties = {
 *       ...super.properties,
 *       ...MessageHandlerMixin.properties,
 *     };
 *   }
 */

/**
 * Properties required by this mixin
 */
export const MessageHandlerProperties = {
  _message: { state: true },
};

/**
 * Mixin that adds message handling capabilities
 * @param {Class} Base - Base class to extend
 * @returns {Class} Extended class with message handling
 */
export function MessageHandlerMixin(Base) {
  return class extends Base {
    constructor() {
      super();
      this._message = null;
      this._messageTimer = null;
    }

    /**
     * Show a message with optional auto-dismiss
     * @param {string} type - Message type ('success', 'error', 'info', 'warning')
     * @param {string} text - Message text
     * @param {boolean} autoDismiss - Whether to auto-dismiss after 3 seconds
     */
    _showMessage(type, text, autoDismiss = true) {
      // Clear any existing timer
      if (this._messageTimer) {
        clearTimeout(this._messageTimer);
        this._messageTimer = null;
      }

      this._message = { type, text };

      // Auto-dismiss success messages after 3 seconds
      if (autoDismiss && type === 'success') {
        this._messageTimer = setTimeout(() => {
          this._message = null;
          this._messageTimer = null;
          this.requestUpdate();
        }, 3000);
      }
    }

    /**
     * Clear the current message
     */
    _clearMessage() {
      if (this._messageTimer) {
        clearTimeout(this._messageTimer);
        this._messageTimer = null;
      }
      this._message = null;
    }

    /**
     * Cleanup when component disconnects
     */
    disconnectedCallback() {
      if (super.disconnectedCallback) {
        super.disconnectedCallback();
      }
      if (this._messageTimer) {
        clearTimeout(this._messageTimer);
        this._messageTimer = null;
      }
    }
  };
}

export default MessageHandlerMixin;
