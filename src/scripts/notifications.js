import { getOptions, getStorage, formatString } from './utils/jsTools.js';
import { noact } from './utils/noact.js';
import { isBlockedUser } from './utils/blockManager.js';
import { activeSlug } from './utils/activeBlogs.js';

class NotifBuilder {
  static postUrl = '/book/{0}/?post={1}';
  static bookUrl = '/book/{0}/';
  static inboxUrl = '/inbox/';

  bodyTextTemplate = '';

  /**
   * Collect actor information into a uniform structure
   *
   * @param {object} notif
   * @returns {{
   *   username: string,
   *   displayName: string,
   *   avatarUrl: string
   * }}
   */
  getActor(notif) { }

  /**
   * Get additional parameters for use in {@link bodyTextTemplate}
   *
   * @param {object} notif
   * @return {string[]}
   */
  getDetails(notif) { }

  /**
   * Get a path to the post referred to by the notification
   *
   * @param {object} notif
   * @return {string}
   */
  getLink(notif) { }

  /**
   * Assemble Noterook notification events into push notifications
   *
   * @param {object} notif
   * @returns {Notification}
   */
  buildNotification(notif) {
    const actor = this.getActor(notif);
    if (notif.is_anonymous) {
      actor.displayName = 'anonymous';
      actor.avatarUrl = '';
    }
    const ownerBlog = notif.recipient || activeSlug;
    const actorName = actor.displayName || actor.username;
    const format = this.bodyTextTemplate || ('{} ' + notif.type);
    const bodyText = formatString(format, actorName, ...(this.getDetails(notif) || []));
    const avatarLink = actor.avatarUrl && _isSafeUrl(actor.avatarUrl) ? actor.avatarUrl : '';
    const notification = new Notification(`New Noterook notification on ${ownerBlog}`, { body: bodyText, icon: avatarLink, data: notif });
    const link = window.location.origin + this.getLink(notif);
    notification.onclick = () => browser.runtime.sendMessage({
      type: 'open_url',
      url: link
    });
    return notification;
  }
}

