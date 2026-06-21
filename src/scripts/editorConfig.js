import { noact } from './utils/noact.js';
import { debounce, getStorage } from './utils/jsTools.js';
import { MarkdownProcessor } from './utils/markdown.js';
import { formatTags } from './utils/elements.js';
import { blogSwitcher } from './utils/elements.js';
import * as Themes from './themes.js';

/* == editor elements == */

let previewWindow;
const cancelBtn = document.getElementById('composer-cancel');
const draftsBtn = document.getElementById('composer-drafts-btn');
const saveDraftBtn = document.getElementById('composer-save-draft');
const queueBtn = document.getElementById('composer-queue-btn');
const submitBtn = document.getElementById('composer-submit');
const charCount = document.getElementById('composer-char-count');
const draftsPanel = document.getElementById('composer-drafts-panel');
const tagInput = document.getElementById('composer-tags');
const scheduleToggle = document.getElementById('composer-schedule-toggle');
const scheduleAt = document.getElementById('composer-schedule-at');
const scheduleHint = document.getElementById('composer-schedule-hint');

/* == static globals == */
const uri = 'https://noterook.net';
const DEFAULT_CONTENT = '<!-- Write the post your heart desires! -->';
const DEFAULT_CSS = '/* You can write CSS here */';
const DEFAULT_PREVIEW = '<!-- Start writing a post to have it preview here! -->';
const [_, qualifier, qualifierId] = /\?(.+)=(.+)$/.exec(location.search) || [];
const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

/* == mutable globals == */

let INITIALISED = false;
let MAX_LENGTH = 100000;
let activeBlog = null;
let editor = null;
let cssEditor = null;
let localProcessor = null;
let defaultContent = DEFAULT_CONTENT;
let defaultCss = DEFAULT_CSS;
let preappliedTags = [];

function resolveTheme(theme) {
  return theme === 'abyss' ? ({ cssClass: 'abyss-theme', isDark: true }) : `ace/theme/${theme}`;
}

function updateTags({ target: { value } }) {
  document.getElementById('postPreview-tags').replaceChildren(...formatTags(value));
}

function transformStyle(cssText) {
  return (cssText.trim() && cssText !== DEFAULT_CSS) ? `<style>\n${cssText}\n</style>\n` : '';
}

function readDefaultTags() {
  if (activeBlog && Array.isArray(activeBlog.default_tags) && activeBlog.default_tags.length) {
    return activeBlog.default_tags.slice();
  } else return [];
}

/**
 * Prepend the active blog's default tags to whatever the user typed.
 * Default tags are always applied (even if the user cleared the input).
 * Shared by the Post and Queue submit paths so the two can't drift - a
 * dropped copy used to mean queued posts silently lost their default tags.
 */
function mergeDefaultTags(inputTags) {
  if (!readDefaultTags().length) return inputTags;
  return readDefaultTags().join(', ') + (inputTags.trim() ? ', ' + inputTags : '');
}

function renderDraftsPanel(drafts) {
  if (!draftsPanel) return;
  if (draftsBtn) draftsBtn.textContent = drafts.length ? `Drafts (${drafts.length})` : 'Drafts';
  if (!drafts.length) {
    draftsPanel.replaceChildren(noact({
      className: 'composer-drafts-empty',
      children: 'No saved drafts on this device.'
    }));
    return;
  }
  draftsPanel.replaceChildren(...noact(drafts.map(d => {
    const preview = (d.body || '').replace(/\s+/g, ' ').slice(0, 80);
    const when = new Date(d.saved_at);
    return {
      className: 'composer-draft-row',
      dataset: { draftId: d.id },
      children: [
        {
          tag: 'span',
          className: 'composer-draft-preview',
          title: d.body || '',
          children: preview || '(empty)'
        },
        {
          tag: 'span',
          className: 'composer-draft-meta',
          children: isNaN(when.getTime()) ? '' : when.toLocaleString()
        },
        {
          tag: 'button',
          type: 'button',
          className: 'btn-secondary composer-btn',
          dataset: { draftAction: 'load' },
          children: 'Load'
        },
        {
          tag: 'button',
          type: 'button',
          className: 'btn-secondary composer-btn',
          dataset: { draftAction: 'delete' },
          children: 'Delete'
        }
      ]
    };
  })));
};

function switchActive(newBlog) {
  activeBlog = newBlog;
  document.getElementById('tf-author-avatar').src = newBlog.avatar_url;
  document.getElementById('tf-author-name').textContent = newBlog.display_name;
}

function getFullText() {
  return transformStyle(cssEditor?.session?.getValue() || '') + (editor?.session?.getValue() || '');
}

