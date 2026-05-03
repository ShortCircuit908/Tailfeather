import { getOptions } from './utils/jsTools.js';
import { noact } from './utils/noact.js';

const customClass = 'tailfeather-horizontalNav';
const customAttribute = 'data-tf-hnav';

export const main = async () => {
  const { extraIcons } = await getOptions('horizontalNav');
  const navContainer = document.querySelector('.nav-container');
  if (navContainer.getAttribute(customAttribute)) return;

  navContainer.setAttribute(customAttribute, '');

  navContainer.prepend(navContainer.querySelector('.logo'));
  const navLinks = navContainer.querySelector('.nav-links')
  navContainer.append(navLinks);
  navLinks.append(document.getElementById('blog-switcher'));
  if (extraIcons) navLinks.append(...noact([
    {
      className: customClass,
      href: '/following/',
      ariaLabel: 'Following',
      title: 'Following',
      children: 'Following'
    },
    {
      className: customClass,
      href: '/followers/',
      ariaLabel: 'Followers',
      title: 'Followers',
      children: 'Followers'
    }
  ]));
  navLinks.append(...navContainer.querySelectorAll('#nav-new-post,#tf-nav-new-post'));
  navLinks.append(...navContainer.querySelectorAll('#nav-inbox,#notif-bell-wrap'));
  navLinks.append(document.getElementById('connection-status'));
  navContainer.querySelectorAll('.nav-row,.nav-support').forEach(s => s.remove());
};
export const clean = async () => document.querySelectorAll(`.${customClass}`).forEach(s => s.remove());