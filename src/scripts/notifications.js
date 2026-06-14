import { getOptions, getStorage } from './utils/jsTools.js';
import { noact } from './utils/noact.js';
import { isBlockedUser } from './utils/blockManager.js';
import { activeSlug } from './utils/activeBlogs.js';

const target_events = [
  'nr:followed',
  'nr:new_post',
  'nr:new_addition',
  'nr:new_staple',
  'nr:post_stapled',
  'nr:post_stickered',
  'nr:new_ask',
  'nr:post_replied'
];

let _requestInProgress = false;
let _channel;

let followedUsers;

async function _cancel() {
  return getStorage(['preferences']).then(async ({ preferences }) => {
    preferences.notifications.enabled = false;
    await browser.storage.local.set(preferences);
  });
}

async function _requestPermission() {
  if (_requestInProgress) return;
  _requestInProgress = true;
  Notification.requestPermission().then(async result => {
    document.getElementById('tf-notifications-dialogue').remove();
    console.debug('[Notifications] Permission:', result);
    if (result === 'granted') _run();
    else if (result === 'denied') await _cancel();
  });
}

function _isSafeUrl(url) {
  try {
    const parsed = new URL(url, location.origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * constructs a notification.
 *
 * @param {object} notif - Notification payload (from Redis ZSET via
 *   /api/v1/notifications/since/).
 * @param {object} [opts]
 * @param {string} [opts.selfUsername] - Legacy fallback for the
 *   recipient blog. Modern payloads carry `recipient` (set by
 *   push_notification on the server), which is the authoritative
 *   post-owning blog for staple / sticker notifications. Pass the
 *   currently-active blog so old payloads buffered before the
 *   recipient field rolled out still resolve to a sensible URL.
 * @returns {Notification}
 */
function _buildNotificationItem(notif, opts = {}) {
  const { selfUsername = '' } = opts;

  // The recipient blog (i.e. who the notification was pushed TO)
  // is the post-owning blog for staple / sticker notifications -
  // those events are always addressed to the post's author. Prefer
  // it over the active-blog fallback so switching sideblogs after
  // a notification lands doesn't reroute its post URL to the wrong
  // book and 404 (Sel's report).
  const ownerBlog = notif.recipient || selfUsername;

  const {
    username: actor,
    displayName:actorName,
    avatarUrl: avatarUrl
  } = _getAuthorDetails(notif);

  let bodyText = '';
  if (notif.type === 'followed') {
    bodyText = 'followed you';
  } else if (notif.type === 'post_stapled') {
    const verb = notif.has_addition ? 'added to' : 'stapled';
    bodyText = `${verb} your post`;
  } else if (notif.type === 'addition_stapled') {
    // Your addition traveled along with a staple of someone else's
    // root. If the stapler also added their own commentary in the
    // process, the user-visible action they took was really "added
    // to" (not just a bare staple); say that.
    bodyText = notif.has_addition
      ? 'added to a post you added to'
      : 'stapled a post you added to';
  } else if (notif.type === 'post_stickered') {
    bodyText = `reacted ${notif.emoji || ''} to your post`;
  } else if (notif.type === 'new_ask') {
    bodyText = notif.from_staff ? 'sent you a staff message' : 'asked you something';
  } else if (notif.type === 'ask_answered') {
    bodyText = 'answered your ask';
  } else if (notif.type === 'ask-answered') {
    bodyText = 'replied to your post';
  } else if (notif.type === 'new_post') {
    if (!followedUsers.includes(actor.toLowerCase())) {
      return null;
    }
    bodyText = 'posted';
  } else if (notif.type === 'new_addition') {
    if (!followedUsers.includes(actor.toLowerCase())) {
      return null;
    }
    bodyText = 'added to a post';
  } else if (notif.type === 'new_staple') {
    if (!followedUsers.includes(actor.toLowerCase())) {
      return null;
    }
    bodyText = 'stapled a post';
  } else {
    bodyText = notif.type;
  }

  const avatarLink = avatarUrl && _isSafeUrl(avatarUrl) ? avatarUrl : '';

  const notificationObj = new Notification(`New Noterook notification on ${ownerBlog}`, { body: `${actorName} ${bodyText}`, icon: avatarLink, data: notif });
  return notificationObj;
}

/**
 * Transform actor information into a uniform structure
 *
 * @param {object} notif
 * @returns {{username: string, displayName: string, avatar: string}}
 */
function _getAuthorDetails(notif){
  let authorUsername = '';
  let authorDisplayName = 'someone';
  let authorAvatar = '';
  switch (notif.type) {
    case 'new_post':
      authorUsername = notif.author;
      authorDisplayName = notif.author_name;
      authorAvatar = notif.author_avatar;
      break;
    case 'new_addition':
      const addition = notif.additions.find(addition => addition.post_id === notif.post_id);
      authorUsername = addition.author;
      authorDisplayName = addition.author_name;
      break;
    case 'new_staple':
      authorUsername = notif.author;
      authorDisplayName = notif.author;
      break;
    case 'post_stickered':
      authorUsername = notif.sticker_by;
      authorDisplayName = notif.sticker_by_name;
      authorAvatar = notif.sticker_by_avatar;
      break;
    case 'new_ask':
      authorUsername = notif.sender;
      authorDisplayName = notif.sender_name;
      authorAvatar = notif.sender_avatar;
      break;
    case 'post_replied':
      authorUsername = notif.reply_by;
      authorDisplayName = notif.reply_by_name;
      authorAvatar = notif.reply_by_avatar;
      break;
    case 'post_stapled':
      authorUsername = notif.stapler;
      authorDisplayName = notif.stapler_name;
      authorAvatar = notif.stapler_avatar;
      break;
    case 'followed':
      authorUsername = notif.username;
      authorDisplayName = notif.display_name;
      authorAvatar = notif.avatar_url;
      break;
  }
  if (notif.is_anonymous) {
    authorDisplayName = 'anonymous';
    authorAvatar = '';
  }
  return {
    username: authorUsername,
    displayName: authorDisplayName,
    avatar: authorAvatar
  }
}

function _parseFollowedUsers(str){
  return str.toLowerCase().split('\n').map(item => item.trim()).filter(item=> item.length > 0);
}

function _onNotification(e) {
  const detail = e.detail || {};
  if (!detail.type) return;

  const actor = detail.username || detail.stapler || detail.sticker_by || '';
  if (isBlockedUser(actor)) return; // Simple check

  const displayName = detail.display_name || detail.stapler_name || detail.sticker_by_name || actor;
  const icon = detail.avatar_url || detail.stapler_avatar || detail.stickered_by_avatar || '';

  const notif = _buildNotificationItem(detail, { selfUsername: activeSlug });
}

function _run() {
  if (!_channel) {
    _channel = new BroadcastChannel('nr_tab_sync');
    _channel.onmessage = message => {
      const data = message.data;
      if (!data || !data.type) {
        return;
      }
      if (data.type === 'sse_event' && target_events.includes(data.eventName)) {
        _onNotification(data);
      }
    };
  }
}

export const update = async function (options){
  const { followedUsers: followedUsersRaw } = options;
  followedUsers = _parseFollowedUsers(followedUsersRaw);
}

export const main = async () => {
  const { followedUsers: followedUsersRaw } = await getOptions('notifications');
  followedUsers = _parseFollowedUsers(followedUsersRaw);
  if (Notification.permission === 'denied') {
    await _cancel();
    return;
  } else if (Notification.permission === 'default') {
    document.body.append(noact({
      tag: 'dialog',
      id: 'tf-notifications-dialogue',
      open: '',
      children: {
        className: 'btn-primary',
        onclick: _requestPermission,
        children: 'Allow push notifications'
      }
    }))
  } else _run();
};

export const clean = async () => {
  if(_channel){
    _channel.close();
    _channel = null;
  }
};