function updateBody() {
  requestAnimationFrame(() => {
    const fullText = getFullText();

    let content = previewWindow.querySelector(':scope > .shadow-wrapper');
    if (content) previewWindow.removeChild(content);

    content = noact({ className: 'shadow-wrapper' });
    previewWindow.replaceChildren(content);
    localProcessor.renderToElement(fullText, content);

    charCount.textContent = `${fullText.length.toLocaleString()} / ${MAX_LENGTH.toLocaleString()}`;

    if (content.matches(':empty')) content.append(noact({
      tag: 'span',
      style: 'font-style: italic',
      children: 'Nothing to preview'
    }));
  });
}

function loadDraft(draft) {
  if (!draft) return;

  // Load: pull the draft into the composer and remove it from the
  // store. If the user doesn't post, "Save draft" puts it back -
  // this avoids a duplicate the moment they DO post.

  const styleContents = [];
  const body = draft.body.replace(styleRegex, (_, s) => {
    styleContents.push(s);
    return '';
  });

  editor.session.setValue(body);
  if (styleContents.length) cssEditor.session.setValue(styleContents.join('\n'));
  tagInput.value = draft.tags || (readDefaultTags().length ? readDefaultTags().join(', ') : '');

  window.parent.postMessage({ deleteDraft: draft.id }, uri);
  draftsPanel.style.display = 'none';
}

function submitPost() {
  const composerContent = getFullText();
  const hideFromSearch = document.getElementById('composer-hide-search').checked;
  const askAnon = document.getElementById('ask-anonymous').checked;
  const tagString = mergeDefaultTags(document.getElementById('composer-tags').value);
  // Resolve a schedule time if the user picked one, and bail early
  // on a past/empty value so we don't silently post-now.
  let scheduledAt = '';
  if (scheduleToggle?.checked) {
    const when = scheduleAt?.value ? new Date(scheduleAt.value) : null;
    if (!when || isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      alert('Pick a schedule time in the future.');
      scheduleAt?.focus();
      return;
    }
    scheduledAt = when.toISOString();
  }
  window.parent.postMessage({ composerContent, hideFromSearch, scheduledAt, askAnon, tagString, qualifier, qualifierId, blog: activeBlog, queueing: this.id === 'composer-queue-btn' }, uri);
}

function pad(n) {
  return String(n).padStart(2, '0');
}
function localDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function updateScheduleHint() {
  if (scheduleToggle?.checked && scheduleAt?.value) {
    const when = new Date(scheduleAt.value);
    scheduleHint.textContent = isNaN(when.getTime()) ? '' : `Publishes ${when.toLocaleString()}`;
    scheduleHint.style.display = '';
  } else {
    scheduleHint.style.display = 'none';
  }
};

