import { inject } from './inject.js';

// this injection method is a bit janky, but it also solves the more proper wrappedJSObject method from needing to wait in a weird way
export const [{ user: userInfo }] = await inject('../scripts/inject/app.js');

const LOCAL_KEY_PREFIX = 'nr_active_blog:';
const SESSION_KEY = 'nr_active_blog_session';

let _blogs = [];        // all blogs the account owns; ordered by created_at
let _activeSlug = null; // the currently-active blog's username
let _initialised = false;

function _accountId() {
  return userInfo?.id ?? null;
}

function _localKey() {
  const id = _accountId();
  return id ? `${LOCAL_KEY_PREFIX}${id}` : null;
}

function _resolveDefault() {
  // Session override wins (set by URL param handling below).
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (s && _blogs.some(b => b.username === s)) return s;
  } catch { /* sessionStorage disabled */ }

  // localStorage per-account sticky.
  const lk = _localKey();
  if (lk) {
    try {
      const v = localStorage.getItem(lk);
      if (v && _blogs.some(b => b.username === v)) return v;
    } catch { /* disabled */ }
  }

  // Fall back to the oldest blog. Blogs come from /api/v1/blogs/mine/
  // sorted by created_at ASC, so _blogs[0] is oldest.
  return _blogs[0]?.username || null;
}

async function _fetchBlogs() {
  // Using apiFetch here would create a circular import that causes issues
  try {
    const resp = await fetch('/api/v1/blogs/mine/', {
      credentials: 'same-origin',
    });
    if (!resp.ok) return [];
    return await resp.json() || [];
  } catch {
    return [];
  }
}

export async function init() {
  if (_initialised) return _activeSlug;
  _initialised = true;

  if (!_accountId()) {
    // Anonymous viewer - no active blog concept, no-op.
    return null;
  }

  _blogs = await _fetchBlogs();
  _activeSlug = _resolveDefault();

  return _activeSlug;
}

/** Return the cached blog list (after init). */
export function listBlogs() {
  return _blogs.slice();
}

/** `const` replacement for getActiveSlug() that forces the module to be initialised when evaluated */
export const activeSlug = await init();

/** Return the Blog object for the active blog, or null. */
export function getActiveBlog() {
  if (!_activeSlug) return null;
  return _blogs.find(b => b.username === _activeSlug) || null;
}

/**
 * Set the active blog. Persists to localStorage (per-account) and
 * fires nr:active_blog_changed so listeners can rebind.
 */
export function setActiveSlug(slug) {
  if (!slug || slug === _activeSlug) return;
  if (!_blogs.some(b => b.username === slug)) return;
  const previous = _activeSlug;
  _activeSlug = slug;
  const lk = _localKey();
  if (lk) {
    try { localStorage.setItem(lk, slug); } catch { /* ignored */ }
  }
  try { sessionStorage.setItem(SESSION_KEY, slug); } catch { /* ignored */ }
  document.dispatchEvent(new CustomEvent('nr:active_blog_changed', {
    detail: { previous, current: slug, blog: getActiveBlog() },
  }));
}