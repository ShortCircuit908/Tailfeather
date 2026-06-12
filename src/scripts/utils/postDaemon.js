/* PostDaemon: All-in-one post wrangling, caching, and reassembly module */

import { clearData, getData, updateData } from './database.js';
//import { fetchBlobCached } from './blobManager.js';
import { defined, unique, uniqueDefined, uniqueFn } from './jsTools.js';
import { extractUserFromHref, cacheAvatar } from './users.js';
import { parseTags } from './elements.js';
import { userInfo } from './activeBlogs.js';
import NR from './noterook.js';

const BookStore = await NR.BookStore();
const BlobManager = await NR.BlobManager();

const FETCH_CONCURRENCY = 12;

/**
 * Run `worker` over `items` with at most `limit` concurrent in flight.
 * Unlike `Promise.all` over fixed batches, a fast worker picks up the
 * next item immediately instead of waiting for slow peers in its batch
 * to finish - matters a lot when one user's blob fetch takes ~4s and
 * nineteen others finish in 200ms.
 */
async function _pMap(items, worker) {
  console.log(worker)
  const results = new Array(items.length);
  let idx = 0;
  async function runner() {
    while (idx < items.length) {
      results[idx] = await worker(items[idx], idx);
      ++idx;
    }
  }
  const runners = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, items.length) },
    runner,
  );
  await Promise.all(runners);
  return results;
}

/**
 * Extracts unique shallow user data from fragments, prioritising data from newer fragments
 * @param {Map<string, object>} roots - deduplicated root fragments
 * @param {Map<string, object>} chainTips - deduplicated chain tip fragments
 * @returns {object[]} unique array of shallow user data
 */
function _usersFromFragments(roots, chainTips) {
  const shallowUsersFiltered = new Map();

  chainTips.forEach(({ root_post_id, updated_at }) => {
    const root = roots.get(root_post_id);
    if (!root) return;

    const { author, author_name, author_avatar } = root;

    // Manual deduplication to prioritise newer data, using the newest chain tip associated with a given root and thus the newest fragment associated with a user
    if (!shallowUsersFiltered.has(author) || Date.parse(updated_at) > Date.parse(shallowUsersFiltered.get(author).updated_at)) shallowUsersFiltered.set(author, {
      username: author,
      display_name: author_name,
      avatar_url: author_avatar,
      updated_at
    });
  });

  return [...shallowUsersFiltered.values()];
}

/**
 * unwraps fragments from blob if no error is present
 * @param {object} blob - user blob
 * @returns {object?} fragments, null if blob data contains an error 
 */
function _unwrapBlob(blob, username) {
  if (!blob || blob.error) {
    console.warn(`[Solidifer] Failed to obtain blob for user ${username}`, blob);
    return;
  }

  const { root_fragments, addition_fragments, chain_tips } = blob.envelope;
  return { root_fragments, addition_fragments, chain_tips };
}

/**
 * fetches (and caches) blobs from an array of users
 * @param {string[]} usernames 
 * @returns {object} amalgamated blob data
 */