// initEditor could technically handle its own option handling and skip having the main window
// pass feature options entirely, but that would require it to be async, so might as well not
function initEditor({ blog, userBlogs, defaultContent: _content, defaultCss: _css, preappliedTags: _tags, theme, nrTheme, keybinding, trustedImageHosts, trustedMediaHosts, trustedStylesheetHosts }) {
  if (INITIALISED) return;
  INITIALISED = true;

  console.debug('[EditorConfig] Ace loaded', blog, defaultContent, defaultCss, theme, keybinding);

  // set defaults
  defaultContent = _content || DEFAULT_CONTENT;
  defaultCss = _css || DEFAULT_CSS;
  preappliedTags = _tags || [];

  // set composing blog
  activeBlog = blog;

  // load body data
  document.body.dataset.theme = nrTheme;
  document.body.dataset.trustedImageHosts = trustedImageHosts;
  document.body.dataset.trustedMediaHosts = trustedMediaHosts;
  document.body.dataset.trustedStylesheetHosts = trustedStylesheetHosts;

  // Initialise processor after propagating trusted hosts
  localProcessor = new MarkdownProcessor();

  // initialise ace windows
  editor = ace.edit('composer', {
    mode: 'ace/mode/markdown',
    value: defaultContent,
    wrap: 'free',
    theme: resolveTheme(theme),
    keyboardHandler: `ace/keyboard/${keybinding}`
  });

  const cssEditor = ace.edit('css-composer', {
    mode: 'ace/mode/css',
    value: defaultCss,
    wrap: 'free',
    theme: resolveTheme(theme),
    keyboardHandler: `ace/keyboard/${keybinding}`
  });

  editor.on('change', debounce(updateBody, 300));
  cssEditor.on('change', debounce(updateBody, 300));

  window.addEventListener('resize', function () {
    editor.resize();
    cssEditor.resize();
  });

  // initialise tags
  const initTags = [...readDefaultTags(), ...preappliedTags];
  if (initTags.length) document.getElementById('composer-tags').value = initTags.join(', ');

  // initialise composer theme
  getStorage(['preferences']).then(({ preferences }) => preferences.themes?.enabled ? Themes.main() : null);

  // handle use case variations
  switch (qualifier) {
    case 'additionToPost':
      submitBtn.textContent = 'Add';
      MAX_LENGTH = 20000; // 20kb limit for additions
      break;
    case 'answerToAsk':
      submitBtn.textContent = 'Answer';
      break;
    case 'editingPost':
      submitBtn.textContent = 'Edit';
      break;
    case 'editingAddition':
      submitBtn.textContent = 'Edit';
      MAX_LENGTH = 20000;
      break;
    case 'asking':
      submitBtn.textContent = 'Send';
      MAX_LENGTH = 10000; // 10kb limit for asks
      document.querySelector('.tf-composer-controls').classList.add('tf-composer-controls--ask');
      break;
    default:
      document.querySelector('.tf-composer-controls').classList.add('tf-composer-controls--composing');
  }

  // create blog switcher
  if (userBlogs !== null) {
    const editorSwitcher = blogSwitcher(switchActive, userBlogs, activeBlog, 'Switch composing blog');
    document.getElementById('editor-header').append(editorSwitcher);
  }

  // create preview
  document.getElementById('tf-preview').append(noact({
    className: 'post-card',
    children: [
      {
        className: 'post-author',
        children: [
          {
            id: 'tf-author-avatar',
            className: 'post-author-avatar',
            src: activeBlog.avatar_url
          },
          {
            id: 'tf-author-name',
            tag: 'span',
            className: 'post-author-name',
            children: activeBlog.display_name
          },
          {
            tag: 'span',
            className: 'post-timestamp',
            children: 'just now'
          }
        ]
      },
      {
        id: 'postPreview-body',
        className: 'post-body',
        children: {
          tag: 'code',
          children: DEFAULT_PREVIEW
        }
      },
      {
        id: 'postPreview-tags',
        className: 'post-tags',
      }
    ]
  }));

  previewWindow = document.getElementById('postPreview-body');

  // render initial preview
  updateBody();

  // initialise tag input
  tagInput.addEventListener('input', updateTags);

  // initialise composer buttons
  submitBtn.addEventListener('click', submitPost);
  queueBtn.addEventListener('click', submitPost);
  draftsBtn.addEventListener('click', function () {
    if (draftsPanel.style.display !== 'none') { draftsPanel.style.display = 'none'; return; }
    window.parent.postMessage('listDrafts', uri);
    draftsPanel.style.display = '';
  });
  saveDraftBtn.addEventListener('click', function () {
    const body = getFullText();
    if (!body) return;
    try {
      window.parent.postMessage({
        saveDraft: { body, tags: tagInput.value || '', blogSlug: activeBlog?.username || '' }
      }, uri);
      editor.session.setValue(defaultContent);
      cssEditor.session.setValue(defaultCss);
      tagInput.value = readDefaultTags().length ? readDefaultTags().join(', ') : '';
      charCount.textContent = `${getFullText().length.toLocaleString()} / ${MAX_LENGTH.toLocaleString()}`;
    } catch (err) {
      alert('[EditorConfig] Could not save draft: ' + err.message);
    }
  });
  draftsPanel.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-draft-action]');
    if (!btn) return;

    const id = btn.closest('[data-draft-id]')?.dataset.draftId;
    if (!id) return;

    if (btn.dataset.draftAction === 'delete') {
      window.parent.postMessage({ deleteDraft: id }, uri);
      return;
    }

    window.parent.postMessage({ getDraft: id }, uri);
  });

  // Scheduling controls. The datetime input only shows when "Schedule"
  // is ticked; defaults to +1h, min = now. A future created_at makes the
  // post scheduled (gated until then) - see createPost.
  scheduleToggle.addEventListener('change', function () {
    if (scheduleToggle.checked) {
      scheduleAt.min = localDateTime(Date.now());
      if (!scheduleAt.value) scheduleAt.value = localDateTime(Date.now() + 60 * 60 * 1000);
      scheduleAt.style.display = '';
      submitBtn.textContent = 'Schedule';
    } else {
      scheduleAt.style.display = 'none';
      submitBtn.textContent = 'Post';
    }
    updateScheduleHint();
  });
  scheduleAt.addEventListener('change', updateScheduleHint);

  window.parent.postMessage('listDrafts', uri); // seed the count on init
};

function listener(event) {
  if (event.origin !== uri) return;
  if (typeof event.data === 'object' && 'blog' in event.data) initEditor(event.data);
  else if (typeof event.data === 'object' && 'drafts' in event.data) renderDraftsPanel(event.data.drafts);
  else if (typeof event.data === 'object' && 'loadDraft' in event.data) loadDraft(event.data.loadDraft);
};

window.addEventListener('message', listener);

// send frame init message to parent window
if (['editingPost', 'editingAddition'].includes(qualifier)) window.parent.postMessage({ editingPostId: qualifierId }, uri);
else window.parent.postMessage('frameInit', uri);