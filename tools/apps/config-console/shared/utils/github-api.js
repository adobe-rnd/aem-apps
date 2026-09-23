import { buildTreeAPIURL, buildContentsAPIURL } from './github-parser.js';
import TokenStorage from './token-storage.js';

const FETCH_TIMEOUT_MS = 10000;

/**
 * Wrapper around fetch that rejects after `ms` milliseconds.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} [ms]
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, options = {}, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export default class GitHubAPI {
  constructor(org, repo, branch = 'main', token = null) {
    this.org = org;
    this.repo = repo;
    this.branch = branch;
    this.token = token || TokenStorage.get();
  }

  static getHeaders(token = null) {
    const headers = {
      Accept: 'application/vnd.github.v3+json',
    };

    const authToken = token || TokenStorage.get();
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    return headers;
  }

  async validateAccess() {
    try {
      const response = await fetchWithTimeout(
        `https://api.github.com/repos/${this.org}/${this.repo}`,
        { headers: GitHubAPI.getHeaders(this.token) },
      );

      const rateLimit = parseInt(response.headers.get('X-RateLimit-Remaining') || '0', 10);
      const rateLimitReset = response.headers.get('X-RateLimit-Reset');

      if (!response.ok) {
        if (response.status === 403) {
          if (rateLimit === 0) {
            const resetTime = rateLimitReset
              ? new Date(parseInt(rateLimitReset, 10) * 1000).toLocaleTimeString()
              : 'soon';
            return {
              valid: false,
              rateLimit: 0,
              error: 'rate_limit',
              resetTime,
              needsToken: !this.token,
            };
          }
          return {
            valid: false,
            rateLimit,
            error: 'private',
            needsToken: !this.token,
          };
        }
        if (response.status === 404) {
          return {
            valid: false,
            rateLimit,
            error: 'not_found',
            needsToken: false,
          };
        }
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.private && !this.token) {
        return {
          valid: false,
          rateLimit,
          error: 'private',
          needsToken: true,
        };
      }

      return {
        valid: true,
        rateLimit,
        error: null,
      };
    } catch (error) {
      return {
        valid: false,
        rateLimit: 0,
        error: error.message,
      };
    }
  }

  /**
   * Discovers blocks in the repository
   * @returns {Promise<Array<{name: string, path: string}>>}
   */
  async discoverBlocks() {
    try {
      const url = buildTreeAPIURL(this.org, this.repo, this.branch);
      const response = await fetchWithTimeout(url, { headers: GitHubAPI.getHeaders(this.token) });

      if (!response.ok) {
        if (response.status === 403) {
          const remaining = response.headers.get('X-RateLimit-Remaining');
          if (remaining === '0') {
            throw new Error('GitHub API rate limit exceeded. Please add a GitHub token.');
          }
        }
        throw new Error(`Failed to fetch repository tree: ${response.status}`);
      }

      const data = await response.json();
      const tree = data.tree || [];

      const blocksPattern = /(^|\/)blocks\//;
      const blockFiles = tree.filter((item) => blocksPattern.test(item.path) && item.type === 'tree');

      const blocks = blockFiles.map((item) => {
        const pathParts = item.path.split('/');
        const blocksIndex = pathParts.indexOf('blocks');
        const blockName = pathParts[blocksIndex + 1];
        return {
          name: blockName,
          path: item.path,
        };
      });

      const uniqueBlocks = Array.from(
        new Map(blocks.map((block) => [block.name, block])).values(),
      );

      return uniqueBlocks;
    } catch (error) {
      throw new Error(`Failed to discover blocks: ${error.message}`);
    }
  }

  /**
   * Fetches file contents from GitHub
   * @param {string} path - File path in repository
   * @returns {Promise<string>} File contents
   */
  async fetchFileContents(path) {
    try {
      const url = buildContentsAPIURL(this.org, this.repo, path, this.branch);
      const response = await fetchWithTimeout(url, { headers: GitHubAPI.getHeaders(this.token) });

      if (!response.ok) {
        throw new Error(`Failed to fetch file ${path}: ${response.status}`);
      }

      const data = await response.json();

      if (data.content) {
        return atob(data.content);
      }

      throw new Error(`No content found for ${path}`);
    } catch (error) {
      throw new Error(`Failed to fetch file ${path}: ${error.message}`);
    }
  }

  /**
   * Fetches multiple files in parallel
   * @param {Array<string>} paths - Array of file paths
   * @returns {Promise<Array<{path: string, content: string, error: string|null}>>}
   */
  async fetchMultipleFiles(paths) {
    const results = await Promise.allSettled(
      paths.map(async (path) => {
        try {
          const content = await this.fetchFileContents(path);
          return { path, content, error: null };
        } catch (error) {
          return { path, content: null, error: error.message };
        }
      }),
    );

    return results.map((result) => (result.status === 'fulfilled' ? result.value : result.reason));
  }

  /**
   * Gets raw file URL for direct access
   * @param {string} path - File path in repository
   * @returns {string} Raw file URL
   */
  getRawFileURL(path) {
    return `https://raw.githubusercontent.com/${this.org}/${this.repo}/${this.branch}/${path}`;
  }

  /**
   * Alias for fetchFileContents to match MCP API conventions
   * @param {string} path - File path in repository
   * @returns {Promise<string|null>} File contents or null if not found
   */
  async getFileContent(path) {
    try {
      return await this.fetchFileContents(path);
    } catch (error) {
      return null;
    }
  }

  /**
   * Gets commit history for a specific path
   * @param {string} path - File or folder path in repository
   * @param {number} perPage - Number of commits to fetch (default 10, max 100)
   * @returns {Promise<Array>} Array of commit objects
   */
  async getCommits(path, perPage = 10) {
    try {
      const url = new URL(`https://api.github.com/repos/${this.org}/${this.repo}/commits`);
      url.searchParams.set('path', path);
      url.searchParams.set('per_page', Math.min(perPage, 100).toString());
      url.searchParams.set('sha', this.branch);

      const response = await fetchWithTimeout(url.toString(), {
        headers: GitHubAPI.getHeaders(this.token),
      });

      if (!response.ok) {
        if (response.status === 404) {
          // Path doesn't exist in repo
          return [];
        }
        throw new Error(`Failed to fetch commits: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Failed to get commits for ${path}: ${error.message}`);
    }
  }
}
