/**
 * markdown.js - Markdown rendering with Shadow DOM isolation.
 *
 * Adapted from Carrion's MarkdownProcessor. Provides safe, rich
 * HTML rendering for user-authored content with style isolation
 * per post via closed Shadow DOM.
 *
 * Pipeline:
 * 1. Preprocess custom syntax (colors, collapsibles, underline, blockquote fix)
 * 2. marked.parse() - GFM markdown to HTML
 * 3. Postprocess collapsibles - replace placeholders with <details>
 * 4. DOMPurify.sanitize() - XSS prevention (config varies by context)
 * 5. Empty element cleanup
 * 6. Shadow DOM processing (shadow mode) - @import → <link>, host validation
 * 7. External link & image processing - privacy attrs, trust list enforcement
 *
 * Requires: marked.min.js, purify.min.js (loaded before this module)
 */

// =========================================================================
// Color map - WCAG-accessible, no black (invisible on dark themes)
// =========================================================================

const COLOR_MAP = {
  white: '#e0e0e0',
  red: '#ff4444',
  orange: '#ff8c00',
  yellow: '#ffd700',
  green: '#4caf50',
  blue: '#5b9bd5',
  purple: '#b388ff',
  pink: '#ff69b4',
  brown: '#a0522d',
  teal: '#00bcd4',
  gray: '#9e9e9e',
};

// =========================================================================
// MarkdownProcessor
// =========================================================================

export class MarkdownProcessor {
  constructor(options = {}) {
    this._trustedImageHosts = new Set();
    this._trustedStylesheetHosts = [];  // Array for wildcard matching
    this._trustedMediaHosts = new Set();
    this._configured = false;

    // Load trusted hosts from data attributes on <body>
    this._loadTrustedHosts();
  }

