import { postFunction } from './utils/mutation.js';
import { getOptions } from './utils/jsTools.js';
import { getPostShallow } from './utils/postDaemon.js';

const normalizeRegex = /[^\w-,]/g;
const customAttribute = 'data-tf-safeScroll';
const filteredAttribute = 'data-tf-safeScroll-hidden';
const postSelector = `:not([${customAttribute}])`;
const avatarSelector = '.post-author-avatar';
const contentSelector = ':is(.post-body,.chain-addition-body)';
const textSelector = ':is(.post-body,.chain-addition-body)';
const shadowRootSelector = ':is(.post-body,.chain-addition-body):empty'; // Nifty little hack

let blogAvatars, shadowContent, filterBlogs, blogList, tagList, hideStyle, dispelStyle, filterBlogList, filterTagList;

const isFilteredUser = user => filterBlogList.includes(user);
const hasFilteredTag = tags => tags.some(tag => filterTagList.includes(tag));
function removeOnClick(event) {
  event.preventDefault();
  event.stopPropagation();
  this.removeAttribute(filteredAttribute);
  this.removeEventListener('click', removeOnClick);
}
const filterPosts = posts => posts.forEach(post => {
  const { author, originalAuthor, tags, chain } = getPostShallow(post);
  const chainAuthors = chain.map(({ author }) => author);
  const chainTags = chain.flatMap(({ tags }) => tags);
  tags.push(...chainTags);

  if ((filterBlogs.parent && isFilteredUser(author))
    || (filterBlogs.root && isFilteredUser(originalAuthor || author))
    || (filterBlogs.trail && (chainAuthors.some(chainAuthor => isFilteredUser(chainAuthor))))
    || (hasFilteredTag(tags))) {
    post.setAttribute(customAttribute, hideStyle);
    console.log(post);

    if (blogAvatars) post.querySelectorAll(avatarSelector).forEach(avatar => avatar.setAttribute(filteredAttribute, ''));

    if (hideStyle === 'hidePost') post.setAttribute(filteredAttribute, hideStyle);
    else post.querySelectorAll(contentSelector).forEach(media => media.setAttribute(filteredAttribute, hideStyle));

    if (dispelStyle === 'click') {
      if (hideStyle === 'hidePost') post.addEventListener('click', removeOnClick);
      post.querySelectorAll(`[${filteredAttribute}]`).forEach(content => content.addEventListener('click', removeOnClick));
    }
  }
})

const run = options => {
  ({
    blogAvatars,
    filterBlogs,
    blogList,
    tagList,
    hideStyle,
    dispelStyle
  } = options);

  filterBlogList = blogList.toLowerCase().replace(normalizeRegex, '').split(',').filter(item => item);
  filterTagList = tagList.toLowerCase().replace(normalizeRegex, '').split(',').filter(item => item);

  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
  document.querySelectorAll(`[${filteredAttribute}]`).forEach(s => s.removeAttribute(filteredAttribute));
  postFunction.start(filterPosts, postSelector);
}

export const update = options => run(options);

export const main = async () => getOptions('safeScroll').then(run);

export const clean = async () => {
  postFunction.stop(filterPosts);
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
  document.querySelectorAll(`[${filteredAttribute}]`).forEach(s => s.removeAttribute(filteredAttribute));
};