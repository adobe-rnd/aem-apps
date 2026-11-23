export function parseGitHubURL(url) {
  if (!url) {
    return { org: '', repo: '', error: 'URL is required' };
  }

  const cleanUrl = url.trim();

  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/\s.]+)/i,
    /^git@github\.com:([^/]+)\/([^/\s.]+)/i,
    /^([^/]+)\/([^/\s.]+)$/,
  ];

  const matchResult = patterns.reduce((result, pattern) => {
    if (result) return result;

    const match = cleanUrl.match(pattern);
    if (match) {
      const org = match[1];
      let repo = match[2];

      repo = repo.replace(/\.git$/, '');

      if (org && repo && /^[a-zA-Z0-9._-]+$/.test(org) && /^[a-zA-Z0-9._-]+$/.test(repo)) {
        return { org, repo, error: null };
      }
    }
    return null;
  }, null);

  if (matchResult) {
    return matchResult;
  }

  return { org: '', repo: '', error: 'Invalid GitHub URL format' };
}

export function buildTreeAPIURL(org, repo, branch = 'main') {
  return `https://api.github.com/repos/${org}/${repo}/git/trees/${branch}?recursive=1`;
}

export function buildContentsAPIURL(org, repo, path, branch = 'main') {
  return `https://api.github.com/repos/${org}/${repo}/contents/${path}?ref=${branch}`;
}
