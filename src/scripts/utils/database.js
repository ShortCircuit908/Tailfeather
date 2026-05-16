const DB_VERSION = 6; // database version
const EXPIRY_TIME = 86400000; // period after which data is considered expired
export const txOptions = { durability: 'relaxed' }; // more performant

const updateEvent = 'tailfeather-database-update';

const conditionalCreateStore = (db, storeName, options) => {
  if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, options);
};
const conditionalDeleteStore = (db, storeName) => {
  if (db.objectStoreNames.contains(storeName)) db.deleteObjectStore(storeName);
};
const conditionalGetIndex = (store, indexName) => {
  let index = null;
  try {
    index = store.index(indexName);
  } catch { void 0; }
  return index
}
const conditionalCreateIndex = (store, indexName, keyPath, options = { unique: false }) => {
  if (!store.indexNames.contains(indexName)) {
    store.createIndex(indexName, keyPath, options);
  }
};
const conditionalDeleteIndex = (store, indexName, condition = true) => {
  if (store.indexNames.contains(indexName) && condition) store.deleteIndex(indexName);
};

export const promisifyIDBRequest = request => new Promise((resolve, reject) => {
  request.onerror = event => reject(event);
  request.onsuccess = () => resolve(request.result);
});

export const openDatabase = async () => new Promise((resolve, reject) => {
  const request = window.indexedDB.open('tailfeather', DB_VERSION);

  request.onerror = event => {
    console.error(`[FDB] Failed to open database version ${DB_VERSION}`, event);
    reject(event);
  };

  request.onupgradeneeded = event => {
    const db = event.target.result;
    const tx = event.target.transaction;

    conditionalCreateStore(db, 'rootStore', { keyPath: 'post_id' });
    conditionalCreateStore(db, 'additionStore', { keyPath: 'addition_id' });
    conditionalCreateStore(db, 'tipStore', { keyPath: 'post_id' });
    conditionalCreateStore(db, 'userStore', { keyPath: 'username' });
    conditionalCreateStore(db, 'userBookStore', { keyPath: 'username' });
    conditionalCreateStore(db, 'searchStore', { keyPath: 'post_id' });

    const rootStore = tx.objectStore('rootStore');
    conditionalCreateIndex(rootStore, 'created_at', 'created_at');
    conditionalCreateIndex(rootStore, 'author', 'author');
    conditionalCreateIndex(rootStore, 'tags', 'tags', { multientry: true });

    const additionStore = tx.objectStore('additionStore');
    conditionalDeleteIndex(additionStore, 'by_post_id', conditionalGetIndex(additionStore, 'by_post_id')?.unique);
    // post_id is *not* unique for all specimens 
    // see: https://noterook.net/book/ceilingmeat/?post=19d1127de81-dfa8ef7cad0ae685
    conditionalCreateIndex(additionStore, 'by_post_id', 'post_id');
    conditionalCreateIndex(additionStore, 'created_at', 'created_at');
    conditionalCreateIndex(additionStore, 'author', 'author');
    conditionalCreateIndex(additionStore, 'tags', 'tags', { multientry: true });

    const tipStore = tx.objectStore('tipStore');
    conditionalCreateIndex(tipStore, 'updated_at', 'updated_at');
    conditionalCreateIndex(tipStore, '_blob_owner', '_blob_owner');
    conditionalCreateIndex(tipStore, 'root_post_id', 'root_post_id'); // not unique because multiple tips can share a root

    const userStore = tx.objectStore('userStore');
    conditionalCreateIndex(userStore, 'display_name', 'display_name');
    conditionalCreateIndex(userStore, 'stored_at', 'stored_at');

    const userBookStore = tx.objectStore('userBookStore');
    conditionalCreateIndex(userBookStore, 'display_name', 'display_name');
    conditionalCreateIndex(userBookStore, 'stored_at', 'stored_at');

    const searchStore = tx.objectStore('searchStore');
    conditionalCreateIndex(searchStore, 'quick_info', 'quick_info');
    conditionalDeleteIndex(searchStore, 'storedAt');
    conditionalCreateIndex(searchStore, 'stored_at', 'stored_at');

    console.info(`[FDB] Updated database from v${event.oldVersion} to v${event.newVersion}`);
    tx.commit();
  };

  request.onsuccess = () => resolve(request.result);
});

const db = await openDatabase();

export const updateNeeded = data => (Date.now() - data.stored_at) > EXPIRY_TIME;

