import { noact } from './utils/noact.js';
import { debounce, getStorage } from './utils/jsTools.js';
import { MarkdownProcessor } from './utils/markdown.js';
import { formatTags } from './utils/elements.js';
import { blogSwitcher } from './utils/elements.js';
import * as Themes from './themes.js';

const uri = 'https://noterook.net';
const DEFAULT_CONTENT = '<!-- Write the post your heart desires! -->';
const DEFAULT_CSS = '/* You can write CSS here */';
const DEFAULT_PREVIEW = '<!-- Start writing a post to have it preview here! -->';
let MAX_LENGTH = 100000;

const handleTheme = theme => theme === 'abyss' ? ({ cssClass: 'abyss-theme', isDark: true }) : `ace/theme/${theme}`;
function updateTags({ target: { value } }) {
  document.getElementById('postPreview-tags').replaceChildren(...formatTags(value));
}

const transformStyle = cssText => (cssText.trim() && cssText !== DEFAULT_CSS) ? `\n<style>\n${cssText}\n</style>` : '';

// initEditor could technically handle its own option handling and skip having the main window
// pass feature options entirely, but that would require it to be async, so might as well not
const initEditor = ({ blog, userBlogs, defaultContent, defaultCss, defaultTags, theme, nrTheme, keybinding, trustedImageHosts, trustedMediaHosts, trustedStylesheetHosts }) => {
  console.debug('[EditorConfig] Ace loaded', blog, defaultContent, defaultCss, theme, keybinding);
  let activeBlog = blog;

  document.body.dataset.theme = nrTheme;
  document.body.dataset.trustedImageHosts = trustedImageHosts;
  document.body.dataset.trustedMediaHosts = trustedMediaHosts;
  document.body.dataset.trustedStylesheetHosts = trustedStylesheetHosts;

  // Initialise processor after propagating trusted hosts
  const localProcessor = new MarkdownProcessor();

  const submitButton = document.getElementById('composer-submit');

  const editor = ace.edit('composer', {
    mode: 'ace/mode/markdown',
    value: defaultContent || DEFAULT_CONTENT,
    wrap: 'free',
    theme: handleTheme(theme),
    keyboardHandler: `ace/keyboard/${keybinding}`
  });

  const cssEditor = ace.edit('css-composer', {
    mode: 'ace/mode/css',
    value: defaultCss || DEFAULT_CSS,
    wrap: 'free',
    theme: handleTheme(theme),
    keyboardHandler: `ace/keyboard/${keybinding}`
  });

  defaultTags ??= [];
  if (defaultTags.length) document.getElementById('composer-tags').value = defaultTags.join(', ');

  window.onresize = function () {
    editor.resize();
    cssEditor.resize();
  };

  getStorage(['preferences']).then(({ preferences }) => preferences.themes?.enabled ? Themes.main() : null);

  switch (qualifier) {
    case 'additionToPost':
      submitButton.textContent = 'Add';
      break;
    case 'answerToAsk':
      submitButton.textContent = 'Answer';
      break;
    case 'editingPost':
      submitButton.textContent = 'Edit';
      break;
    case 'asking':
      submitButton.textContent = 'Send';
      MAX_LENGTH = 10000; // 10kb limit for asks
      document.querySelector('.tf-composer-controls').classList.add('tf-composer-controls--ask');
      break;
  }

  function switchActive(newBlog) {
    activeBlog = newBlog;
    document.getElementById('tf-author-avatar').src = newBlog.avatar_url;
    document.getElementById('tf-author-name').textContent = newBlog.display_name;
  }

  if (userBlogs !== null) {
    const editorSwitcher = blogSwitcher(switchActive, userBlogs, activeBlog, 'Switch composing blog');
    document.getElementById('editor-header').append(editorSwitcher);
  }

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

  const getFullText = () => transformStyle(cssEditor.session.getValue()) + editor.session.getValue();

  const preview = document.getElementById('postPreview-body');
  const charCount = document.getElementById('composer-char-count');

  updateBody();

  submitButton.addEventListener('click', function () {
    const composerContent = getFullText();
    const hideFromSearch = document.getElementById('composer-hide-search').checked;
    const askAnon = document.getElementById('ask-anonymous').checked;
    const tagString = document.getElementById('composer-tags').value;
    window.parent.postMessage({ composerContent, hideFromSearch, askAnon, tagString, qualifier, qualifierId, blog: activeBlog }, uri);
  });

  const tagInput = document.getElementById('composer-tags');
  tagInput.addEventListener('input', updateTags);

  function updateBody() {
    requestAnimationFrame(() => {
      const fullText = getFullText()

      let content = preview.querySelector(':scope > .shadow-wrapper');
      if (content) preview.removeChild(content);

      content = noact({ className: 'shadow-wrapper' });
      preview.replaceChildren(content);
      localProcessor.renderToElement(fullText, content);

      charCount.textContent = `${fullText.length.toLocaleString()} / ${MAX_LENGTH.toLocaleString()}`;

      if (content.matches(':empty')) content.append(noact({
        tag: 'span',
        style: 'font-style: italic',
        children: 'Nothing to preview'
      }));
    });
  }

  editor.on('change', debounce(updateBody, 300));
  cssEditor.on('change', debounce(updateBody, 300));
};

const [_, qualifier, qualifierId] = /\?(.+)=(.+)$/.exec(location.search) || [];

if (qualifier === 'editingPost') window.parent.postMessage({ editingPostId: qualifierId }, uri);
else window.parent.postMessage('frameInit', uri);

const listener = event => {
  if (event.origin !== uri) return;
  if (typeof event.data === 'object' && 'blog' in event.data) initEditor(event.data);
};

window.addEventListener('message', listener);