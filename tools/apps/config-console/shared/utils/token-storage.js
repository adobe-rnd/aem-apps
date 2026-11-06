// sessionStorage keeps the token for the current browser session only.
// Unlike localStorage it is cleared when the tab/window closes, limiting
// exposure if the machine is shared or compromised.
const STORAGE_KEY = 'siteadmin-github-token';

const TokenStorage = {
  get() {
    return sessionStorage.getItem(STORAGE_KEY);
  },

  set(token) {
    sessionStorage.setItem(STORAGE_KEY, token);
  },

  clear() {
    sessionStorage.removeItem(STORAGE_KEY);
  },

  exists() {
    return !!this.get();
  },
};

export default TokenStorage;
