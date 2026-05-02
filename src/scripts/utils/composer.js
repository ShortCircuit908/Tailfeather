import { apiFetch } from './apiFetch.js';
import { getActiveBlog, userInfo } from './activeBlogs.js'
import * as Signing from './signing.js';
import * as BookStore from './bookStore.js';
import { fragmentDisplayObject } from './postDaemon.js';
import { updateData } from './database.js';

const MAX_POST_BODY_LENGTH = 100_000;
const MAX_ADDITION_BODY_LENGTH = 20_000;

export function parseTags(input) {
  if (!input) return [];
  const tags = input.split(/[,，、]/)
    .map(t => t.trim().toLowerCase().replace(/^#/, ''))
    .filter(t => t.length > 0 && t.length <= 100);
  return [...new Set(tags)].slice(0, 30);
}

export function generatePostId() {
  const timestamp = Date.now().toString(16);
  const random = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(random, b => b.toString(16).padStart(2, '0')).join('');

  // Custom prefix shouldn't break anything and might provide helpful insight
  // *slightly* worried this might mess up alphanumeric sorting of IndexedDB indices as it pertains to PostFinder
  // but tests seem to show it doesn't mess up the expected ordering
  return `tf-${timestamp}-${hex}`;
}

const _DATA_IMAGE_MARKER = '[Image blocked: Inline base64 disallowed]';

export function stripInlineDataImages(body) {
  if (!body) return body;
  return body
    .replace(
      /!\[([^\]]*)\]\(\s*data:image\/[^)]*\)/gi,
      _DATA_IMAGE_MARKER,
    )
    .replace(
      /<img\b[^>]*\bsrc\s*=\s*["']data:image\/[^"']*["'][^>]*>/gi,
      _DATA_IMAGE_MARKER,
    )
    // CSS url(data:...) inside inline style attributes. Covers the
    // "wrap the base64 in <div style='background-image: url(...)'>"
    // bypass sock + milja found on pinned posts. Match the url()
    // reference including any surrounding whitespace / quotes, and
    // replace with url(about:blank) so the rest of the style
    // declaration stays syntactically valid - the browser ignores
    // about:blank as a background-image with no warning.
    .replace(
      /url\(\s*(["']?)\s*data:[^)]*\1\s*\)/gi,
      'url(about:blank)',
    );
}

export async function registerTags(postId, tags) {
  if (!tags.length) return;
  apiFetch('/v1/posts/register/', { method: 'POST', body: { post_id: postId, tags } }).catch(e => console.error('[TF-Composer] Tag registration failed:', e));
}

export async function sendPostEvent(post, eventType = 'new_post', postingSlug) {
  if (!post?.post_id) {
    console.warn('[TF-Composer] sendPostEvent called without post_id, skipping relay');
    return;
  }

  apiFetch('/v1/posts/send/', {
    headers: {
      'X-As-Blog': postingSlug
      // The server SSE handler resolves the author from the relay header, not the post object
      // apiFetch defaults to the blog header the site expects: the active blog currently subscribed to the SSE feed
      // However, as part of allowing posting on non-active blogs, we need to override the header here so that the event matches the canonical author
    },
    method: 'POST', body: {
      post_id: post.post_id,
      author_name: post.author_name || '',
      // SSE wire field: carries the ROOT author username, so
      // relay events for staples/additions can attribute back
      // to the original author. For plain new_post this is
      // just the author's own username. See
      // normalizePostFromSSE for the client-side translation.
      author_username: post.author || '',
      author_avatar: post.author_avatar || '',
      body: post.body || '',
      signature: post.signature || '',
      // Forward root_signature on composites / additions /
      // staples so receivers can verify the root content
      // without waiting on the author's blob to cache. See
      // api/sse_schemas.py NewPostEvent for the race-bug
      // this closes.
      root_signature: post.root_signature || '',
      tags: post.tags || [],
      original_tags: post.original_tags || [],
      created_at: post.created_at || '',
      is_stapled: !!(post.is_stapled),
      root_post_id: post.root_post_id || '',
      additions: post.additions || [],
      chain_version: post.chain_version || 0,
      answered_ask: post.answered_ask || null,
      hide_from_search: !!(post.hide_from_search),
      event_type: eventType,
    }
  }).catch(e => console.warn('[TF-Composer]: SSE relay failed:', e));
}

export async function createPost(body, tagsInput, blog, options = {}) {
  if (!body.trim()) throw new Error('[TF-Composer] Post body cannot be empty');

  // Strip inline base64 images before any further processing so both
  // the length check and the signature see the canonical, de-bloated body
  body = stripInlineDataImages(body);

  if (body.length > MAX_POST_BODY_LENGTH) throw new Error(`[TF-Composer] Post body too long (${body.length.toLocaleString()} / ${MAX_POST_BODY_LENGTH.toLocaleString()} chars)`);

  const postId = options.postId || generatePostId();
  const tags = parseTags(tagsInput);
  const createdAt = options.createdAt || new Date().toISOString();

  // Unlike Noterook, we support posting from non-active blogs
  // Opposite priority here: fallback to getActiveBlog()
  if (!blog) {
    try {
      blog = getActiveBlog();
    } catch {
      console.error('[TF-Composer] No valid blog passed or findable for posting');
      return null;
    }
  }
  let authorUsername = blog.username;
  let authorDisplayName = blog.displayName || blog.display_name || blog.username;
  let authorAvatar = blog.avatarUrl || blog.avatar_url || '';

  // Build signable content
  // Fields must match what verifyBlob() reconstructs in blob-manager.js
  const signable = {
    post_id: postId,
    author: blog.username,
    body: body,
    tags: tags,
    created_at: createdAt,
  };

  // Sign with the ACTING BLOG's Ed25519 private key: legacy blogs
  // use the account-level key (null salt); sideblogs use the
  // per-blog key cached at login (post-ensureBlogKeys). If no
  // cache entry is present for the sideblog we fall back to the
  // legacy key and a warning is logged - signature will mismatch
  // on viewers but the post still reaches feeds; re-logging-in
  // populates the cache.
  let signature = '';
  const privateKey = Signing.loadKeyForBlog(blog) || Signing.loadPrivateKey();
  if (privateKey) {
    try {
      signature = await Signing.signPost(signable, privateKey);
    } catch (err) {
      console.error('[TF-Composer] Signing failed:', err);
    }
  }

  // Build full post object for IndexedDB. Single canonical `author`
  // field (root author username); no legacy `author_username` mirror.
  const post = {
    post_id: postId,
    author: authorUsername,
    author_id: blog.id,
    author_name: authorDisplayName,
    author_avatar: authorAvatar,
    body: body,
    media_urls: [],
    tags: tags,
    signature: signature,
    created_at: createdAt,
    is_mine: 1,        // IndexedDB index (1 = mine, 0 = stapled)
    is_stapled: 0,
    additions: [],
    chain_version: 0,
    chain_tip_id: null,
    is_pinned: 0,
    pinned_at: null,
    hide_from_search: options.hideFromSearch ? 1 : 0,
  };

  // Ask-answer attestation. Present only when this post was created
  // in response to an inbox ask via the answer-publicly flow. The
  // server-signed attestation lets renderers verify the "Answered an
  // ask from @alice" badge wasn't forged.
  if (options.answeredAsk) {
    post.answered_ask = options.answeredAsk;
  }

  // Store to IndexedDB (Single Gateway)
  await BookStore.openDatabase(userInfo.id).then(() => BookStore.storePost(post));

  // store to tailfeather stores (fragmented)
  const { root_fragment, chain_tip } = fragmentDisplayObject(post);
  await updateData({
    rootStore: root_fragment,
    tipStore: chain_tip
  });

  // Register tags with server (non-blocking) - skip if hidden from search
  if (!(options.hideFromSearch || options.editing)) {
    registerTags(postId, tags);
  }

  // Notify followers via SSE relay (non-blocking)
  if (!(options.hideFromSearch || options.editing)) {
    sendPostEvent(post, 'new_post', authorUsername);
  }

  console.debug(`[TF-Composer] Successfully ${options.editing ? 'edited' : 'created'} post ${post.post_id}`, post, blog);

  return post;
}

export async function editAddition(parent, blog, { additionBody, additionTagStr, additionId, postId, createdAt }) {
  const actingUsername = blog.username;
  const actingDisplay = blog.displayName || blog.display_name || blog.username;

  if (!additionBody || !additionBody.trim()) throw new Error('[TF-Composer] Addition body cannot be empty');

  // Strip inline base64 images before signing - same rationale as
  // createPost. Additions get stapled around with their parent so
  // letting one through bloats every downstream staple too.
  additionBody = stripInlineDataImages(additionBody);

  if (additionBody.length > MAX_ADDITION_BODY_LENGTH) throw new Error(`[TF-Composer] Addition too long (${additionBody.length.toLocaleString()} / ${MAX_ADDITION_BODY_LENGTH.toLocaleString()} chars)`);

  const additionTags = parseTags(additionTagStr);

  if (!parent) throw new Error('[TF-Composer] No parent provided');

  // Build signable content for the addition. Author + signing key
  // come from the ACTING BLOG so sideblog additions verify against
  // the sideblog's published pubkey.
  const signable = {
    addition_id: additionId,
    post_id: postId,
    author: actingUsername,
    body: additionBody.trim(),
    created_at: createdAt,
  };

  // Sign with the ACTING BLOG's Ed25519 private key: legacy blogs
  // use the account-level key (null salt); sideblogs use the
  // per-blog key cached at login (post-ensureBlogKeys). If no
  // cache entry is present for the sideblog we fall back to the
  // legacy key and a warning is logged - signature will mismatch
  // on viewers but the post still reaches feeds; re-logging-in
  // populates the cache.
  let signature = '';
  const privateKey = Signing.loadKeyForBlog(blog) || Signing.loadPrivateKey();
  if (privateKey) {
    try {
      signature = await Signing.signPost(signable, privateKey);
    } catch (err) {
      console.error('[TF-Composer] Addition signing failed:', err);
    }
  }

  const addition = {
    addition_id: additionId,
    post_id: postId, // chain tip ID - needed to verify the signature later
    author: actingUsername,
    author_name: actingDisplay,
    body: additionBody.trim(),
    signature,
    created_at: createdAt,
    tags: additionTags,
  };

  // Mutate the parent chain with our updated addition
  const allAdditions = parent.additions.map(parentAddition => parentAddition.post_id === postId ? addition : parentAddition);

  // Create the new composite post.
  //
  // NOTE: explicit field copy, NOT a `...parent` spread. That's
  // deliberate - a spread would forward stale / unrelated fields
  // (server-added metadata, old shadow fields) onto the composite.
  // But it means EVERY field the renderer expects has to appear
  // below. Past bugs: `answered_ask` missing here = ask card
  // disappears on self-add (fixed in dbbe10d). `original_tags`
  // missing = stapler tag-block launder (filter defense). If a new
  // field is added to post_envelope.js, add it here too.
  const newPost = {
    // New identity
    post_id: postId,
    // Lineage. root_post_id falls back to the parent's own id for
    // a non-stapled parent; this is what _verifyAttestation's
    // rootPostId match relies on for self-add-on-answer posts.
    root_post_id: parent.root_post_id || parent.post_id,
    // Original post content (the root's body/author travel with the chain)
    body: parent.body,
    author: parent.author,
    author_name: parent.author_name,
    author_avatar: parent.author_avatar || '',
    media_urls: parent.media_urls || [],
    // Root post's original signature (preserved across the chain so
    // verification can show the root's sig status on every composite).
    root_signature: parent.root_signature || parent.signature || '',
    // The frozen chain
    additions: allAdditions,
    chain_version: allAdditions.length,
    chain_tip_id: additionId,
    // This is the user's post now
    is_mine: 1,
    is_stapled: 1,
    stapled_at: createdAt,
    // Stapler identity (sideblog-aware) so the rehydration pass
    // re-registers this addition/staple under the right blog and
    // doesn't duplicate under every blog the user later switches to.
    stapled_by_blog: actingUsername,
    // Timestamps - preserve the original post's created_at so the
    // header shows when the content was first written, not when this
    // composite was made.  updated_at tracks the latest activity.
    created_at: parent.created_at || createdAt,
    updated_at: createdAt,
    // Tags: addition's own tags are visible; original_tags carries
    // the inherited (root + ancestor) tags so blacklist filtering
    // still fires on downstream renders. inheritedTagsFromParent
    // handles the composite-vs-root distinction and the `[]`
    // truthy gotcha that previously broke SSE-received roots.
    tags: additionTags,
    original_tags: parent.tags || [],
    // Fresh post - not pinned
    is_pinned: 0,
    pinned_at: null,
    // Respect the original author's visibility preference
    hide_from_search: parent.hide_from_search || 0,
    // Carry the parent's answered_ask attestation forward. The
    // attestation's answer_post_id names the PARENT's id, not this
    // composite's, so post-card's verifier accepts match against
    // either post_id or root_post_id. Without this propagation, a
    // self-add turns a verified answer into an unattributed chain
    // composite and the ask card disappears from the chain.
    answered_ask: parent.answered_ask || null,
    // Stamp the blob owner immediately so the first render (before
    // the blob round-trip) matches the post-round-trip render
    // context. Two consequences worth being explicit about:
    //
    //   Self-add to own answered post: `_blob_owner === post.author
    //   === attestation.recipient === user`. The ask attribution
    //   verifies and renders. This is the case Mel reported; the
    //   stamp makes the first render succeed instead of briefly
    //   showing stale context before the blob round-trips.
    //
    //   Cross-user add to someone else's answered post: e.g. Mel
    //   adds to Bob's answer. `_blob_owner = Mel`, but the
    //   attestation's recipient is Bob. `_verifyAttestation` uses
    //   `_blob_owner` as the trusted author and rejects the
    //   recipient match - the ask attribution does NOT render on
    //   Mel's composite. This is intentional: the attestation
    //   proves Bob answered the ask, not that Mel did, and surfacing
    //   Bob's ask attribution on a post stored in Mel's book would
    //   be misattribution. Server-side enforcement in api/posts.py
    //   (send_post strips answered_ask when sender != attestation
    //   recipient) is the matching defense on the SSE relay side.
    _blob_owner: actingUsername,
  };

  console.debug('[TF-Editor] Edited addition:', addition);

  const { addition_fragments, chain_tip } = fragmentDisplayObject(newPost);
  const additionFragment = addition_fragments.find(({ addition_id }) => addition_id === additionId);

  // store the edited composite post
  await BookStore.openDatabase(userInfo.id).then(() => BookStore.storePost(newPost));

  /* // store updated fragments in the book
  await BookStore.openDatabase(userInfo.id).then(() => {
    BookStore.storeAdditionFragment(additionFragment);
    BookStore.storeChainTip(chain_tip);
  }); */

  // store updated addition fragment to tailfeather store
  await updateData({
    additionStore: additionFragment,
    tipStore: chain_tip
  });

  // as this is an edit, we don't need to publish tags or poke the SSE relay

  return newPost;
}