const smartGetData = async (store, data) => {
  let val;
  const key = data[store.keyPath];
  if (!key) {
    const indices = Array.from(store.indexNames).filter(index => index in data);
    if (indices.length) {
      const targetIndex = indices.find(index => store.index(index).unique) || indices[0]; // prioritise unique indices
      val = promisifyIDBRequest(store.index(targetIndex).get(data[targetIndex]));
    } else return void 0;
  } else {
    val = promisifyIDBRequest(store.get(key));
  }
  return val;
};

const dispatchUpdate = (type, targets) => {
  const event = new CustomEvent(updateEvent, {
    detail: { type, targets }
  });
  window.dispatchEvent(event);
};

const txErrorCache = new WeakMap();

const postTransactionHandler = (tx, i) => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onerror = e => {
    if (!txErrorCache.has(i)) {
      txErrorCache.set(i, e);
      console.error('[FDB] Database cache transaction error: ', e, 'Relevant info: ', i);
    }
  };
  tx.onabort = e => {
    console.error('[FDB] Database cache transaction aborted: ', e, 'Relevant info: ', i);
    reject(e);
  }
});

/** caches data into stores, overwriting any existing data tied to those keys (if not an autoincremented store)
 * @param {object} data - object containing key-value pairs of object stores and data to enter into those stores
 * @returns {Promise <void>} fulfils with completion of the transaction
 */
export const cacheData = async dataObj => {
  const dataStores = Object.keys(dataObj);
  const tx = db.transaction(dataStores, 'readwrite', txOptions);
  dataStores.map(dataStore => {
    const store = tx.objectStore(dataStore);
    [dataObj[dataStore]].flat().map(data => {
      data.stored_at = Date.now();
      try {
        store.put(updateData);
      } catch (e) {
        console.error(`[FDB] Failed to cache data in store '${dataStore}':`, data, e);
      }
    });
  });
  dispatchUpdate('cache', dataObj);
  return postTransactionHandler(tx, dataObj);
};

/** updates cached data in stores. stores data by default if it doesn't already exist
 * @param {object} data - object containing key-value pairs of object stores and data to update those stores with
 * @param {object} [options] - object containing key-value pairs of object stores and options objects to use for those stores;
 * @param {string} [options.STORE_NAME.index] - the index to use when updating data
 * @param {boolean} [options.STORE_NAME.updateStrict] - if true, data is only updated if the key is already present in the store
 * @returns {Promise <void>} fulfils with completion of the transaction
 */
export const updateData = (dataObj, options = null) => {
  const dataStores = Object.keys(dataObj);
  const tx = db.transaction(dataStores, 'readwrite', txOptions);
  dataStores.map(dataStore => {
    let storeOptions;
    options && (storeOptions = options[dataStore]);
    const store = tx.objectStore(dataStore);
    [dataObj[dataStore]].flat().map(async data => {
      let updateData;
      const existingData = await smartGetData(store, data);
      if (storeOptions?.updateStrict && typeof existingData === 'undefined') return;
      else if (typeof existingData === 'object') {
        if ('updated_at' in existingData && 'updated_at' in data) {
          if (data.updated_at > existingData.updated_at) updateData = Object.assign(structuredClone(existingData), data);
          else return;
        } else updateData = Object.assign(structuredClone(existingData), data);
      }
      else updateData = data;
      updateData.stored_at = Date.now();

      try {
        store.put(updateData).onerror = function (e) {
          e.preventDefault();
          if (e.target.error.message !== "A request was aborted, for example through a call to IDBTransaction.abort.") console.error('[FDB] put() generated an asyncronous error:', e, updateData, store);
        };
      } catch (e) {
        console.error(`[FDB] Failed to update data in store '${dataStore}':`, data, e);
      }
    });
  });

  dispatchUpdate('update', dataObj);
  return postTransactionHandler(tx, dataObj);
};

/**
 * @param {object} data - object containing key-value pairs of object stores and keys to retrieve from those stores
 * @param {object} [options] - object containing key-value pairs of object stores and options objects to use for those stores;
 * @param {string} [options.STORE_NAME.index] - the index to use when retrieving data
 * @returns {Promise <object>}
 */
