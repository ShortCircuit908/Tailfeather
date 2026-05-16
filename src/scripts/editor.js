import { svgIcon } from './utils/icons.js';
import { noact } from './utils/noact.js';
import { getActiveBlog, listBlogs } from './utils/activeBlogs.js';
import { createPost, editCompositeRoot, editAddition } from './utils/composer.js';
import { getOptions } from './utils/jsTools.js';
import { mutationManager, postFunction } from './utils/mutation.js';
import { getOwnPost, getPosts } from './utils/postDaemon.js';

// activeBlog imports are resolved here and not editorConfig.js because the iframe context is separate from the main window, so they would fail in the config module

const customClass = 'tailfeather-editor';
const customAttribute = 'data-tf-editor';
const chainAdditionFormSelector = '.inline-addition-form';
const answerFormSelector = '.ask-answer-form';
const askFormSelector = '.ask-modal-form';
const uri = browser.runtime.getURL('');

let defaultContent, defaultCss, theme, keybinding, nrTheme, trustedImageHosts, trustedMediaHosts, trustedStylesheetHosts;

const editMap = new Map();

const listener = event => {
  if (event.origin + '/' !== uri) return;
  if (event.data === 'frameInit') {
    event.source.postMessage({
      blog: getActiveBlog(),
      userBlogs: listBlogs(),
      defaultContent,
      defaultCss,
      theme,
      nrTheme,
      keybinding,
      trustedImageHosts,
      trustedMediaHosts,
      trustedStylesheetHosts
    }, uri);
  } else if (typeof event.data === 'object' && 'editingPostId' in event.data) {
    const postData = editMap.get(event.data.editingPostId);
    event.source.postMessage({
      blog: postData.authorBlog,
      userBlogs: null,
      defaultContent: postData.body,
      defaultCss,
      defaultTags: postData.tags,
      theme,
      nrTheme,
      keybinding,
      trustedImageHosts,
      trustedMediaHosts,
      trustedStylesheetHosts
    }, uri);
  } else if (typeof event.data === 'object' && 'composerContent' in event.data) {
    const { composerContent, hideFromSearch, askAnon, tagString, qualifier, qualifierId, blog } = event.data;
    if (qualifier === 'additionToPost') {
      const form = document.querySelector(`article[data-post-id="${qualifierId}"] .inline-addition-form`);
      form.querySelector('.chain-addition-textarea').value = composerContent;
      form.querySelector('.inline-tags-input').value = tagString;
      form.querySelector('[data-action="submit-inline-addition"]').click();
      closeEditor({ type: 'click' });
    } else if (qualifier === 'answerToAsk') {
      const form = document.querySelector(`article[data-ask-id="${qualifierId}"] .ask-answer-form`);
      form.querySelector('.ask-answer-body').value = composerContent;
      form.querySelector('.inline-tags-input').value = tagString;
      form.querySelector('.ask-answer-send').click();
      closeEditor({ type: 'click' });
    } else if (qualifier === 'asking') {
      const form = document.querySelector(`[data-ask-uuid="${qualifierId}"]`);
      form.querySelector('.ask-modal-body').value = composerContent;
      const anonCheckbox = form.querySelector('[type="checkbox"][name="anonymous"]');
      if (anonCheckbox) anonCheckbox.checked = askAnon;
      form.querySelector('.ask-modal-send').click();
      closeEditor({ type: 'click' });
    } else if (['editingPost', 'editingAddition'].includes(qualifier)) {
      const postData = editMap.get(qualifierId);
      let editPromise;

      if ('addition_id' in postData) {
        // editing addition on composite
        editPromise = editAddition(postData.parent, blog, {
          additionBody: composerContent,
          additionTagStr: tagString,
          additionId: postData.addition_id,
          postId: postData.post_id,
          createdAt: postData.created_at
        });
      } else if (postData.chain_version) {
        // editing root of composite
        editPromise = editCompositeRoot(postData, blog, {
          body: composerContent,
          tagStr: tagString,
          createdAt: postData.created_at
        });
      } else {
        editPromise = createPost(composerContent, tagString, blog, {
          hideFromSearch,
          editing: true,
          postId: qualifierId,
          createdAt: postData.created_at,
          answeredAsk: postData.answered_ask
        });
      }

      editPromise.then(() => {
        closeEditor({ type: 'click' });
        editMap.delete(qualifierId);
      }, e => {
        console.error(`[TF-Editor] Failed to edit post ${qualifierId}:`, e, event.data, postData);
        window.alert('Failed to edit post!');
      });
    } else {
      createPost(composerContent, tagString, blog, { hideFromSearch }).then(() => {
        closeEditor({ type: 'click' });
      }, e => {
        console.error('[TF-Editor] Failed to create post:', e, event.data);
        window.alert('Failed to create post!');
      });
    }
  }
};

function closeEditor(event) {
  if (event.type === 'keydown' && event.key === 'Escape' || event.type === 'click') {
    document.getElementById('tf-editor-dialogue').remove();
    window.removeEventListener('keydown', closeEditor);
  }
}

function onOpenEditor(event) {
  event.preventDefault();
  event.stopPropagation();

  openEditorIFrame();
}

function openEditorIFrame(qualifier = '') {
  document.body.append(noact({
    id: 'tf-editor-dialogue',
    className: customClass,
    children: {
      className: 'tf-editor-wrapper',
      children: [
        {
          tag: 'iframe',
          src: browser.runtime.getURL('/scripts/editor.html') + qualifier
        },
        {
          className: 'tf-editor-close',
          onclick: closeEditor,
          children: svgIcon('close', 24, 24)
        }
      ]
    }
  }));
  window.addEventListener('keydown', closeEditor);
}

