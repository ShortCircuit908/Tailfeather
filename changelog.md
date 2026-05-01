# v1.4.0

## General

- Major behind-the-scenes changes to overhaul post wrangling for Noterook's post fragment system

# v1.3.2

## General

- Quick fixes for some breaking changes
- Data wrangling is currently broken but we have an appointment in half an hour so we're not about to dig into that in earnest right at the moment

# v1.3.1

## General

- Fixed styling related to the new header layout
- Fixed the mutation manager not removing listeners from its underlying managers

## Custom Timestamps

- Added the option to display timestamps in .beat time

# v1.3.0

## General

- Improved post pickup methods
- All features should now work with sideblogs
- Removed some outdated features
- Fixed some custom elements using `--bg-surface` as a background colour instead of a background

## New feature! Masonry Tweaks

- Allows up to 8 masonry columns instead of just the usual 2

## New feature! Custom Timestamps

- Custom formatted timestamps for posts

## New feature! Compact Navigation

- Overhauls the navigation UI to better suit smaller screens

## Post Finder

- Fixed searches aborting when searching through a database larger than 10 000 indices

## Custom Editor

- Now supports posting from any sideblog, active or not
- Added support for sending asks

## Custom Themes

- Fixed blog switcher contrast on Fruit theme
- Added two new preset themes: Impedance and Reef

# v1.2.0

## General

- Fixed MutationManager `this` inheritance
- Better post index & avatar handling/caching
- Better blob handling
- Synchronised tag parsing/rendering
- Removed several features now implemented into the site directly

## Avatar Tweaks

- Removed stapler & addition avatar options (added by the site)
- Added square avatars option

## Source display

- Fixed source display for root posts
- Very new posts may still fail to have a source display assigned if their blob has not yet updated

## Custom Icons

- Inbox icon now matches custom navigation icon size

## Sticker Tweaks

- Replaced Neat stickers option with a general visibility option
  - Stickers can now be hidden entirely

## Custom Editor

- Fixed outdated database version
- Added support for answering asks

## New feature! Clamp Notification Dropdown

- Clamps the notification dropdown to the edges of the window on narrow displays

## New feature! Post Finder

- Allows searching through your cached posts, complete with keywords and strict matching mode

# v1.1.0

## General

- Updated site utilities
- Improved mutation management
- Improved cache update handling
- Removed Feed Tweaks (obsoleted)
- Removed App Nav (largely a cohost-centric module, I don't know why we ported it)
- A ton of miscellaneous CSS tweaks to various features
- Fixed some features potentially causing chain headers to overflow horizontally
- Added the dragon

## New feature! Compact Navigation Header

- Makes the navigation header more compact on narrow screens
- Pairs well with Custom Icons

## Custom Icons

- Added icon for /followers/
- Added icon for logout action
- Made notification bell icon fit the style of custom icons

## Custom Themes

- Various theme colour fixes

## New feature! Keyboard Shortcuts

- Adds tumblr-like keyboard shortcuts for navigation
  - `j` - Scroll upwards one post
  - `k` - Scroll downwards one post

## New feature! Mutual Icons

- Shows icons next to your mutuals' usernames

## Post Editor

- Now correctly uses the selected Noterook or Tailfeather theme
- Can now be used to compose additions via a new button in the inline addition form

## New feature! Post Previews

- Live post previews for the default post composer

## New feature! Sticker Tweaks

- Fix unsupported emojis:
  - Replaces the default system emoji set with Noto Color Emoji, fixing any emojis that your system does not natively support
- Solid sticker outlines:
  - Adds a contrasting solid outline to stickers.
- Make stickers translucent on hover:
  - (50% opacity)
- Neat stickers:
  - Overrides default sticker placement entirely in favour of neatly arranging them along the bottom edge of each post.

# v1.0.0

- Initial release
