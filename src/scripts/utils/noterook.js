// xray magic ALL the way down

const _handler = {
  get(target, prop, rec) {
    if (typeof target[prop] === 'function') {
      if (target[prop].constructor.name === 'AsyncFunction') {
        return async function (...args) {
          return target[prop].apply(rec, window.structuredClone(args));
        }
      } else {
        return function (...args) {
          return target[prop].apply(rec, window.structuredClone(args));
        }
      }
    } else return target[prop];
  }
};

const _shadow = {};

const NR = new Proxy(_shadow, {
  get(_, prop) {
    return async function () {
      await window.wrappedJSObject[`P_TF${prop}`];
      const _prop = window.wrappedJSObject[`TF${prop}`];
      return new Proxy(_prop, _handler);
    }
  }
});

export default NR;