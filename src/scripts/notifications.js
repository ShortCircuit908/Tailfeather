import { getStorage } from './utils/jsTools.js';
import { noact } from './utils/noact.js';
import { isBlockedUser } from './utils/blockManager.js';

let _requestInProgress = false;

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

function _onNotification(e) {
  const detail = e.detail || {};
  if (!detail.type) return;

  const actor = detail.username || detail.stapler || detail.sticker_by || '';
  if (isBlockedUser(actor)) return; // Simple check

  console.log(detail);

  // 'post_stapled'
  //  - 'has_addition'
  // 'post_stickered'

  const displayName = detail.display_name || detail.stapler_name || detail.sticker_by_name || actor;
  const icon = detail.avatar_url || detail.stapler_avatar || detail.stickered_by_avatar || '';

  const notif = new Notification(`New Noterook notification on ${detail.recipient}`, { title: displayName, icon });
}

function _run() {
  document.addEventListener('nr:post_stapled', _onNotification);
  document.addEventListener('nr:post_stickered', _onNotification);
  document.addEventListener('nr:followed', _onNotification);
  document.addEventListener('nr:new_ask', _onNotification);
}

export const main = async () => {
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
export const clean = async () => { };