async function _fetchUserBlobs(usernames) {
  const userBlobs = await _pMap(usernames, BlobManager.fetchBlobCached);
  const blobFragments = defined(userBlobs.map((blob, i) => _unwrapBlob(blob, usernames[i])));
  const rootFragments = new Map(), additionFragments = new Map(), chainTips = new Map();

  blobFragments.forEach(({ root_fragments, addition_fragments, chain_tips }) => {
    root_fragments?.forEach(root => rootFragments.set(root.post_id, root));
    addition_fragments?.forEach(addition => additionFragments.set(addition.addition_id, addition));
    chain_tips?.forEach(tip => chainTips.set(tip.post_id, tip));
  });

  const errs = [];

  updateData({
    rootStore: [...rootFragments.values()].filter(root => {
      if (root.post_id && root.created_at && root.author && root.tags) return true;
      else {
        errs.push(root);
        return false
      }
    }),
    additionStore: [...additionFragments.values()].filter(addition => {
      if (addition.addition_id && addition.post_id && addition.created_at && addition.author && addition.tags) return true;
      else {
        errs.push(addition);
        return false
      }
    }),
    tipStore: [...chainTips.values()].filter(tip => {
      if (tip.post_id && tip._blob_owner && tip.root_post_id) return true;
      else {
        errs.push(tip);
        return false
      }
    }),
    userStore: _usersFromFragments(rootFragments, chainTips).filter(user => {
      if (user.username && user.display_name) return true;
      else {
        errs.push(user);
        return false;
      }
    })
  });

  if (errs.length) console.warn(`[PostDaemon] Accumulated malformed data:`, errs);

  return {
    rootFragments: [...rootFragments.values()],
    additionFragments: [...additionFragments.values()],
    chainTips: [...chainTips.values()]
  };
}

// =========================================================================
// Necromancy suite
// =========================================================================
// Utilities for extracting data from the DOM
// The scope of this is much more limited than what we can scrape from
// react-based apps, but Noterook makes up for it in other ways

const _thrallCache = new WeakMap();

function _unwrapTags(tagsElement) {
  return tagsElement ? Array.from(tagsElement.querySelectorAll('.post-tag')).map(tag => tag.textContent.slice(1)) : ([]);
}
/**
 * Extracts shallow, non-IDB-cached data for simple syncronous applications where the full post data isn't needed.
 * @param {HTMLElement} article - Post article element
 * @returns {object} Shallow post data
 */
export function getPostShallow(article) {
  if (!_thrallCache.has(article)) {
    const { postId, author, stickerKey, originalAuthor, chainVersion, chainTip, tags: tagStr } = article.dataset;
    const tags = parseTags(tagStr);
    let chain = [];

    if (chainVersion) {
      const chainContent = article.querySelectorAll('.chain-addition');
      chainContent.forEach(chainAddition => {
        chain.push({
          additionId: chainAddition.dataset.additionId,
          stickerKey: chainAddition.dataset.stickerKey,
          author: chainAddition.dataset.author,
          tags: _unwrapTags(chainAddition.querySelector('.chain-addition-tags'))
        });
      });
    }

    const is_transparent_staple = ![originalAuthor, ...chain.map(({ author }) => author)].includes(author);
    _thrallCache.set(article, {
      post_id: postId,
      author,
      root_author: originalAuthor || author,
      chain_tip: chainTip,
      sticker_key: stickerKey,
      chain,
      tags,
      is_transparent_staple
    });
  }

  return _thrallCache.get(article);
}

/**
 * Serves the dual purpose of automatically populating `_thrallCache` on mutuation and caching data from user blobs based on what the user is viewing.
 * @param {HTMLElement[]} articles - Post article elements
 */
export async function cacheFromDOM(articles) {
  const shallowData = articles.map(getPostShallow);
  const usernames = uniqueDefined(shallowData.flatMap(({ author, originalAuthor, chain }) => [author, originalAuthor, ...chain.map(({ author: chainAuthor }) => chainAuthor)]));
  _fetchUserBlobs(usernames);
}

// =========================================================================
// SSE incubator
// =========================================================================
// Watches the SSE stream for new post data that can be assimilated without additional network calls
// Basically using it in the same way as Noterook does, but we're just caching it for future use

function _sanitizeTimestamp(ts) {
  if (!ts) return new Date(0).toISOString();
  const d = new Date(ts);
  if (isNaN(d.getTime())) return new Date(0).toISOString();
  return ts;
}

