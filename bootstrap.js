var CollectionLocationMenuPlugin;

function log(msg) {
  Zotero.debug("Collection Location Menu: " + msg);
}

function install() {
  log("Installed");
}

async function startup({ id, version, rootURI }) {
  log(`Starting ${version}`);
  Services.scriptloader.loadSubScript(rootURI + "collection-location-menu-plugin.js");
  CollectionLocationMenuPlugin.init({ id, version, rootURI });
  CollectionLocationMenuPlugin.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  CollectionLocationMenuPlugin.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  CollectionLocationMenuPlugin.removeFromWindow(window);
}

function shutdown() {
  log("Shutting down");
  if (CollectionLocationMenuPlugin) {
    CollectionLocationMenuPlugin.removeFromAllWindows();
    CollectionLocationMenuPlugin = undefined;
  }
}

function uninstall() {
  log("Uninstalled");
}
