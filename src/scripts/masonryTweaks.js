import { getOptions } from './utils/jsTools.js';
import { noact } from './utils/noact.js';
import { postSelector, dynamicStyle } from './utils/document.js';
import { mutationManager, postFunction } from './utils/mutation.js';

const customClass = 'tailfeather-masonryTweaks';
const customAttribute = 'data-tf-masonry-tweaks';
const feedSelector = `:is(#everyone-posts,#feed-posts):has(${postSelector})`;
const columnSelector = `.masonry-col:has(${postSelector})`;

const newMasonryCol = () => noact({
  className: `${customClass} masonry-col`,
  dataset: { tfMasonryTweaks: '' }
});

let columnCount = 2;
let masonryCols = [];
let columnHeights = [];
let posts = new Set();
let renderObserver;

const getTargetColumn = () => columnHeights.map((h, j) => [h, j]).toSorted(([a], [b]) => a - b).shift()[1];

const reflowMasonry = () => {
  document.querySelector(feedSelector).replaceChildren(...masonryCols);

  columnCount = masonryCols.length;
  columnHeights = [...Array(columnCount).keys()].fill(0);
  const virtualCols = [...Array(columnCount).keys()].map(() => []);
  posts.forEach(post => {
    const target = getTargetColumn();
    virtualCols[target].push(post);
    columnHeights[target] += post.offsetHeight;
    post.setAttribute(customAttribute, '');
  });
  masonryCols.forEach((col, i) => {
    col.replaceChildren(...virtualCols[i]);
  });
};

const gatherPosts = () => posts = new Set(document.querySelectorAll(postSelector));

const sortPosts = posts => posts.forEach(post => {
  const target = getTargetColumn();
  masonryCols[target].append(post);
  columnHeights[target] += post.offsetHeight;
  post.setAttribute(customAttribute, '');
});

const handleRendering = records => {
  const newCols = records.flatMap(({ addedNodes }) => Array.from(addedNodes))
  if (newCols.length) {
    console.debug('[MasonryTweaks] Feed has been rerendered, handling new columns...');
    records[0]?.target.removeAttribute(customAttribute);
    handleColumns(newCols);
  }
};

const handleColumns = cols => {
  if (cols.some(c => c.getAttribute(customAttribute) !== null)) return;
  const feed = document.querySelector(feedSelector);
  feed.setAttribute(customAttribute, '');
  cols.forEach(c => c.setAttribute(customAttribute, ''));

  masonryCols = Array.from(document.querySelectorAll(columnSelector));
  if (masonryCols.length != columnCount) {
    gatherPosts();
    if (masonryCols.length < columnCount) masonryCols.splice(1, 0, ...[...Array(columnCount - masonryCols.length).keys()].map(newMasonryCol));
    else masonryCols.splice(1, masonryCols.length - columnCount);
    reflowMasonry();
  }

  renderObserver?.disconnect();
  renderObserver = new MutationObserver(handleRendering);
  renderObserver.observe(feed, { childList: true });

  postFunction.start(sortPosts, `:not([${customAttribute}])`);
};

const run = ({ expandedMasonry }) => {
  columnCount = expandedMasonry;
  columnHeights = [...Array(columnCount).keys()].fill(0);
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
  mutationManager.start(`:not(${customAttribute})>${columnSelector}`, handleColumns);
};

export const update = async options => run(options);

export const main = async () => getOptions('masonryTweaks').then(run);

export const clean = async () => {
  document.querySelectorAll(`.${customClass}`).forEach(s => s.remove());
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
  mutationManager.stop(handleColumns);
};