function _normalize(detail) {
  // Body may be empty for oversized posts (server strips >50KB).
  // We still buffer the post so it appears in the feed - the card
  // will show metadata (author, tags, timestamp) and the body
  // renders when the blob is fetched.
  if (detail?.post_id && !detail.body) {
    console.debug(`[SSEIncubator] Post ${detail.post_id} from ${detail.author} has no body (oversized or relay-only)`);
    return null;
  }
  if (!detail?.post_id || !detail.author) return null;

  const rootAuthor = detail.author_username || detail.author;
  const publisher = detail.author;

  return {
    post_id: detail.post_id,
    // Canonical root author - NOT the publisher.
    author: rootAuthor,
    author_name: detail.author_name || rootAuthor,
    author_avatar: detail.author_avatar || '',
    body: detail.body || '',
    signature: detail.signature || '',
    // Preserve the root author's signature on composites so
    // `_verifyPostAndAdditions` has something to check against
    // without falling back to the per-blob cached sig state
    // (which is indeterminate at SSE render time and produces
    // intermittent "addition treats OP as unsigned" renderings).
    root_signature: detail.root_signature || '',
    tags: detail.tags || [],
    original_tags: detail.original_tags || [],
    created_at: _sanitizeTimestamp(detail.created_at || new Date().toISOString()),
    updated_at: _sanitizeTimestamp(detail.created_at || new Date().toISOString()),
    is_stapled: detail.is_stapled || false,
    root_post_id: detail.root_post_id || '',
    additions: detail.additions || [],
    chain_version: detail.chain_version || 0,
    chain_tip_id: detail.chain_tip_id || null,
    media_urls: detail.media_urls || [],
    is_pinned: false,
    hide_from_search: false,
    // Ask-answer attestation: forward opaquely; post-card renders
    // the verified badge/card only on signature success.
    answered_ask: detail.answered_ask || null,
    // Publisher = blob owner of the Book this post lands in.
    _blob_owner: publisher,
    is_mine: false,
  };
}

// Pick up new posts from SSE feed to reduce missing posts from blobs that have yet to update with new posts
function _cachePostsFromSSE({ detail }) {
  if (!detail) return;

  const post = _normalize(detail);
  const { root_fragment, addition_fragments, chain_tip } = fragmentDisplayObject(post);

  if (post) updateData({
    userStore: {
      username: post.author,
      avatar_url: post.author_avatar,
      display_name: post.author_name,
      updated_at: post.updated_at
    },
    rootStore: root_fragment,
    additionStore: addition_fragments,
    tipStore: chain_tip
  });
}

document.addEventListener('nr:new_post', _cachePostsFromSSE);
document.addEventListener('nr:new_addition', _cachePostsFromSSE);

// =========================================================================
// Full post fetching utilities
// =========================================================================
// The meat & potatoes of postFunction operations.
// Our first assumption is to check in the IDB cache: finding every post in a batched transaction is the optimal scenario, and the most likely for well-populated zones.
// If we're missing indices, there's still a chance that they're published in the user's blob, but we just didn't catch it live.
// We then attempt to obtain missing indices from the relevant blobs, batched in a performant way as to not slow down the whole process with the slowest entries.
// Of course, sometimes a post just won't be available over network: either we missed the SSE event and are too early for the blob to have been published,
// or the book is unavailable (in which case the post is unlikely to appear in a feed regardless).
// This seems to be a relatively uncommon happenstance though; hell, we probably lose more gm9 postFunction calls to 429s than Tailfeather does to missing indices.

/**
 * root_fragments: "one row per signed root post"
 * 
 * raven interpretation: this is just a post
 * 
 * {
 *  kind: "root"
 *  post_id: {string} id of target opaque root
 *  author: {string}
 *  author_name: {string} display name
 *  author_avatar: {string}
 *  body: {string} markdown
 *  tags: {string[]}
 *  media_urls: {string[]} seemingly unused? nothing sets this to anything other than an empty array
 *  created_at: {string}
 *  signature: {string}
 *  hide_from_search: {bool} is book only
 *  answered_ask: {object}
 * }
 */

