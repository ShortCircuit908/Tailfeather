import { mutationManager } from './utils/mutation.js';
import { svgIcon } from './utils/icons.js';
import { getOptions } from './utils/jsTools.js';

const customClass = 'tailfeather-icons';
const customAttribute = 'data-tf-icons';
const iconSelector = `:is(.post-action-btn,.chain-addition-action,.post-header-hide):not([${customAttribute}])`;

const iconMap = {
  'post-permalink': 'link',
  staple: 'stapler',
  'add-to': 'add',
  sticker: 'star',
  'clear-stickers': 'scissors',
  'toggle-pin': 'pin',
  'edit-tags': 'tag',
  delete: 'trash',
  'hide-post': 'hide',
  block: 'block',
  mute: 'mute'
};

const iconReplace = (el, icon) => {
  if (!el) return;
  el.title = el.textContent;
  el.ariaLabel = el.textContent;
  el.prepend(svgIcon(icon, 24, 24, customClass));
};

const navIconReplace = (nav, selector, icon) => iconReplace(nav.querySelector(selector), icon);

// that's a first
export const handleNavIcons = () => {
  const container = document.querySelector(`.nav-container:not([${customAttribute}])`);
  if (!container) return;
  container.setAttribute(customAttribute, '');

  navIconReplace(container, '.nav-links [href="/feed/"]', 'home'); // prevents the selector from catching the logo instead
  navIconReplace(container, '[href="/everyone/"]', 'globe');
  navIconReplace(container, '[href="/search/"]', 'search');
  navIconReplace(container, '[href^="/book/"]', 'book');
  navIconReplace(container, '[href="/following/"]', 'users');
  navIconReplace(container, '[href="/followers/"]', 'usergroup');
  navIconReplace(container, '[href="/accounts/profile/edit/"]', 'wrench');
  navIconReplace(container, '#nav-new-post', 'brush');
  // navIconReplace(container, '.nav-logout', 'logout');
};

const handleIcons = icons => icons.forEach(icon => {
  let identifier;
  if ('action' in icon.dataset) identifier = icon.dataset.action;
  else identifier = Array.from(icon.classList.values()).find(className => className !== 'post-action-btn');

  if (identifier && iconMap[identifier]) iconReplace(icon, iconMap[identifier]);

  icon.setAttribute(customAttribute, '');
});

const run = ({ postIcons, navIcons }) => {
  if (postIcons) mutationManager.start(iconSelector, handleIcons);
  else mutationManager.stop(handleIcons);

  if (navIcons) handleNavIcons();
};

export const update = options => run(options);

export const main = async () => getOptions('customIcons').then(run);

export const clean = async () => {
  mutationManager.stop(handleIcons);
  document.querySelectorAll(`.${customClass}`).forEach(s => s.remove());
  document.querySelectorAll(`[${customAttribute}]`).forEach(s => s.removeAttribute(customAttribute));
};