import { cacheFromDOM } from './postDaemon.js';
import { postSelector } from './document.js';
import { addNavigationListener, navigationListeners, removeNavigationListener } from './navigation.js';

class LightManager {
  addedNodesQueue = [];
  targetNodesQueue = [];
  updateQueued = false;
  observing = false;
  timerId;
  root;
  options;
  listeners = new Map();

  _funcManager(testNodes) {
    for (const [func, selector] of this.listeners) {
      if (func.length === 0) {
        const shouldRun = testNodes.some(testNode => testNode.matches(selector) || testNode.querySelector(selector) !== null);
        if (shouldRun) {
          try {
            func(this);
          } catch (e) {
            console.error('[MutationManager] Failed to execute mutation callback:', e);
          }
        }
        continue;
      }

      const matchingElements = [
        ...testNodes.filter(testNode => testNode.matches(selector)),
        ...testNodes.flatMap(testNode => [...testNode.querySelectorAll(selector)])
      ].filter((value, index, array) => index === array.indexOf(value));

      if (matchingElements.length !== 0) {
        try {
          func(matchingElements, this);
        } catch (e) {
          console.error('[MutationManager] Failed to execute mutation callback:', e);
        }
      }
    }
  }

  _nodeManager() {
    this.updateQueued = false;

    const addedNodes = this.addedNodesQueue
      .splice(0)
      .filter(addedNode => addedNode.isConnected);

    if (addedNodes.length > 0) this._funcManager(addedNodes);
  }

  /**
   * Start a mutation callback
   * @param {string} selector - CSS selector for elements to target
   * @param {Function} func - Callback function for matching elements
   */
  start(selector, func) {
    if (this.listeners.has(func)) this.listeners.delete(func);
    this.listeners.set(func, selector);
    this.trigger(func);
  }

  /**
   * Stop a mutation callback
   * @param {Function} func - Function to remove
   */
  stop(func) {
    if (this.listeners.has(func)) this.listeners.delete(func);
  }

  /**
   * Trigger a mutation callback on all matching elements
   * @param {Function} func - Function to run
   */
  trigger(func) {
    let selector;
    if (!this.root) return;
    if (this.listeners.has(func)) selector = this.listeners.get(func);
    else return;

    if (func.length === 0) {
      const shouldRun = this.root.querySelector(selector) !== null;
      if (shouldRun) func(this);
      return;
    }

    const matchingElements = [...this.root.querySelectorAll(selector)];
    if (matchingElements.length !== 0) {
      func(matchingElements, this);
    }
  }

  /**
   * Starts the mutation manager
   * @param {HTMLElement|null} root - Root to observe
   * @param {object?} options - Observer options
   */

  observe(root, options = { childList: true, subtree: true }) {
    this.observing = true;
    this.root = root || document.body || document.documentElement;// fallback for some early loads
    this.options = options;
    this.observer = new MutationObserver(mutations => {
      const addedNodes = mutations
        .flatMap(({ addedNodes }) => [...addedNodes])
        .filter(addedNode => addedNode instanceof Element);

      this.addedNodesQueue.push(...addedNodes);

      requestAnimationFrame(this._nodeManager.bind(this)); // JS is the best OOP ever

      if (this.updateQueued === false) {
        this.timerId = requestAnimationFrame(this._nodeManager.bind(this));
        this.updateQueued = true;
      }
    });

    this.observer.observe(this.root, this.options);
  }
  /**
   * Disconnects and deletes the mutation manager
   */
  disconnect() {
    this.observer.disconnect();
    delete this;
  }

  constructor(root) {
    if (root) this.observe();
  }
}

export class ShadowManager extends LightManager {
  _observe() {
    if (this.observer) {
      this.observer.disconnect();
      delete this.observer;
    }
    this.observer = new MutationObserver(mutations => {
      const addedNodes = mutations
        .flatMap(({ addedNodes }) => [...addedNodes])
        .filter(addedNode => addedNode instanceof Element);

      this.addedNodesQueue.push(...addedNodes);

      requestAnimationFrame(this._nodeManager.bind(this)); // JS is the best OOP ever

      if (this.updateQueued === false) {
        this.timerId = requestAnimationFrame(this._nodeManager.bind(this));
        this.updateQueued = true;
      }
    });

    this.observer.observe(this.root, this.options);
  }