/**
 * addition_fragments:
 * "one row per signed addition; the
 * by_post_id index supports the hot
 * "every addition on this root" path
 * for chain rendering and verification"
 * 
 * raven interpretation: what vulture said 👍
 * 
 * {
 *  kind: "addition"
 *  addition_id: {string} prefixed with `add-`
 *  post_id: {string} id of target opaque addition
 *  author: {string}
 *  author_name: {string} display name
 *  author_avatar: {string ("")} seemingly always an empty string
 *  body: "string"
 *  tags: {string[]}
 *  media_urls: {string[]} seemingly unused? nothing sets this to anything other than an empty array
 *  created_at: {string}
 *  signature: {string}
 * }
 */

/**
 * chain_tips:
 * "the composite-as-display-artifact
 * pointer ({post_id, chain[], stapler_tags,
 * stapled_at, _blob_owner, ...}). Keyed
 * on the COMPOSITE post_id (which equals
 * the root post_id for plain originals)."
 * 
 * raven interpretation: display object helper that associates additions with root posts
 * 
 * {
 *  kind: "chain_tip"
 *  post_id: {string} id of target item: may be a transparent staple, opaque staple, or opaque root
 *  chain: {string[]} array of addition ids
 *  root_post_id: {string} id of chain root, same as post_id if the tip is also the root
 *  stapler_tags: {string[]?} array of tags if the display object is a staple, null otherwise
 *  stapled_at: {string?} iso timestamp if the display object is a staple, null otherwise
 *  stapled_by_blog: {string?} username if the display object is a(n opaque?) staple, null otherwise
 *  _blob_owner: {string} author of display object
 *  is_pinned: {bool}
 *  pinned_at: {string?} timestamp if pinned, null otherwise
 *  updated_at: {string}
 *  chain_version: {number} no. of additions
 *  chain_tip_id: {string} addition id of last opaque addition if relevant
 *  original_tags: {string[]}
 *  root_signature: {string}
 * }
 */

/**
 * composite display object
 * this is the ideally-structured object we want to pass to postFunctions, containing 
 * all info for a given display object in one place; root, additions, and all .
 * 
 * {
  * author: {string} display object author
  * additions: {object[]} {
  *  addition_id: {string} prefixed with `add-`
  *  author: {string}
  *  author_avatar: {string ("")} seemingly always an empty string
  *  author_name: {string}
  *  body: {string}
  *  created_at: {string}
  *  media_urls: {string[]}
  *  post_id {string} conventional id
  *  signature: {string}
  *  tags: {string[]}
  * }
  * answered_ask: {object}
  * root_author: {string}
  * root_author_avatar: {string}
  * root_author_name: {string}
  * body: {string}
  * chain_tip_id: {string?} addition (pfx: add-) id of most recent addition if applicable, null otherwise
  * chain_version: {number} no. of additions
  * created_at: {string} timestamp of root post
  * hide_from_search: {bool}
  * is_pinned: {bool}
  * is_stapled: {bool}
  * media_urls: {string[]} unused? points to the root or last addition
  * original_tags: {string[]}
  * pinned_at: {string?}
  * post_id: {string} id of display object
  * root_post_id: {string}
  * root_signature: {string}
  * signature: {string} signature of root or most recent addition
  * stapled_at: {string?} timestamp of staple if applicable
  * stapled_by_blog: {string?} stapler if present
  * tags: {string[]}
  * updated_at: {string} timestamp of root or most recent addition
 * }
 */

/**
 * creates a composite display object for postFunctions using all relevant fragments
 * @param {object} rootFragment 
 * @param {object[]} additionFragments 
 * @param {object} chainTip 
 * @returns {object} composite display object
 */
