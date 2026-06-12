import { noact } from './noact.js';
import { getActiveBlog, listBlogs } from './activeBlogs.js';

export function parseTags(input) {
  if (!input) return [];
  const tags = input.split(/[,，、]/)
    .map(t => t.trim().toLowerCase().replace(/^#/, ''))
    .filter(t => t.length > 0 && t.length <= 100);
  return [...new Set(tags)].slice(0, 30);
}

/**
 * Format a tag input into tag elements
 * @param {string} tagInput - tag input field value
 * @returns {HTMLElement[]}
 */
export function formatTags(tagInput) {
  const tags = parseTags(tagInput);
  return noact(tags.map(t => ({ className: 'post-tag', href: `/search/?q=${t}`, children: `#${t}` })));
}

export function blogSwitcher(callback = () => void 0, blogs, activeBlog, title = 'Switch active blog') {
  // We allow passing a custom blog array for contexts like the custom composer iframe where listBlogs() does not work
  // But otherwise we can just rely on the defaults
  blogs ??= listBlogs();
  activeBlog ??= getActiveBlog();

  function openDropdown() {
    if (this.ariaExpanded === 'false') {
      this.ariaExpanded = true;
      this.nextElementSibling.style.display = null;
    } else {
      this.ariaExpanded = false;
      this.nextElementSibling.style.display = 'none';
    }
  }

  const activeFirst = (a, b) => a.username === activeBlog.username ? -1 : (b.username === activeBlog.username ? 1 : 0);

  function switchBlogs() {
    const switcher = this.closest('.blog-switcher');
    switcher.querySelector('.blog-switcher-toggle').click();
    if (this.dataset.blogSlug === activeBlog.username) return;

    activeBlog = blogs.find(({ username }) => username === this.dataset.blogSlug);
    switcher.querySelector('.blog-switcher-label').textContent = `@${activeBlog.username}`;
    this.closest('.blog-switcher-menu').replaceChildren(...blogs.sort(activeFirst).map(blogSwitcherItem));

    callback(activeBlog);
  }

  const blogSwitcherItem = blog => {
    const { username, display_name } = blog
    const active = username === activeBlog.username;

    return noact({
      className: 'blog-switcher-item' + (active ? ' blog-switcher-item--active' : ''),
      type: 'button',
      dataset: { blogSlug: username },
      role: 'menuitem',
      onclick: switchBlogs,
      children: [
        {
          tag: 'span',
          className: 'blog-switcher-item-name',
          children: `@${username}`
        },
        username === display_name ? null : {
          tag: 'span',
          className: 'blog-switcher-item-display',
          children: display_name
        }
      ]
    });
  };

  return noact({
    className: 'tf-blog-switcher blog-switcher',
    children: [
      {
        className: 'blog-switcher-toggle',
        ariaHaspopup: true,
        ariaExpanded: false,
        title: title,
        onclick: openDropdown,
        children: [
          {
            tag: 'span',
            className: 'blog-switcher-label',
            children: `@${activeBlog.username}`
          },
          {
            tag: 'span',
            className: 'blog-switcher-chev',
            ariaHidden: true,
            children: '▾'
          }
        ]
      },
      {
        className: 'blog-switcher-menu',
        role: 'menu',
        style: 'display:none;',
        children: blogs.sort(activeFirst).map(blogSwitcherItem)
      }
    ]
  })
}