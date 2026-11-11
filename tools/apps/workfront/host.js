const embedded = typeof window !== 'undefined' && window.self !== window.top;
const connection = embedded ? import('https://da.live/nx/utils/sdk.js').then((module) => module.default) : null;
if (connection) connection.catch(() => {});
let currentToken = '';
let watchingForRefresh = false;

export function normalizeContext(context = {}) {
  const { org, repo } = context;
  if (typeof org !== 'string' || typeof repo !== 'string' || !org || !repo) return null;
  const path = typeof context.path === 'string' && context.path
    ? `/${context.path.replace(/^\/+/, '')}`
    : '';
  const encodedPath = path.replace(/\.html$/i, '').split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const filename = path.split('/').filter(Boolean).pop() || '';
  const title = filename.replace(/\.html$/, '').replace(/[-_]/g, ' ');
  return {
    siteId: `${org}/${repo}`,
    siteName: repo,
    path,
    url: path ? `https://da.live/canvas#/${encodeURIComponent(org)}/${encodeURIComponent(repo)}${encodedPath}` : '',
    title: title ? `${title[0].toUpperCase()}${title.slice(1)}` : 'No page selected',
  };
}

export async function connectToHost() {
  if (!embedded) return { embedded: false, context: null, actions: null };
  let timer;
  try {
    const sdk = await Promise.race([
      connection,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Experience Workspace did not provide page context. Reopen the plugin and retry.')), 8000);
      }),
    ]);
    currentToken = typeof sdk.token === 'string' ? sdk.token : '';
    if (!watchingForRefresh) {
      window.addEventListener('message', (event) => {
        if (event.source === window.parent && typeof event.data?.token === 'string') {
          currentToken = event.data.token;
        }
      });
      watchingForRefresh = true;
    }
    return {
      embedded: true,
      context: normalizeContext(sdk.context),
      actions: sdk.actions,
      getToken: () => currentToken,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function putBriefInChat(actions, text) {
  if (typeof actions?.setPrompt !== 'function') {
    throw new Error('The chat composer is unavailable in this version of Experience Workspace.');
  }
  actions.setPrompt(text, { autoSend: false });
  actions.showPanel?.('chat');
}