function _createDisplayObject(rootFragment, additionFragments, chainTip) {
  additionFragments = additionFragments.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const opaqueParent = additionFragments.slice(-1)[0];

  if (additionFragments.some(({ post_id }) => typeof post_id === 'undefined')) console.warn('[PostDaemon] Malformed addition fragment', rootFragment, additionFragments, chainTip);

  return {
    author: chainTip._blob_owner,
    root_author: rootFragment.author_name,
    root_author_name: rootFragment.author,
    root_author_avatar: rootFragment.author_avatar,
    additions: additionFragments.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    answered_ask: rootFragment.answered_ask,
    body: rootFragment.body,
    chain_tip_id: chainTip.chain_tip_id,
    chain_version: chainTip.chain_version,
    created_at: rootFragment.created_at,
    hide_from_search: rootFragment.hide_from_search,
    is_pinned: chainTip.is_pinned,
    is_stapled: rootFragment.postId !== chainTip.root_post_id,
    media_urls: opaqueParent?.media_urls || rootFragment.media_urls,
    original_tags: chainTip.original_tags,
    pinned_at: chainTip.pinned_at,
    post_id: chainTip.post_id,
    root_post_id: chainTip.root_post_id,
    signature: opaqueParent?.signature || rootFragment.signature,
    stapled_at: chainTip.stapled_at,
    stapled_by_blog: chainTip.stapled_by_blog,
    tags: opaqueParent?.tags || rootFragment.tags,
    updated_at: chainTip.updated_at
  };
}

/**
 * accrues all possible posts from arrays of fragments
 * @param {object[]} rootFragments 
 * @param {object[]} additionFragments 
 * @param {object[]} chainTips 
 * @returns {object[]} display objects
 */
function _mapChainTipsToDisplayObjectEntries(rootFragments, additionFragments, chainTips) {
  const posts = new Map();

  chainTips.forEach(chainTip => {
    const rootFragment = rootFragments.find(({ post_id }) => post_id === chainTip.root_post_id);
    if (!rootFragment) {
      console.warn('[PostDaemon] Failed to obtain root fragment for chain tip', chainTip);
      return;
    }

    let chainAdditionFragments = [];

    if (chainTip.chain.length) {
      chainAdditionFragments = defined(additionFragments.filter(({ addition_id }) => chainTip.chain.includes(addition_id)));
      if (chainTip.chain.length !== chainAdditionFragments.length) {
        console.warn('[PostDaemon] Failed to obtain all additions for chain tip', chainTip);
        return;
      }
    }

    posts.set(chainTip.post_id, _createDisplayObject(rootFragment, chainAdditionFragments, chainTip));
  });

  return posts.entries();
}

function _isMisformed(fragment) {
  return (typeof fragment?.post_id === 'undefined') || (fragment?.kind === 'chain_tip' && fragment?.chain.length && fragment?.post_id === fragment?.root_post_id);
}

/**
 * Retrieves and reassembles IDB-cached posts
 * @param {string[]} postIds - Posts to be retrieved
 * @returns {object?[]} posts - Key-value pairs for associated entries, null if not cached
 */
export async function getIndexedPosts(postIds) {
  const rootIds = [], additionIds = [], postMap = new Map(), misformed = { tipStore: [], additionStore: [] };
  postIds.forEach(id => postMap.set(id, null));

  let { tipStore: chainTips } = await getData({ tipStore: postIds });

  chainTips = uniqueDefined(chainTips).filter(tip => {
    if (_isMisformed(tip)) {
      misformed.tipStore.push(tip.post_id);
      return false;
    } else return true;
  })

  chainTips.forEach(({ root_post_id, chain }) => {
    rootIds.push(root_post_id);
    additionIds.push(...chain);
  });

  const { rootStore: rootFragments, additionStore: additionFragments } = await getData({ rootStore: unique(rootIds), additionStore: unique(additionIds) });

  _mapChainTipsToDisplayObjectEntries(rootFragments, additionFragments.map(addition => {
    if (_isMisformed(addition)) misformed.additionStore.push(addition.addition_id);
    return addition
  }), chainTips).forEach(([post_id, post]) => postMap.set(post_id, post));
  clearData(misformed);
  return Object.fromEntries(postMap.entries());
}

