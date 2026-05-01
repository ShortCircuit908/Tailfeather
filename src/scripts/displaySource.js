import { noact } from './utils/noact.js';
import { postFunction } from './utils/mutation.js';
import { getOptions } from './utils/jsTools.js';
import { getPosts } from './utils/postDaemon.js';
import { svgIcon } from './utils/icons.js';
import { getProcessor } from './utils/markdown.js';

let theme, showBoth;

const customClass = 'tailfeather-displaySource';
const customAttribute = 'data-tf-display-source';

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

const addButtons = async posts => {
  const postObjects = await getPosts(posts);
  posts.forEach(async (post, i) => {
    if (post.getAttribute(customAttribute)) return; // Masonry Tweaks seems to trigger this multiple times per post before the filter kicks in

    post.setAttribute(customAttribute, showBoth ? 'showBoth' : 'switch');
    if (!postObjects[i]) return; // If blob is outdated
    const { body, additions } = postObjects[i];
    const chainAdditions = Array.from(post.querySelectorAll('.chain-addition-body'));

    if (additions.length) { // all source displays are inserted into headers for posts with additions
      setupDisplay(post.querySelector('.post-body'), post.querySelector('.post-author .post-timestamp'), body);
      additions.forEach(({ body: additionBody }, j) => {
        // apparently some necromanced posts can get stored in such a way where the physical post has no additions but the indexed record *does*
        // hence it's worth a check
        if (chainAdditions[j]) setupDisplay(chainAdditions[j], chainAdditions[j].parentElement.querySelector('.chain-addition-header .chain-addition-time'), additionBody);
      });
    } else { // for standalone posts, the toggle is placed in the footer
      setupDisplay(post.querySelector('.post-body'), post.querySelector('.post-actions :is(.post-action-report,.post-action-delete,[data-action="sticker"])'), body); // a few fallbacks that handle different routes
    }
  });
};

export const main = async () => {
  ({ theme, showBoth } = await getOptions('displaySource'));
  Prism.plugins.customClass.prefix('prism-');

  postFunction.start(addButtons, `:not([${customAttribute}])`);
};
export const clean = async () => {
  postFunction.stop(addButtons);
  document.querySelectorAll(`.${customClass}`).forEach(s => s.remove());
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
};