const addChainAdditionFormControls = forms => forms.forEach(form => {
  const postId = form.querySelector('[data-post-id]')?.dataset.postId;
  form.querySelector('.chain-addition-form-controls').prepend(noact({
    className: customClass + ' btn-primary-sm',
    type: 'button',
    onclick: function () {
      openEditorIFrame(`?additionToPost=${postId}`);
    },
    children: [
      {
        tag: 'span',
        children: 'Open in custom editor'
      },
      svgIcon('commandline', 20, 20)
    ]
  }))
});

const addAnswerFormControls = forms => forms.forEach(form => {
  const askId = form.closest('[data-ask-id]')?.dataset.askId;
  form.querySelector('.ask-answer-controls').prepend(noact({
    className: customClass + ' btn-primary-sm',
    type: 'button',
    onclick: function () {
      openEditorIFrame(`?answerToAsk=${askId}`)
    },
    children: [
      {
        tag: 'span',
        children: 'Open in custom editor'
      },
      svgIcon('commandline', 20, 20)
    ]
  }))
});

const addAskFormControls = forms => forms.forEach(form => {
  const askUuid = crypto.randomUUID();
  form.dataset.askUuid = askUuid;
  form.querySelector('.ask-modal-controls').prepend(noact({
    className: customClass + ' btn-primary-sm',
    type: 'button',
    onclick: function () {
      openEditorIFrame(`?asking=${askUuid}`)
    },
    children: [
      {
        tag: 'span',
        children: 'Open in custom editor'
      },
      svgIcon('commandline', 20, 20)
    ]
  }))
});

const newEditButton = fragment => noact({
  className: `${customClass} post-action-btn`,
  title: 'Edit post in the custom editor',
  onclick: async function () {
    const post = await getOwnPost(fragment.post_id);
    const blogs = listBlogs();
    if (!blogs.length) {
      console.error('[TF-Editor] Failed to obtain user blogs');
      return;
    }
    const authorBlog = blogs.find(({ username }) => username === fragment.author);
    let postData;

    if ('addition_id' in fragment) {
      const targetAddition = post.additions.find(({ addition_id }) => addition_id === fragment.addition_id);
      postData = { ...targetAddition, parent: post, authorBlog };
    } else postData = { ...post, authorBlog };
    editMap.set(postData.post_id, postData);

    console.log(postData)

    openEditorIFrame(`?editing${'addition_id' in fragment ? 'Addition' : 'Post'}=${fragment.post_id}`);
  },
  children: [
    {
      tag: 'span',
      children: 'Edit'
    },
    svgIcon('commandline', 24, 24, customClass)
  ]
});

const addEditButtons = async articles => {
  const blogs = listBlogs();
  if (!blogs.length) {
    console.error('[TF-Editor] Failed to obtain user blogs');
    return;
  }
  const posts = await getPosts(articles);

  articles.forEach((article, i) => {
    if (article.getAttribute(customAttribute)) return;
    article.setAttribute(customAttribute, '');
    const post = posts[i];
    if (!post) return;
    if (!blogs.some(({ username }) => username === post.author)) return;

    const postTip = post.additions.find(({ addition_id }) => addition_id === post.chain_tip_id) || post;

    // probably borked until fragment migration is over with
    /* [post, ...post.additions].forEach((fragment, i) => {
      const authorBlog = blogs.find(({ username }) => username === fragment.author);
      if (authorBlog) {
        const button = newEditButton(fragment);
        if (!post.additions.length || post.chain_tip_id === fragment?.addition_id) article.querySelector('[data-action="sticker"]').insertAdjacentElement('afterend', button);
        else if ('root_post_id' in fragment) article.querySelector('.post-author .post-timestamp').insertAdjacentElement('beforebegin', button);
        else article.querySelector(`.chain-addition[data-addition-id="${fragment.addition_id}"] .chain-addition-header .chain-addition-time`).insertAdjacentElement('beforebegin', button);
      }
    }); */

    // for now, we only support editing chain tips
    const authorBlog = blogs.find(({ username }) => username === postTip?.author);
    if (authorBlog) {
      const button = newEditButton(postTip);
      article.querySelector('[data-action="sticker"]').insertAdjacentElement('afterend', button);
    }
  });
};

export const update = async options => ({ defaultContent, defaultCss, theme, keybinding } = options);

export const main = async () => {
  ({ defaultContent, defaultCss, theme, keybinding } = await getOptions('editor'));
  ({ theme: nrTheme, trustedImageHosts, trustedMediaHosts, trustedStylesheetHosts } = document.body.dataset);

  window.addEventListener('message', listener);
  document.getElementById('nav-new-post').insertAdjacentElement('afterend', noact({
    id: 'tf-nav-new-post',
    className: 'btn-primary-sm',
    title: 'Write a new post using the custom editor',
    onclick: onOpenEditor,
    children: svgIcon('commandline', 24, 24)
  }));
  mutationManager.start(chainAdditionFormSelector, addChainAdditionFormControls);
  mutationManager.start(answerFormSelector, addAnswerFormControls);
  mutationManager.start(askFormSelector, addAskFormControls);
  postFunction.start(addEditButtons, `:not([${customAttribute}])`);
};

export const clean = async () => {
  mutationManager.stop(addChainAdditionFormControls);
  mutationManager.stop(addAnswerFormControls);
  mutationManager.stop(addAskFormControls);
  postFunction.stop(addEditButtons)
  window.removeEventListener('message', listener);
  document.querySelectorAll(`.${customClass}`).forEach(s => s.remove());
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
};