/**
 * Performant asyncronous full-post fetching
 * Primarily intended to be a batched operation, but we support single indices for convenience like all of the FDB `indexedResource` helpers.
 * @param {HTMLElement[]|HTMLElement} articles - Post article elements
 * @returns {object[]|object} posts - Fetched post objects
 */
export async function getPosts(articles) {
  const isArray = Array.isArray(articles); // Like `indexedResource` helpers, we save the initial key state before arrayifying it
  if (!isArray) articles = [articles];

  const dataMap = new Map();
  const shallowData = articles.map(getPostShallow);
  const indexedPosts = await getIndexedPosts(shallowData.map(({ post_id }) => post_id));

  if (!shallowData.every(({ post_id }) => indexedPosts[post_id])) {
    const missedUsers = new Set();

    shallowData.forEach(({ author, post_id }) => {
      if (!indexedPosts[post_id]) {
        missedUsers.add(author);
      }
    });

    const { rootFragments, additionFragments, chainTips } = await _fetchUserBlobs([...missedUsers.values()]);
    _mapChainTipsToDisplayObjectEntries(rootFragments, additionFragments, chainTips).forEach(post => indexedPosts[post.post_id] = post);
  }

  return isArray ? shallowData.map(({ post_id }) => indexedPosts[post_id]) : Object.values(indexedPosts)[0];
}

/**
 * wrapper for `BookStore.getPost()`
 * resolves a post from the user's own book with high confidence
 * @param {string} postId 
 * @returns {object} composite post display object
 */
export async function getOwnPost(postId) {
  return BookStore.openDatabase(userInfo.id).then(() => {
    return BookStore.getPost(postId)
  });
}

// =========================================================================
// Post fragmentation utilities
// =========================================================================
// tools for fragmenting display objects

/**
 * fragments a display object into its component fragments
 * @param {object} post - well-structure display object 
 * @returns {object} key-value pairs of fragments
 */
export function fragmentDisplayObject(post) {
  const root_fragment = {
    kind: "root",
    post_id: post.root_post_id || post.post_id,
    author: post.author || post.author_username,
    author_name: post.author_name || post.author || post.author_username,
    author_avatar: post.author_avatar,
    body: post.body,
    tags: post.is_stapled ? post.tags : post.original_tags,
    media_urls: post.media_urls || [],
    created_at: post.created_at,
    signature: post.root_signature,
    hide_from_search: post.hide_from_search || 0,
    answered_ask: post.answered_ask || null
  };
  const addition_fragments = post.additions?.map(addition => ({
    kind: "addition",
    addition_id: addition.addition_id,
    post_id: addition.post_id,
    author: addition.author || addition.author_username,
    author_name: addition.author_name || addition.author || addition.author_username,
    author_avatar: addition.author_avatar,
    body: addition.body,
    tags: addition.tags,
    media_urls: addition.media_urls,
    created_at: addition.created_at,
    signature: addition.signature
  })) || [];
  const chain_tip = {
    kind: "chain_tip",
    post_id: post.post_id,
    chain: post.additions?.map(({ addition_id }) => addition_id) || [],
    root_post_id: post.root_post_id || post.post_id,
    stapler_tags: post.is_stapled ? post.tags : null,
    stapled_at: post.is_stapled ? post.updated_at : null,
    stapled_by_blog: post.stapled_by,
    _blob_owner: post.stapled_by || post.author,
    is_pinned: post.is_pinned,
    pinned_at: post.pinned_at || null,
    updated_at: post.updated_at || post.created_at,
    chain_version: post.chain_version,
    chain_tip_id: post.chain_tip_id,
    original_tags: post.original_tags,
    root_signature: post.root_signature
  };

  return { root_fragment, addition_fragments, chain_tip };
}