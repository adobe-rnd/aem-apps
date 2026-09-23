/* eslint-disable no-underscore-dangle, class-methods-use-this */
/**
 * Form Handler Mixin
 * Provides form management functionality
 *
 * Usage:
 *   class MyClass extends FormHandlerMixin(BaseClass) {
 *     static properties = {
 *       ...super.properties,
 *       ...FormHandlerMixin.properties,
 *     };
 *   }
 */

/**
 * Properties required by this mixin
 */
export const FormHandlerProperties = {
  _form: { state: true },
  _editingIndex: { state: true },
  _showAddForm: { state: true },
};

/**
 * Mixin that adds form handling capabilities
 * @param {Class} Base - Base class to extend
 * @returns {Class} Extended class with form handling
 */
export function FormHandlerMixin(Base) {
  return class extends Base {
    constructor() {
      super();
      this._form = this._getDefaultFormState();
      this._editingIndex = -1;
      this._showAddForm = false;
    }

    /**
     * Override this to provide default form state
     * @returns {Object} Default form state
     */
    _getDefaultFormState() {
      return {};
    }

    /**
     * Handle form field change
     * @param {string} field - Field name
     * @param {*} value - New value
     */
    _handleFormChange(field, value) {
      this._form = { ...this._form, [field]: value };
    }

    /**
     * Override this to implement form validation
     * @returns {boolean} Whether form is valid
     */
    _isFormValid() {
      return true;
    }

    /**
     * Toggle add form visibility
     */
    _toggleAddForm() {
      this._showAddForm = !this._showAddForm;
      if (!this._showAddForm) {
        this._form = this._getDefaultFormState();
        this._editingIndex = -1;
      }
    }

    /**
     * Cancel editing and reset form
     */
    _handleCancelEdit() {
      this._editingIndex = -1;
      this._form = this._getDefaultFormState();
      this._showAddForm = false;
      if (this._clearMessage) {
        this._clearMessage();
      }
    }

    /**
     * Check if currently editing
     * @returns {boolean} Whether editing
     */
    _isEditing() {
      return this._editingIndex >= 0;
    }
  };
}

export default FormHandlerMixin;
