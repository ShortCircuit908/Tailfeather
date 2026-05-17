import { noact } from './utils/noact.js';
import { postFunction } from './utils/mutation.js';
import { getOptions } from './utils/jsTools.js';
import { getIndexedPosts, getPosts } from './utils/postDaemon.js';
import { svgIcon } from './utils/icons.js';
import { getProcessor } from './utils/markdown.js';

let theme, showBoth;

const customClass = 'tailfeather-displaySource';
const customAttribute = 'data-tf-display-source';

const missedIndices = new Set();

const sourceButton = () => noact({
  className: `${customClass} post-action-btn`,
  dataset: { active: false },
  onclick: function () { this.dataset.active === 'true' ? this.dataset.active = false : this.dataset.active = true; },
  children: [
    {
      tag: 'span',
      children: 'View Source'
    },
    svgIcon('code', 24, 24, customClass)
  ]
});
const newSourceDisplay = body => noact({
  className: customClass,
  dataset: { theme },
  children: {
    tag: 'pre',
    class: 'language-markup',
    children: [{
      tag: 'code',
      innerHTML: getProcessor()._sanitize(Prism.highlight(body, Prism.languages.markup, 'markup'), true)
    }]
  }
});

const setupDisplay = (postBody, actionTarget, postMarkdown) => {
  try {
    postBody.setAttribute(customAttribute, showBoth ? 'showBoth' : 'switch');
    actionTarget.insertAdjacentElement('beforebegin', sourceButton());
    postBody.parentElement.insertBefore(newSourceDisplay(postMarkdown), postBody.nextElementSibling); // why isn't insertAfter a thing?
  } catch (e) {
    console.warn('[DisplaySource] Failed to place button or source display:', postBody, actionTarget, postMarkdown, e);
  }
};

function _displayify(article, post) {
  const { body, additions } = post;
  const chainAdditions = Array.from(article.querySelectorAll('.chain-addition'));

  if (additions.length) { // all source displays are inserted into headers for posts with additions
    setupDisplay(article.querySelector('.post-body'), article.querySelector('.post-author .post-timestamp'), body);
    additions.forEach(({ body: additionBody }, j) => {
      if (!chainAdditions[j] || chainAdditions[j].matches('.chain-addition--blocked')) return;
      // apparently some necromanced posts can get stored in such a way where the physical post has no additions but the indexed record *does*
      // hence it's worth a check
      const chainAdditionBody = chainAdditions[j].querySelector('.chain-addition-body');
      if (chainAdditionBody) setupDisplay(chainAdditionBody, chainAdditionBody.parentElement.querySelector('.chain-addition-header .chain-addition-time'), additionBody);
    });
  } else { // for standalone posts, the toggle is placed in the footer
    setupDisplay(article.querySelector('.post-body'), article.querySelector('.post-actions :is(.post-action-report,.post-action-delete,[data-action="sticker"])'), body); // a few fallbacks that handle different routes
  }
}

const addButtons = async articles => {
  const postObjects = await getPosts(articles);
  articles.forEach((article, i) => {
    if (article.getAttribute(customAttribute)) return; // Masonry Tweaks seems to trigger this multiple times per post before the filter kicks in
    article.setAttribute(customAttribute, showBoth ? 'showBoth' : 'switch');
    const post = postObjects[i];
    if (!post) {
      missedIndices.add(article.dataset.postId);
      console.warn('[DisplaySource] Unable to obtain data for post on initial processing', article);
      return; // If blob is outdated
    }
    _displayify(article, post);
  });
};

function _retryMissed({ detail: { targets } }) {
  if (missedIndices.size && 'tipStore' in targets && (targets.tipStore?.length || targets.tipStore.post_id)) {
    const indices = [targets.tipStore].flat().map(({ post_id }) => post_id).filter(post_id => missedIndices.has(post_id));
    getIndexedPosts(indices).then(postObjects => Object.entries(postObjects).forEach(([post_id, postData]) => {
      const article = document.querySelector(`[data-post-id="${post_id}"]`);
      if (article && postData) {
        missedIndices.delete(post_id);
        _displayify(article, postData);
      }
    }));
  }
}

export const main = async () => {
  ({ theme, showBoth } = await getOptions('displaySource'));
  Prism.plugins.customClass.prefix('prism-');

  postFunction.start(addButtons, `:not([${customAttribute}])`);
  window.addEventListener('tailfeather-database-update', _retryMissed);
};
export const clean = async () => {
  postFunction.stop(addButtons);
  window.removeEventListener('tailfeather-database-update', _retryMissed);
  document.querySelectorAll(`.${customClass}`).forEach(s => s.remove());
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
};