browser.runtime.onInstalled.addListener(async details => {
  console.info(details);

  if (details.reason === 'install') {
    import(browser.runtime.getURL('/scripts/utils/jsTools.js')).then(({ importFeatures, featureify }) => {
      let installedFeatures, preferences;

      const setupFeatures = async () => {
        installedFeatures = await importFeatures();
        preferences = featureify(installedFeatures, preferences);
        browser.storage.local.set({ preferences });
        console.log(preferences);
      };

      setupFeatures().then(() => browser.tabs.create({ url: '../ui/permissions.html' }));
    });
  } else if (details.reason === 'update') {
    console.log('Updated!');
  }
});

let connectionPort;

const injectFunction = async ({ hash, files }, target) => {
  console.log('[InjectFunction] Data:', { hash, files, target });
  const iResults = await browser.scripting.executeScript({ files, target, world: 'MAIN' });
  console.log('[InjectFunction] Results:', iResults);
  connectionPort.postMessage({ hash, results: iResults.map(({ result }) => result) });
}; // Can't return Function objects, but it's worth looking into using browser.runtime.getBackgroundPage() for higher-level communication if the need arises

const connected = p => {
  connectionPort = p;
  connectionPort.onMessage.addListener((m, { sender }) => {
    console.info('[Messaging]', m, sender)
    if (m.action === 'inject') injectFunction(m.data, { tabId: sender.tab.id });
  });
};

browser.runtime.onConnect.addListener(connected);

browser.runtime.onSuspend.addListener(() => { console.log("Unloading."); });

browser.runtime.onMessage.addListener(message => {
  if (message && message.type === "open_url"){
    const url = message.url;
    if(url){
      browser.tabs.create({url: url});
    }
  }
});