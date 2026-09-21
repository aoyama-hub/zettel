// Thin wrapper over the GitHub REST API. Plain fetch instead of Octokit keeps the
// token-bearing code path free of third-party scripts.
import { getConfig } from './config.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status = 0, detail = '') {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request(method, path, { body, raw, cfg = getConfig() } = {}) {
  if (!cfg) throw new GitHubError('Not configured.');
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GitHubError('Network error. Check your connection and try again.');
  }
  if (res.ok) {
    if (raw) return res.text();
    return res.status === 204 ? null : res.json();
  }
  let detail = '';
  try { detail = (await res.json()).message || ''; } catch {}
  throw new GitHubError(describe(res, detail), res.status, detail);
}

function describe(res, detail) {
  const s = res.status;
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (s === 429 || (s === 403 && remaining === '0')) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
    return `GitHub rate limit reached.${mins ? ` Try again in ~${mins} min.` : ''}`;
  }
  if (s === 401) return 'GitHub rejected the token (401). Check the access token in settings.';
  if (s === 403) return `The token isn't allowed to do this (403). It needs Contents: read & write on the notes repo.${detail ? ` ${detail}` : ''}`;
  if (s === 404) return 'Not found (404). Check owner, repo, branch, and that the token has access to the repo.';
  if (s === 409) return `Conflict (409). ${detail}`.trim();
  return `GitHub error ${s}${detail ? `: ${detail}` : ''}`;
}

export const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

const repoPath = (cfg = getConfig()) => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

// Writes go through one queue: parallel Contents API commits on the same branch race and 409.
let tail = Promise.resolve();
function serial(fn) {
  const run = tail.then(fn);
  tail = run.catch(() => {});
  return run;
}

export async function checkAccess(cfg) {
  const repo = await request('GET', repoPath(cfg), { cfg });
  try {
    await request('GET', `${repoPath(cfg)}/branches/${encPath(cfg.branch)}`, { cfg });
  } catch (e) {
    // A brand-new empty repo has no branches yet; the first commit will create it.
    if (e.status === 404 && repo.size === 0) return;
    if (e.status === 404) throw new GitHubError(`Branch "${cfg.branch}" not found in ${cfg.owner}/${cfg.repo}.`, 404);
    throw e;
  }
}

/** All blob entries in the branch: [{ path, sha }] */
export async function listTree() {
  const cfg = getConfig();
  try {
    const t = await request('GET', `${repoPath(cfg)}/git/trees/${encPath(cfg.branch)}?recursive=1`);
    return t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }));
  } catch (e) {
    if (e.status === 409 || (e.status === 404 && /empty/i.test(e.detail))) return []; // empty repository
    throw e;
  }
}

export const getBlob = (sha) => request('GET', `${repoPath()}/git/blobs/${sha}`, { raw: true });

/**
 * Fetch many blobs in one GraphQL request (aliases cost 1 point per query instead of 1 REST call per note).
 * Resolves to Map(sha -> text); binary, truncated, or missing blobs are left out for the caller to fetch via REST.
 */
export async function getBlobsBatch(shas) {
  const cfg = getConfig();
  const fields = shas.map((sha, i) => `b${i}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated } }`).join('\n');
  const res = await request('POST', '/graphql', {
    body: { query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner: cfg.owner, name: cfg.repo } },
  });
  const repo = res?.data?.repository;
  if (!repo) throw new GitHubError(res?.errors?.[0]?.message || 'GraphQL request failed.');
  const out = new Map();
  shas.forEach((sha, i) => {
    const b = repo[`b${i}`];
    if (b && typeof b.text === 'string' && !b.isBinary && !b.isTruncated) out.set(sha, b.text);
  });
  return out;
}

export async function getFile(path) {
  const cfg = getConfig();
  const f = await request('GET', `${repoPath(cfg)}/contents/${encPath(path)}?ref=${encodeURIComponent(cfg.branch)}`);
  return { sha: f.sha, text: b64decode(f.content) };
}

