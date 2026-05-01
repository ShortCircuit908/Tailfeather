import { cacheAvatar, getCachedAvatar, getUsersShallow } from './utils/users.js';
import { getOptions, uniqueFn } from './utils/jsTools.js';
import { postFunction } from './utils/mutation.js';
import { getPostShallow } from './utils/postDaemon.js';
import { noact } from './utils/noact.js';

const customClass = 'tailfeather-avatars';
const customAttribute = 'data-tf-avatars';

let floatingAvatars, square;

const avatarise = async posts => {
  const shallowData = posts.map(getPostShallow);
  const postUsers = shallowData.flatMap(({ author, originalAuthor, chain }) => [author, originalAuthor, ...chain.map(({ author }) => author)]).filter(u => !!u).filter(uniqueFn);
  await getUsersShallow(postUsers).then(users => users.filter(u => !!u).forEach(({ username, avatar_url }) => cacheAvatar(username, avatar_url)));

  posts.forEach((post, i) => {
    const author = shallowData[i].author;
    const authorAvatar = getCachedAvatar(author);

    if (floatingAvatars) post.append(noact({
      className: `${customClass} ${customClass}-scrollContainer`,
      children: {
        href: `/book/${author}`,
        children: authorAvatar ? {
          className: 'post-author-avatar',
          src: authorAvatar,
          width: 64,
          height: 64,
          loading: 'lazy'
        } : {
          className: `${customClass} post-author-avatar hovercard-avatar-placeholder`,
          children: author[0]
        }
      }
    }));

    post.setAttribute(customAttribute, square ? 'square' : '');
  });
};

const run = options => {
  ({ floatingAvatars, square } = options);

  document.querySelectorAll(`.${customClass}`).forEach(s => s.remove());
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));

  postFunction.start(avatarise, `:not([${customAttribute}])`);
};

export const update = async options => run(options);

export const main = async () => getOptions('avatars').then(run);

export const clean = async () => {
  postFunction.stop(avatarise);
  document.querySelectorAll(`.${customClass}`).forEach(s => s.remove());
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
};