  static _hasCustomHTML(text) {
    if (!text) return false;
    return (
      /<style[\s>]/i.test(text) ||
      /<link[\s>]/i.test(text) ||
      /<div[\s>]/i.test(text) ||
      /<section[\s>]/i.test(text) ||
      /<article[\s>]/i.test(text) ||
      /<header[\s>]/i.test(text) ||
      /<footer[\s>]/i.test(text) ||
      /<marquee[\s>]/i.test(text) ||
      /class\s*=/i.test(text) ||
      /\{color:/i.test(text) ||
      /^:::/m.test(text) ||
      /@import/i.test(text)
    );
  }

  _loadTrustedHosts() {
    const body = document.body;
    if (!body) return;

    // Image hosts
    const imgHosts = body.dataset.trustedImageHosts;
    if (imgHosts) {
      try {
        const hosts = JSON.parse(imgHosts);
        hosts.forEach(h => this._trustedImageHosts.add(h.toLowerCase()));
      } catch (e) {
        console.warn('[TF-Markdown] Failed to parse trusted image hosts:', e);
      }
    }

    // Stylesheet hosts
    const cssHosts = body.dataset.trustedStylesheetHosts;
    if (cssHosts) {
      try {
        this._trustedStylesheetHosts = JSON.parse(cssHosts).map(h => h.toLowerCase());
      } catch (e) {
        console.warn('[TF-Markdown] Failed to parse trusted stylesheet hosts:', e);
      }
    }

    // Media hosts (audio/video sources)
    const mediaHosts = body.dataset.trustedMediaHosts;
    if (mediaHosts) {
      try {
        const hosts = JSON.parse(mediaHosts);
        hosts.forEach(h => this._trustedMediaHosts.add(h.toLowerCase()));
      } catch (e) {
        console.warn('[TF-Markdown] Failed to parse trusted media hosts:', e);
      }
    }
  }

  _ensureConfigured() {
    if (this._configured) return;
    if (typeof marked === 'undefined') throw new Error('marked.js not loaded');
    if (typeof DOMPurify === 'undefined') throw new Error('DOMPurify not loaded');

    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false,
    });
    this._configured = true;
  }

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Render markdown to sanitized HTML string (strict mode, no style tags).
   * Used for contexts where Shadow DOM isn't available (e.g., tooltips).
   */
  renderStrict(text) {
    this._ensureConfigured();
    return this._renderPipeline(text, false);
  }

  /**
   * Render markdown and mount into a closed Shadow DOM on the given element.
   * Allows <style> tags, custom CSS, @import, etc. — all scoped.
   *
   * @param {string} text - Raw markdown/HTML content
   * @param {HTMLElement} hostElement - Element to attach shadow root to
   * @returns {ShadowRoot}
   */
  renderToShadow(text, hostElement) {
    this._ensureConfigured();
    const html = this._renderPipeline(text, true);
    return this._mountShadow(html, hostElement);
  }

  renderToElement(text, hostElement) {
    if (MarkdownProcessor._hasCustomHTML(text)) {
      return this.renderToShadow(text, hostElement);
    } else {
      const e = this.renderStrict(text); // render inline - cheaper
      hostElement['innerHTML'] = e;
      return e;
    }
  }

  // =====================================================================
  // Pipeline
  // =====================================================================

  _renderPipeline(text, shadowMode) {
    if (!text) return '';

    // 1. Preprocess custom syntax
    let processed = this._preprocessCustomSyntax(text);

    // 1b. In shadow mode, hoist entire <style>...</style> blocks out
    //     of the pipeline and replace with marker <span>s. Both
    //     marked's HTML parser and DOMPurify have been observed to
    //     mangle CSS that contains tokens resembling HTML tags -
    //     e.g. `@property --scale { syntax: "<length> | <percentage>"; }`
    //     terminates the style block early, breaking every rule that
    //     follows (monorail's report). The markers pass through both
    //     stages untouched and get spliced back in before link/image
    //     processing, which still sees real <style> nodes and can
    //     extract @import as usual.
    //
    //     CODE-BLOCK GUARD: pre-hoist fenced code blocks to opaque
    //     placeholders BEFORE running the <style> regex so that a
    //     literal `<style>` shown inside a triple-backtick block
    //     stays inside the block instead of being silently lifted
    //     out (puppydog's report - "<style> tags inside a code
    //     block kinda doesn't work"). Without this, the regex eats
    //     the tag and marked sees only the placeholder span, which
    //     gets HTML-escaped inside the resulting <pre><code>; the
    //     stub-restore pass then can't match the escaped form, so
    //     the code block renders the placeholder text instead of
    //     the user's literal CSS.
    const styleStubs = [];
    const codeStubs = [];
    if (shadowMode) {
      // Fenced code blocks (``` or ~~~). Multiline DOTALL via
      // [\s\S] - the ^ anchors require the multiline flag.
      processed = processed.replace(
        /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm,
        (match) => {
          const i = codeStubs.length;
          codeStubs.push(match);
          return `\n\n!!CODE_FENCE_STUB_${i}!!\n\n`;
        },
      );
      // Inline code spans (single, double, etc. backtick runs).
      // Marked allows ``code with `` inside``; mirror that by
      // matching the opening run and the same-length closing run.
      processed = processed.replace(
        /(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\1(?!`)/g,
        (match) => {
          const i = codeStubs.length;
          codeStubs.push(match);
          return `!!CODE_FENCE_STUB_${i}!!`;
        },
      );
      processed = processed.replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        (match) => {
          const i = styleStubs.length;
          styleStubs.push(match);
          return `<span class="__nr-style-stub-${i}__"></span>`;
        },
      );
      // Restore the code blocks before marked sees the text so
      // marked still renders them as proper <pre><code> elements.
      // The <style> hoist has already taken its bite out of the
      // non-code regions by this point.
      if (codeStubs.length) {
        processed = processed.replace(
          /!!CODE_FENCE_STUB_(\d+)!!/g,
          (_m, i) => codeStubs[Number(i)] || '',
        );
      }
    }

    // 2. marked.parse()
    let html = marked.parse(processed);

    // 3. Postprocess collapsibles
    html = this._postprocessCollapsibles(html);

    // 4. DOMPurify
    html = this._sanitize(html, shadowMode);

    // 4b. Restore hoisted <style> blocks before link/image processing
    //     so _processLinksAndImages can still walk real <style> nodes
    //     and rewrite @import into <link>.
    if (styleStubs.length) {
      html = html.replace(
        /<span class="__nr-style-stub-(\d+)__"><\/span>/g,
        (_m, i) => styleStubs[Number(i)] || '',
      );
    }

    // 5. Empty element cleanup
    html = this._cleanupEmpty(html);

    // 6 & 7. Link/image processing
    html = this._processLinksAndImages(html, shadowMode);

    return html;
  }

  // =====================================================================
  // 1. Preprocess custom syntax
  // =====================================================================

  _preprocessCustomSyntax(text) {
    // Blockquote fix: >_< and >:) etc. shouldn't become blockquotes
    // Only > followed by a space (or at start of line) triggers blockquotes
    text = text.replace(/^(>)([^>\s])/gm, '\\$1$2');

    // Collapsible sections: :::Title / :::
    // Replace with placeholders so marked doesn't mangle them.
    // Placeholders use !!..!! instead of __..__ to avoid being
    // parsed as bold/underline by marked or the underline regex.
    let collapsibleId = 0;
    const collapsibles = new Map();

    text = text.replace(
      /^\s*:::\s*(.+)$/gm,
      (match, title) => {
        const id = `!!COLLAPSIBLE_OPEN_${collapsibleId++}!!`;
        collapsibles.set(id, title.trim());
        return id;
      }
    );

    text = text.replace(
      /^\s*:::$/gm,
      () => '!!COLLAPSIBLE_CLOSE!!'
    );

    // Store collapsible map for postprocessing
    this._collapsibles = collapsibles;

    // Underline: __text__ → <u>text</u>
    // Must intercept before marked treats it as <strong>
    text = text.replace(/__([^_]+?)__/g, '<u>$1</u>');

    // @user mention → markdown link to /book/<username>/. Matches
    // only when the @ is at a word boundary (start of line or
    // preceded by whitespace / open bracket), so email addresses
    // like foo@bar.com don't trigger. Pattern mirrors Django's
    // username validator (accounts/forms.py clean_username). The
    // URL uses the lowercased form since usernames are
    // canonicalized lowercase on signup; the display keeps the
    // literal casing the user typed. Escape with \@ to opt out.
    //
    // Before running the regex we stub out CSS <style> blocks and
    // code spans/blocks and restore them after. Without this, CSS
    // at-rules like @keyframes, @media, @supports all get eaten
    // by the mention pattern and rewritten as markdown links,
    // which then parse as broken CSS and nuke every animation in
    // the post body (fuckingterrify's report: "in-post CSS
    // animations no longer work at all"). Also has the side
    // benefit that literal `@name` inside a code span stays as
    // text instead of getting auto-linkified.
    const mentionStubs = [];
    let mentionText = text.replace(
      /<style[\s\S]*?<\/style>|```[\s\S]*?```|`[^`\n]+`/gi,
      (match) => {
        const i = mentionStubs.length;
        mentionStubs.push(match);
        return `\u0000MENTIONSTUB${i}\u0000`;
      },
    );
    mentionText = mentionText.replace(
      /(^|[\s(\[{])@([A-Za-z0-9][A-Za-z0-9_-]*)\b/g,
      (_m, prefix, username) =>
        `${prefix}[@${username}](/book/${username.toLowerCase()}/)`,
    );
    text = mentionText.replace(
      /\u0000MENTIONSTUB(\d+)\u0000/g,
      (_m, i) => mentionStubs[Number(i)],
    );

    // Color syntax: {color:red}text{/color}
    text = text.replace(
      /\{color:(\w+)\}([\s\S]*?)\{\/color\}/gi,
      (match, colorName, content) => {
        const hex = COLOR_MAP[colorName.toLowerCase()];
        if (!hex) return match; // Unknown color, leave as-is
        return `<span style="color: ${hex}">${content}</span>`;
      }
    );

    // Media embeds: [[audio:url]] / [[video:url]] → <audio/video src="url">
    //
    // Lightweight inline marker. The preprocess only transforms
    // the token into the HTML element - it doesn't validate the
    // URL. Everything downstream handles that:
    //   - DOMPurify allowlists audio/video/source/track in
    //     _sanitize (no autoplay attribute in the allowlist).
    //   - _processLinksAndImages post-sanitize pass validates
    //     src against trusted_media_hosts, strips autoplay /
    //     autostart / data-autoplay, and forces controls.
    //
    // An untrusted or malformed URL survives the preprocess but
    // renders as a visible "[Audio blocked]" placeholder so the
    // author notices in preview. javascript:/data: schemes are
    // blocked by the URL pattern below and by the sanitizer.
    //
    // URL pattern deliberately requires http(s):// and forbids
    // `]` and whitespace inside the URL, so a bracket typo
    // doesn't silently swallow the rest of the line. Users who
    // need raw HTML <audio> / <video> tags can still write them -
    // this is a convenience marker on top of that.
    text = text.replace(
      /\[\[(audio|video):(https?:\/\/[^\]\s]+)\]\]/gi,
      (_m, kind, url) => {
        const tag = kind.toLowerCase();
        const safe = url.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return `<${tag} src="${safe}"></${tag}>`;
      },
    );

    return text;
  }

  // =====================================================================
  // 3. Postprocess collapsibles
  // =====================================================================

  _postprocessCollapsibles(html) {
    if (!this._collapsibles || this._collapsibles.size === 0) return html;

    for (const [placeholder, title] of this._collapsibles) {
      // The placeholder may be wrapped in <p> tags by marked
      const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(
        `(?:<p>)?${escapedPlaceholder}(?:</p>)?`,
        'g'
      );
      html = html.replace(regex, `<details><summary>${DOMPurify.sanitize(title)}</summary>`);
    }

    html = html.replace(
      /(?:<p>)?!!COLLAPSIBLE_CLOSE!!(?:<\/p>)?/g,
      '</details>'
    );

    this._collapsibles = null;
    return html;
  }

  // =====================================================================
  // 4. DOMPurify sanitization
  // =====================================================================

  _sanitize(html, shadowMode) {
    // NOTE: audio/video attribute allowlist deliberately EXCLUDES
    // autoplay, autostart, loop-with-muted combinations, and any
    // non-standard "start muted" attrs. Browsers still permit
    // muted autoplay without user interaction, so letting autoplay
    // through (even paired with muted) would let a post body
    // launch background playback the moment a viewer scrolls
    // into it. If a legitimate use case for auto-starting media
    // shows up later, a gated opt-in viewer preference is the
    // right place for it, not a post-body attribute. See
    // _postprocessMedia below for the defence-in-depth strip.
    const MEDIA_ATTRS = [
      'src', 'controls', 'preload', 'loop', 'muted',
      'poster',          // video - poster frame before playback
      'playsinline',     // inline mobile playback
      'crossorigin',     // cross-origin resource handling
      'kind', 'srclang', 'label', 'default',  // <track>
    ];
    if (shadowMode) {
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'u', 's', 'del', 'code', 'pre',
          'a', 'img', 'ul', 'ol', 'li', 'blockquote',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
          'sup', 'sub', 'mark',
          'details', 'summary', 'figure', 'figcaption',
          'div', 'span',
          'marquee', 'big', 'small', 'abbr',
          // Media - host-validated in _postprocessMedia
          'audio', 'video', 'source', 'track',
          // Shadow mode extras
          'style', 'link',
          'header', 'nav', 'section', 'article', 'footer', 'aside',
        ],
        ALLOWED_ATTR: [
          'href', 'src', 'alt', 'title', 'class', 'id',
          'target', 'rel', 'width', 'height',
          'loading', 'referrerpolicy',
          'colspan', 'rowspan', 'align', 'valign',
          'style', 'open', 'name',
          // <ol> start attribute. Without this, lists that
          // begin at a non-1 number (e.g. "5. Something")
          // render as "1. Something" because DOMPurify strips
          // the start attribute and the browser defaults to 1.
          'start',
          // <link> attrs
          'crossorigin', 'type',
          // marquee
          'direction', 'behavior', 'scrollamount', 'scrolldelay', 'loop',
          // <audio> / <video> / <source> / <track>
          ...MEDIA_ATTRS,
        ],
        ALLOW_DATA_ATTR: false,
        FORCE_BODY: true,
      });
    }

    // Strict mode - no style tags, no class/id
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'del', 'code', 'pre',
        'a', 'img', 'ul', 'ol', 'li', 'blockquote',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
        'sup', 'sub', 'mark',
        'details', 'summary',
        'div', 'span',
        // Media - host-validated in _postprocessMedia
        'audio', 'video', 'source', 'track',
      ],
      ALLOWED_ATTR: [
        'href', 'target', 'rel', 'src', 'alt', 'title',
        'style', 'open',
        // <ol start="N"> - preserves non-1 list starting numbers.
        'start',
        // <audio> / <video> / <source> / <track>
        ...MEDIA_ATTRS,
      ],
      ALLOW_DATA_ATTR: false,
    });
  }

  // =====================================================================
  // 5. Empty element cleanup
  // =====================================================================

  _cleanupEmpty(html) {
    // Remove empty <p>, <em>, <strong>, <u> left by unclosed formatting
    return html
      .replace(/<(p|em|strong|u|s|del)>\s*<\/\1>/gi, '')
      .replace(/<(p|em|strong|u|s|del)>\s*<\/\1>/gi, ''); // Two passes
  }

  // =====================================================================
  // 6 & 7. Link and image processing
  // =====================================================================

  _processLinksAndImages(html, shadowMode) {
    // Use a temporary DOM to process elements
    const temp = document.createElement('div');
    temp['innerHTML'] = html;

    // Process images - validate trust, add privacy attrs. Inline
    // data: URIs (base64 images) are rejected as of the "books got
    // huge" incident: embedding PNGs directly bloats the blob, and
    // once a base64-laden post gets stapled around the network it
    // bloats every stapler's book too. Render as a placeholder so
    // the visible UX matches the underlying constraint.
    const images = temp.querySelectorAll('img');
    for (const img of images) {
      const src = img.getAttribute('src') || '';
      const isData = src.startsWith('data:');
      if (!isData && this._isImageTrusted(src)) {
        img.setAttribute('referrerpolicy', 'no-referrer');
        img.setAttribute('loading', 'lazy');
      } else if (src) {
        const warning = document.createElement('span');
        warning.className = 'untrusted-image-warning';
        warning.textContent = isData
          ? '[Image blocked: inline base64 not allowed]'
          : '[Image blocked: untrusted host]';
        warning.title = isData
          ? 'Inline base64 images bloat the blob and propagate through staples. Host the image on a trusted image host and link to it instead.'
          : src;
        img.replaceWith(warning);
      }
    }

    // Process <audio> and <video> elements.
    //
    // Three guarantees this loop enforces:
    //   1. autoplay is stripped UNCONDITIONALLY - even if
    //      DOMPurify ever regresses its allowlist, and even if a
    //      user tries to smuggle `autoplay=""` / `data-autoplay`
    //      / muted-paired autoplay. No embed auto-starts on load.
    //   2. All src attributes (element-level and nested <source>s)
    //      must resolve to a host in the trusted-media allowlist.
    //      An element with zero valid sources is replaced with a
    //      visible placeholder so the author notices in preview.
    //   3. controls is forced on so users can stop / scrub. A
    //      controls-less embed that can't autoplay is useless,
    //      and a controls-less one that somehow DID autoplay
    //      would be hostile.
    //
    // The image path (above) rejects inline data: URIs for blob-
    // bloat reasons; the same argument applies to audio/video
    // doubly, so data: srcs are rejected here too.
    const mediaElements = temp.querySelectorAll('audio, video');
    for (const media of mediaElements) {
      // Kill autoplay + every near-synonym browsers respect.
      // muted-autoplay is still autoplay; strip both rather
      // than relying on the vendor tag to keep them paired.
      media.removeAttribute('autoplay');
      media.removeAttribute('autostart');  // non-standard but some engines honour
      media.removeAttribute('data-autoplay');

      // Force controls. No controls + no autoplay = no playback,
      // which is the wrong failure mode for the viewer.
      media.setAttribute('controls', '');

      // Validate element-level src (when provided as attribute
      // rather than a <source> child).
      const directSrc = media.getAttribute('src') || '';
      let hasValidSource = false;
      if (directSrc) {
        if (directSrc.startsWith('data:') || !this._isMediaTrusted(directSrc)) {
          media.removeAttribute('src');
        } else {
          hasValidSource = true;
        }
      }

      // Validate <source> children. Removing the bad ones
      // rather than the whole <audio>/<video> keeps the
      // fallback "your browser doesn't support X" text intact.
      const sources = media.querySelectorAll('source');
      for (const s of sources) {
        const ssrc = s.getAttribute('src') || '';
        if (!ssrc || ssrc.startsWith('data:') || !this._isMediaTrusted(ssrc)) {
          s.remove();
        } else {
          hasValidSource = true;
        }
      }

      if (!hasValidSource) {
        const warning = document.createElement('span');
        warning.className = 'untrusted-media-warning';
        warning.textContent = media.tagName === 'VIDEO'
          ? '[Video blocked: untrusted host]'
          : '[Audio blocked: untrusted host]';
        warning.title = directSrc || 'no valid <source> found';
        media.replaceWith(warning);
      }
    }

    // Process links - add rel attrs for external links
    const links = temp.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('http://') || href.startsWith('https://')) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }

    // Scrub CSS url(data:...) from inline style attributes and
    // <style> tag contents. The <img src="data:..."> path is
    // covered above; this catches the background-image and
    // similar bypasses where the base64 payload lives in a
    // stylesheet rather than an element's src. sock + milja
    // reported pinned posts using <div style="background-image:
    // url('data:...')"> to smuggle inline images through the
    // write-time strip.
    const CSS_DATA_URL = /url\(\s*(["']?)\s*data:[^)]*\1\s*\)/gi;
    const styled = temp.querySelectorAll('[style]');
    for (const el of styled) {
      const s = el.getAttribute('style') || '';
      if (CSS_DATA_URL.test(s)) {
        el.setAttribute('style', s.replace(CSS_DATA_URL, 'url(about:blank)'));
        CSS_DATA_URL.lastIndex = 0;
      }
    }
    const styleTags = temp.querySelectorAll('style');
    for (const st of styleTags) {
      const txt = st.textContent || '';
      if (CSS_DATA_URL.test(txt)) {
        st.textContent = txt.replace(CSS_DATA_URL, 'url(about:blank)');
        CSS_DATA_URL.lastIndex = 0;
      }
    }

    // Linkify bare URLs in text nodes. Covers the "bio link isn't
    // clickable" case (Dolly Molly) where marked's GFM autolink
    // missed a plain-text https://... URL. Skips text already
    // inside <a>, <code>, <pre>, and <style> so we don't double-
    // wrap existing links or munge code/CSS content.
    //
    // The regex matches greedily to the first whitespace/angle
    // bracket; trailing sentence punctuation is peeled off after
    // the match so "...molly/." and "example.com," drop the
    // trailing character, BUT query-string '?' and real URL
    // punctuation inside the URL (e.g. https://site/path?a=1&b=2)
    // are preserved. Balanced parens get the GFM treatment: a
    // single ')' at the end is peeled only if there's no matching
    // '(' in the URL body.
    const URL_RE = /(https?:\/\/[^\s<>"]+)/g;
    const TRAILING_PUNCT = /[.,;:!?'"\]}]$/;
    const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let tn;
    while ((tn = walker.nextNode())) {
      if (tn.parentElement?.closest('a, code, pre, style')) continue;
      if (URL_RE.test(tn.textContent)) textNodes.push(tn);
      URL_RE.lastIndex = 0;
    }
    for (const node of textNodes) {
      const text = node.textContent;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      URL_RE.lastIndex = 0;
      let m;
      while ((m = URL_RE.exec(text)) !== null) {
        let url = m[0];
        let trailing = '';
        // Peel trailing punctuation that's almost certainly
        // sentence-structure rather than URL-structure.
        while (url.length > 8 && TRAILING_PUNCT.test(url)) {
          trailing = url.slice(-1) + trailing;
          url = url.slice(0, -1);
        }
        // Unbalanced close-paren: peel only when the URL has
        // no matching '(' (so "(see https://ex.com)" → link
        // "https://ex.com", but "https://ex.com/path(v1)"
        // keeps the ')').
        while (url.length > 8 && url.endsWith(')')
          && (url.match(/\(/g)?.length || 0) < (url.match(/\)/g)?.length || 0)) {
          trailing = ')' + trailing;
          url = url.slice(0, -1);
        }

        if (m.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
        }
        const a = document.createElement('a');
        a.href = url;
        a.textContent = url;
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer nofollow');
        frag.appendChild(a);
        if (trailing) frag.appendChild(document.createTextNode(trailing));
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      node.replaceWith(frag);
    }

    // Process <link> tags (shadow mode only) - validate stylesheet hosts
    if (shadowMode) {
      const linkTags = temp.querySelectorAll('link');
      for (const link of linkTags) {
        const rel = (link.getAttribute('rel') || '').toLowerCase();
        const href = link.getAttribute('href') || '';

        if (rel !== 'stylesheet') {
          link.remove();
          continue;
        }

        if (!this._isStylesheetTrusted(href)) {
          link.remove();
          continue;
        }

        // Add crossorigin for CORS
        link.setAttribute('crossorigin', 'anonymous');
      }
    }

    return temp.innerHTML;
  }

  // =====================================================================
  // Trust validation
  // =====================================================================

  _isImageTrusted(src) {
    if (!src) return false;
    // data: URIs used to be allowed here as a "nice little goof"
    // for inline PNGs. They aren't, anymore: base64 payloads in
    // post bodies bloat the blob and then get duplicated through
    // every staple, so a casually-restapled post full of inline
    // images blew up several users' books past the blob cap.
    // Callers that still want data: images (avatar validation)
    // have their own permissive check.
    if (src.startsWith('data:')) return false;
    if (src.startsWith('/')) return true; // Same-origin

    try {
      const url = new URL(src);
      const hostname = url.hostname.toLowerCase();

      // Exact match or subdomain match
      for (const trusted of this._trustedImageHosts) {
        if (hostname === trusted || hostname.endsWith('.' + trusted)) {
          return true;
        }
      }
    } catch (e) {
      // Invalid URL
    }

    return false;
  }

  /**
   * True iff ``src`` resolves to a host in the trusted-media allowlist
   * (or is same-origin). Mirrors _isImageTrusted; kept separate so the
   * two allowlists can diverge (a host safe to hotlink an image from
   * isn't automatically safe to stream media from - different bandwidth
   * and TOS posture on most CDNs).
   *
   * data: URIs are rejected for the same blob-bloat reason images
   * reject them. A single base64 audio clip in a post body can easily
   * clear a few MB, and the blob replicates via staples.
   */
  _isMediaTrusted(src) {
    if (!src) return false;
    if (src.startsWith('data:')) return false;
    if (src.startsWith('/')) return true; // Same-origin

    try {
      const url = new URL(src);
      // Only http(s) sources. ftp:// / file:// / javascript:
      // slip past the hostname check otherwise.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
      }
      const hostname = url.hostname.toLowerCase();
      for (const trusted of this._trustedMediaHosts) {
        if (hostname === trusted || hostname.endsWith('.' + trusted)) {
          return true;
        }
      }
    } catch (e) {
      // Invalid URL
    }

    return false;
  }

  _isStylesheetTrusted(href) {
    if (!href) return false;

    try {
      const url = new URL(href);
      const hostname = url.hostname.toLowerCase();

      for (const trusted of this._trustedStylesheetHosts) {
        if (trusted.startsWith('*.')) {
          // Wildcard: *.github.io matches user.github.io
          const suffix = trusted.slice(1); // .github.io
          if (hostname.endsWith(suffix) && hostname !== suffix.slice(1)) {
            return true;
          }
        } else {
          if (hostname === trusted || hostname.endsWith('.' + trusted)) {
            return true;
          }
        }
      }
    } catch (e) {
      // Invalid URL
    }

    return false;
  }

  // =====================================================================
  // Shadow DOM mounting
  // =====================================================================

  _mountShadow(html, hostElement) {
    const shadow = hostElement.attachShadow({ mode: 'closed' });

    // Inject base styles
    const baseStyle = document.createElement('style');
    baseStyle.textContent = BASE_SHADOW_STYLES;
    shadow.appendChild(baseStyle);

    // Inject bio-level styles so custom classes from the user's bio <style>
    // cascade into post closed-shadow roots (which otherwise block inheritance)
    if (window.__bioStyles) {
      const bioStyle = document.createElement('style');
      bioStyle.textContent = window.__bioStyles;
      shadow.appendChild(bioStyle);
    }

    // Create content container
    const content = document.createElement('div');
    content.className = 'shadow-content';
    content['innerHTML'] = html;
    shadow.appendChild(content);

    // When images inside the closed shadow finish loading, dispatch a
    // synthetic event on the host so collapse logic can re-measure height.
    const imgs = content.querySelectorAll('img');
    for (const img of imgs) {
      if (!img.complete) {
        img.addEventListener('load', function () {
          hostElement.dispatchEvent(new Event('shadow-image-load'));
        }, { once: true });
      }
    }

    // Handle link clicks inside closed shadow DOM
    shadow.addEventListener('click', function (e) {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      e.preventDefault();

      if (href.startsWith('/') || href.startsWith(window.location.origin)) {
        // Internal link - navigate normally
        window.location.href = href;
      } else {
        // External link - open in new tab
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    });

    return shadow;
  }
}

// =========================================================================
// Base styles injected into every Shadow DOM
// =========================================================================

const BASE_SHADOW_STYLES = `
/* Reset - shadow DOM inherits nothing by default */
:host {
    display: block;
    overflow: hidden;
    overflow-wrap: break-word;
    word-break: break-word;
    contain: paint;
}

.shadow-content {
    line-height: 1.7;
    font-size: 0.95rem;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: inherit;
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
    margin: 1em 0 0.5em;
    line-height: 1.3;
}
h1 { font-size: 1.6em; }
h2 { font-size: 1.4em; }
h3 { font-size: 1.2em; }
h4 { font-size: 1.1em; }
h5, h6 { font-size: 1em; }

p { margin: 0 0 0.75em; }
p:last-child { margin-bottom: 0; }

/* Links */
a {
    color: #5b9bd5;
    text-decoration: none;
}
a:hover { text-decoration: underline; }

/* Code */
code {
    background: rgba(255, 255, 255, 0.06);
    padding: 0.15em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
    font-family: 'Fira Code', 'Consolas', monospace;
}
pre {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 0.75em 1em;
    overflow-x: auto;
    margin: 0.75em 0;
}
pre code {
    background: none;
    padding: 0;
    font-size: 0.85em;
}

/* Blockquotes */
blockquote {
    border-left: 3px solid rgba(255, 255, 255, 0.15);
    margin: 0.5em 0;
    padding: 0.25em 0 0.25em 1em;
    color: rgba(255, 255, 255, 0.7);
}

/* Lists */
ul, ol {
    margin: 0.5em 0;
    padding-left: 1.5em;
}
li { margin-bottom: 0.25em; }

/* Tables */
table {
    border-collapse: collapse;
    margin: 0.75em 0;
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    display: block;
}
th, td {
    border: 1px solid rgba(255, 255, 255, 0.12);
    padding: 0.4em 0.75em;
    text-align: left;
}
th {
    background: rgba(255, 255, 255, 0.05);
    font-weight: 600;
}

/* Horizontal rule */
hr {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    margin: 1em 0;
}

/* Images - default to 50% to prevent giant images dominating posts.
   Authors can override with inline styles or <style> in shadow mode. */
img {
    max-width: 50%;
    max-height: 50%;
    height: auto;
    border-radius: 4px;
}

/* Collapsibles */
details {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 0.5em 0.75em;
    margin: 0.5em 0;
}
summary {
    cursor: pointer;
    font-weight: 500;
    padding: 0.25em 0;
    user-select: none;
}
details[open] summary {
    margin-bottom: 0.5em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 0.5em;
}

/* Marquee */
marquee {
    display: block;
    margin: 0.25em 0;
}

/* Misc */
mark {
    background: rgba(255, 215, 0, 0.3);
    color: inherit;
    padding: 0.1em 0.2em;
    border-radius: 2px;
}
u { text-decoration: underline; }
abbr { text-decoration: underline dotted; cursor: help; }

/* Untrusted image warning */
.untrusted-image-warning {
    display: inline-block;
    background: rgba(255, 68, 68, 0.15);
    border: 1px solid rgba(255, 68, 68, 0.3);
    border-radius: 4px;
    padding: 0.25em 0.5em;
    font-size: 0.8em;
    color: #ff4444;
}
`;

// =========================================================================
// Singleton
// =========================================================================

let _instance = null;

/**
 * Get the global MarkdownProcessor instance.
 * @returns {MarkdownProcessor}
 */
export function getProcessor() {
  if (!_instance) {
    _instance = new MarkdownProcessor();
  }
  return _instance;
}