/** Create (sha = null) or update a file. Resolves to the new blob sha. */
export function putFile(path, text, sha, message) {
  return serial(async () => {
    const cfg = getConfig();
    const r = await request('PUT', `${repoPath(cfg)}/contents/${encPath(path)}`, {
      body: { message, content: b64encode(text), branch: cfg.branch, ...(sha ? { sha } : {}) },
    });
    return r.content.sha;
  });
}

export function deleteFile(path, sha, message) {
  return serial(async () => {
    const cfg = getConfig();
    await request('DELETE', `${repoPath(cfg)}/contents/${encPath(path)}`, {
      body: { message, sha, branch: cfg.branch },
    });
  });
}

// ---- Deletion safety ----
// The app only ever removes notes automatically from fleeting/. Permanent and literature notes are never
// deleted by any automatic path; these checks sit at the lowest layer so no caller can get around them.
const FLEETING_PATH = /^fleeting\/[^/]+\.md$/;

function assertFleetingPath(path) {
  if (!FLEETING_PATH.test(path)) throw new GitHubError(`Refusing to remove ${path}: only fleeting notes can be removed.`);
}

/** Delete a fleeting note (promotion, discard). Throws for any path outside fleeting/. */
export function deleteFleetingFile(path, sha, message) {
  assertFleetingPath(path);
  return deleteFile(path, sha, message);
}

/** Git blob sha for text content, matching what GitHub computes. */
export async function gitBlobSha(text) {
  const bytes = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One commit for the fleeting-note cleanup: writes ({ path, content }) and removals ({ path, remove: true }).
 * Every path must be inside fleeting/. Retries once if the branch moved underneath.
 */
export function commitCleanup(changes, message) {
  for (const c of changes) assertFleetingPath(c.path);
  return commitTree(changes, message);
}

/** One commit for several note writes ({ path, content }). Never removes anything. */
export function commitNotes(writes, message) {
  return commitTree(writes.map(({ path, content }) => ({ path, content })), message);
}

/** Writes ({ path, content }) and removals ({ path, remove: true }) in a single commit. */
function commitTree(changes, message) {
  return serial(async () => {
    const cfg = getConfig();
    const repo = repoPath(cfg);
    for (let attempt = 0; ; attempt++) {
      const ref = await request('GET', `${repo}/git/ref/heads/${encPath(cfg.branch)}`);
      const parent = ref.object.sha;
      const base = await request('GET', `${repo}/git/commits/${parent}`);
      const tree = await request('POST', `${repo}/git/trees`, {
        body: {
          base_tree: base.tree.sha,
          tree: changes.map((c) =>
            c.remove
              ? { path: c.path, mode: '100644', type: 'blob', sha: null }
              : { path: c.path, mode: '100644', type: 'blob', content: c.content }),
        },
      });
      const commit = await request('POST', `${repo}/git/commits`, { body: { message, tree: tree.sha, parents: [parent] } });
      try {
        await request('PATCH', `${repo}/git/refs/heads/${encPath(cfg.branch)}`, { body: { sha: commit.sha } });
        return;
      } catch (e) {
        if (attempt >= 1 || e.status !== 422) throw e;
      }
    }
  });
}

/** Date of the newest commit touching path whose message doesn't start with skipPrefix (null if unknown). */
export async function lastCommitDate(path, skipPrefix) {
  const cfg = getConfig();
  const commits = await request('GET', `${repoPath(cfg)}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(cfg.branch)}&per_page=10`);
  const hit = commits.find((c) => !c.commit.message.startsWith(skipPrefix));
  return hit ? Date.parse(hit.commit.committer?.date || hit.commit.author?.date) : null;
}

/** True when a create failed because the path already exists. */
export const isExistsError = (e) => e.status === 422 && /sha/i.test(e.detail);

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