const notificationHandlers = {
  followed: new (class extends NotifBuilder {
    bodyTextTemplate = '{0} followed you';

    getActor(notif) {
      return {
        username: notif.username,
        displayName: notif.display_name,
        avatarUrl: notif.avatar_url
      };
    }
    getLink(notif) {
      return formatString(NotifBuilder.bookUrl, encodeURIComponent(this.getActor(notif).username));
    }
  }),
  new_post: new (class extends NotifBuilder {
    bodyTextTemplate = '{0} posted';

    getActor(notif) {
      return {
        username: notif.author,
        displayName: notif.author_name,
        avatarUrl: notif.author_avatar
      };
    }
    getLink(notif) {
      return formatString(NotifBuilder.postUrl, encodeURIComponent(this.getActor(notif).username), encodeURIComponent(notif.post_id));
    }

    buildNotification(notif) {
      if (!followedUsers.includes(this.getActor(notif).username.toLowerCase())) {
        return null;
      }
      return super.buildNotification(notif);
    }
  }),
  new_addition: new (class extends NotifBuilder { // Adding to someone else's post
    bodyTextTemplate = '{0} added to a post';

    getActor(notif) {
      const addition = notif.additions.find(addition => addition.post_id === notif.post_id);
      return {
        username: addition.author,
        displayName: addition.author_name
      };
    }
    getLink(notif) {
      return formatString(NotifBuilder.postUrl, encodeURIComponent(this.getActor(notif).username), encodeURIComponent(notif.post_id));
    }

    buildNotification(notif) {
      if (!followedUsers.includes(this.getActor(notif).username.toLowerCase())) {
        return null;
      }
      return super.buildNotification(notif);
    }
  }),
  new_staple: new (class extends NotifBuilder {
    bodyTextTemplate = '{0} stapled a post';

    getActor(notif) {
      return {
        username: notif.author
      };
    }
    getLink(notif) {
      return formatString(NotifBuilder.postUrl, encodeURIComponent(this.getActor(notif).username), encodeURIComponent(notif.post_id));
    }

    buildNotification(notif) {
      if (!followedUsers.includes(this.getActor(notif).username.toLowerCase())) {
        return null;
      }
      return super.buildNotification(notif);
    }
  }),
  post_stapled: new (class extends NotifBuilder { // stapling or adding to your post
    bodyTextTemplate = '{0} {1} your post';

    getActor(notif) {
      return {
        username: notif.stapler,
        displayName: notif.stapler_name,
        avatarUrl: notif.stapler_avatar
      };
    }
    getLink(notif) {
      return formatString(NotifBuilder.postUrl, encodeURIComponent(this.getActor(notif).username), encodeURIComponent(notif.own_post_id || notif.post_id));
    }
    getDetails(notif) {
      return [notif.has_addition ? 'added to' : 'stapled'];
    }
  }),
  addition_stapled: new (class extends NotifBuilder {
    bodyTextTemplate = '{0} {1} a post you added to';

    getActor(notif) {
      return {
        username: notif.stapler,
        displayName: notif.stapler_name,
        avatarUrl: notif.stapler_avatar
      };
    }
    getLink(notif) {
      return formatString(NotifBuilder.postUrl, encodeURIComponent(this.getActor(notif).username), encodeURIComponent(notif.own_post_id || notif.post_id));
    }
    getDetails(notif) {
      return [notif.has_addition ? 'added to' : 'stapled'];
    }
  }),
  post_stickered: new (class extends NotifBuilder {
    bodyTextTemplate = '{0} reacted {1} to your post';

    getActor(notif) {
      return {
        username: notif.sticker_by,
        displayName: notif.sticker_by_name,
        avatarUrl: notif.sticker_by_avatar
      };
    }
    getLink(notif) {
      const rootId = String(notif.post_id).split(':', 1)[0];
      return formatString(NotifBuilder.postUrl, encodeURIComponent(this.getActor(notif).username), encodeURIComponent(rootId));
    }
    getDetails(notif) {
      return [notif.emoji || ''];
    }
  }),
  post_replied: new (class extends NotifBuilder {
    bodyTextTemplate = '{0} replied to your post';

    getActor(notif) {
      return {
        username: notif.reply_by,
        displayName: notif.reply_by_name,
        avatarUrl: notif.reply_by_avatar
      };
    }
    getLink(notif) {
      return formatString(NotifBuilder.postUrl, encodeURIComponent(this.getActor(notif).username), encodeURIComponent(notif.post_id));
    }
  }),
  new_ask: new (class extends NotifBuilder {
    bodyTextTemplate = '{0} {1}';

    getActor(notif) {
      return {
        username: notif.sender,
        displayName: notif.sender_name,
        avatarUrl: notif.sender_avatar
      };
    }
    getLink(notif) {
      return NotifBuilder.inboxUrl;
    }
    getDetails(notif) {
      return [notif.from_staff ? 'sent you a staff message' : 'asked you something'];
    }
  }),
  ask_answered: new (class extends NotifBuilder {
    bodyTextTemplate = '{0} answered your ask';

    getActor(notif) {
      return {
        username: notif.answerer,
        displayName: notif.answerer_name,
        avatarUrl: notif.answerer_avatar
      };
    }
    getLink(notif) {
      return formatString(NotifBuilder.postUrl, encodeURIComponent(this.getActor(notif).username), encodeURIComponent(notif.answer_post_id));
    }
  })
};

const _targetEvents = [
  'nr:followed',
  'nr:new_post',
  'nr:new_addition',
  'nr:new_staple',
  'nr:post_stapled',
  'nr:post_stickered',
  'nr:post_replied',
  'nr:new_ask'
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

function _parseFollowedUsers(str) {
  return str.toLowerCase().split('\n').map(item => item.trim()).filter(item => item.length > 0);
}

function _onNotification(e) {
  const detail = e.detail || {};
  const builder = notificationHandlers[detail.type];

  if (!detail.type || !builder) return;

  const actor = builder.getActor(detail);
  if (isBlockedUser(actor.username)) return; // Simple check
  const notif = builder.buildNotification(detail);
}

function _run() {
  if (!_channel) {
    _channel = new BroadcastChannel('nr_tab_sync');
    _channel.onmessage = message => {
      const data = message.data;
      if (!data || !data.type) return;
      if (data.type === 'sse_event' && _targetEvents.includes(data.eventName)) _onNotification(data);
    };
  }
}

export const update = async options => {
  const { followedUsers: followedUsersRaw } = options;
  followedUsers = _parseFollowedUsers(followedUsersRaw);
};

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
  if (_channel) {
    _channel.close();
    _channel = null;
  }
};