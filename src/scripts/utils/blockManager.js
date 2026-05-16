const _CACHE_KEY = 'noterook_blocked_users';
let _symmetricBlocks = new Set();

function _init() {
  const cached = localStorage.getItem(_CACHE_KEY);
  if (cached) {
    _symmetricBlocks = new Set(JSON.parse(cached).map(u => u.toLowerCase()));
  }
}

export function isBlockedUser(username) {
  return _symmetricBlocks.has(username);
}

_init();