export const getData = async (dataObj, options = null) => {
  const dataStores = Object.keys(dataObj);
  const tx = db.transaction(dataStores, 'readonly');
  const returnObj = {};

  await Promise.all(dataStores.map(async dataStore => {
    let storeOptions, index;
    options && (storeOptions = options[dataStore]);
    const store = tx.objectStore(dataStore);
    storeOptions?.index && (index = store.index(storeOptions.index));
    const stored_at = await Promise.all([dataObj[dataStore]].flat().map(async key => {
      if (!key) {
        console.warn('[FDB] getData: key is undefined');
        return void 0;
      }

      try {
        if (index) return promisifyIDBRequest(index.get(key));
        else return promisifyIDBRequest(store.get(key));
      } catch (e) {
        console.error(`[FDB] Failed to get key '${key}' from store '${dataStore}':`, e);
        return null;
      }
    }));
    returnObj[dataStore] = stored_at.map(data => typeof data === 'object' ? structuredClone(Object.assign(data, { expired: updateNeeded(data) })) : structuredClone(data));
  }));

  //await tx.done;
  return returnObj;
};

/**
 * opens an IDBCursor on an object store and returns its contents as an array
 * @param {string} storeName - object store to open a cursor on
 * @param {string|IDBKeyRange} [query] - an index or IDBKeyRange to be queried
 * @returns {Promise <object[]>}
 */
export const getCursor = async (storeName, query = null) => {
  const tx = db.transaction(storeName, 'readwrite');
  const returnData = [];
  let cursor = await promisifyIDBRequest(tx.store.openCursor(query));
  while (cursor) {
    returnData.push(typeof cursor.value === 'object' ? Object.assign(structuredClone(cursor.value), { expired: updateNeeded(cursor.value) }) : structuredClone(cursor.value));
    cursor = await cursor.continue();
  }

  return returnData;
};

/** deletes data from stores
 * @param {object} data - object containing key-value pairs of object stores and keys to delete from those stores
 * @param {object} [options] - object containing key-value pairs of object stores and options objects to use for those stores;
 * @param {string} [options.STORE_NAME.index] - the index to use when deleting data
 * @returns {Promise <void>} fulfils with completion of the transaction
 */
export const clearData = (dataObj, options = null) => {
  const dataStores = Object.keys(dataObj);
  const tx = db.transaction(dataStores, 'readwrite', txOptions);

  Promise.all(dataStores.map(async dataStore => {
    let storeOptions, index;
    options && (storeOptions = options[dataStore]);
    const store = tx.objectStore(dataStore);
    storeOptions && ('index' in storeOptions) && (index = store.index(storeOptions.index));
    return [dataObj[dataStore]].flat().map(async key => {
      if (!key) {
        console.warn('[FDB] clearData: key is undefined');
        return;
      }
      if (index) return promisifyIDBRequest(index.openCursor(key)).then(cursor => promisifyIDBRequest(cursor.delete()));
      else return promisifyIDBRequest(store.delete(key));
    });
  })).then(() => dispatchUpdate('clear', dataObj));

  return postTransactionHandler(tx, dataObj);
};

const resourceQueue = new WeakMap();

/**
 * @param {string} store - single object store to access 
 * @param {Number|string|Array} keys - keys to retrieve from that store
 * @param {object} [options] - options to  use when retrieving keys
 * @param {string} [options.index] - the index to use when retrieving data
 * @returns {Promise <object>}
 */
export const getIndexedResources = async (store, keys, options = null) => {
  const isArray = Array.isArray(keys); // need to save the initial key state before arrayifying it
  if (!isArray) keys = [keys];
  const mapKey = [store, keys, options];

  if (!resourceQueue.has(mapKey)) {
    const indexedResources = await getData(Object.fromEntries([[store, keys]]), Object.fromEntries([[store, options]]));
    if (!indexedResources[store]) console.warn(`[FDB] No indexed resources found in store '${store}':`, Object.entries(indexedResources));
    const data = isArray ? indexedResources[store] : indexedResources[store][0];

    resourceQueue.set(mapKey, data);
  }

  return resourceQueue.get(mapKey);
};

/**
 * @param {Number|Number[]} keys - single username or array of usernames to fetch from the database
 * @returns {Promise <object|object[]>} shallow user(s) - type of return matches type of input
 */
export const getIndexedUsers = async keys => getIndexedResources('userStore', keys);

/**
 * @param {Number|Number[]} keys - single username or array of usernames to fetch from the database
 * @returns {Promise <object|object[]>} user book(s) - type of return matches type of input
 */
export const getIndexedUserBooks = async keys => getIndexedResources('userBookStore', keys);