  observe(shadowHost, options = { childList: true, subtree: true }) {
    this.observing = true;
    this.options = options;
    if (shadowHost.shadowRoot) {
      this.root = shadowHost.shadowRoot;
      this._observe();
    } else {
      const shadowObserver = new MutationObserver(() => {
        shadowObserver.disconnect();
        this.root = shadowHost.shadowRoot;
        this._observe();
      });
      shadowObserver.observe(shadowHost, { childList: true, subtree: true });
    }
  }

  constructor(shadowHost) {
    super();
    if (shadowHost) this.observe(shadowHost);
  }
}

const bookHostId = 'book-shadow-host';

export const mutationManager = Object.freeze({ // Interface wrapper for both the light and shadow DOM observers
  listeners: new Map(),
  lightManager: new LightManager(document.body),
  shadowManager: new ShadowManager(document.getElementById(bookHostId)),

  _shadowTl() {
    if (document.getElementById(bookHostId)) this.shadowManager.observe(document.getElementById(bookHostId));
  },

  /**
   * Start a mutation callback
   * @param {string} selector - CSS selector for elements to target
   * @param {Function} func - Callback function for matching elements
   */
  start(selector, func) {
    if (!navigationListeners.has(this._shadowTl)) addNavigationListener(this._shadowTl.bind(this));
    if (this.listeners.has(func)) this.listeners.delete(func);
    this.listeners.set(func, selector);
    this.lightManager.listeners.set(func, selector);
    this.shadowManager.listeners.set(func, selector);
    this.trigger(func);
  },

  /**
   * Stop a mutation callback
   * @param {Function} func - Function to remove
   */
  stop(func) {
    if (this.listeners.has(func)) this.listeners.delete(func);
    if (this.lightManager.listeners.has(func)) this.lightManager.listeners.delete(func);
    if (this.shadowManager.listeners.has(func)) this.shadowManager.listeners.delete(func);
    if (!this.listeners.length) removeNavigationListener(this._shadowManaging);
  },

  /**
   * Trigger a mutation callback on all matching elements
   * @param {Function} func - Function to run
   */
  trigger(func) {
    let selector;
    if (this.listeners.has(func)) selector = this.listeners.get(func);
    else return;

    if (func.length === 0) {
      if (this.lightManager.root?.querySelector(selector)) func(this.lightManager);
      if (this.shadowManager.root?.querySelector(selector)) func(this.lightManager); // ShadowManager.root is already the shadowRoot
      return;
    }

    const matchingElements = [this.lightManager.root?.querySelectorAll(selector), this.shadowManager.root?.querySelectorAll(selector)]
      .filter(nl => !!nl).flatMap(nl => [...nl]);
    if (matchingElements.length !== 0) {
      func(matchingElements, this);
    }
  }
});



export const postFunction = Object.freeze({ // old PF interface but with a new coat of...shadow DOM paint
  functions: new Map(),

  _onNewPosts(posts) {
    for (const [func, filter] of postFunction.functions) {
      filter ? func(posts.filter(post => post.matches(filter))) : func(posts)
    }
    cacheFromDOM(posts);
  },

  /**
   * Start a mutation callback on new posts
   * @param {string} selector - CSS selector for elements to target
   * @param {Function} func - Callback function for matching elements
   */
  start(func, filter = false) {
    if (this.functions.has(func)) this.functions.delete(func);
    this.functions.set(func, filter);

    if (mutationManager.listeners.has(this._onNewPosts)) mutationManager.trigger(this._onNewPosts);
    else (mutationManager.start(postSelector, this._onNewPosts));
  },

  /**
   * Stop a mutation callback
   * @param {Function} func - Function to remove
   */
  stop(func) {
    this.functions.delete(func);
    mutationManager.stop(func)
  }
});