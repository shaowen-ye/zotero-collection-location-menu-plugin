CollectionLocationMenuPlugin = {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,
  windowStates: new WeakMap(),
  config: {
    menuID: "collection-location-menu-itemmenu",
    popupID: "collection-location-menu-itemmenu-popup",
    menuLabel: "所在文件夹",
    batchMenuLabel: "所在文件夹（批量）",
    noCollectionsLabel: "未加入任何文件夹",
    collectionLabelPrefix: "📁 ",
    revealLabel: "跳转到这里",
    batchRevealLabel: "跳转并选中这些条目",
    removeFromCollectionLabel: "从此文件夹移除...",
    batchRemoveFromCollectionLabel: "从此文件夹移除这些条目...",
    keepOnlyCollectionLabel: "只保留这个文件夹...",
    batchKeepOnlyCollectionLabel: "只保留这个文件夹给这些条目...",
    removeAllCollectionsLabel: "从所有文件夹移除...",
    batchRemoveAllCollectionsLabel: "从所选条目的所有文件夹移除...",
    openBatchManagerLabel: "打开批量管理器...",
    batchSummaryLabel: "查看位置汇总...",
    pathSeparator: " / ",
    unnamedCollectionLabel: "未命名文件夹"
  },

  init({ id, version, rootURI }) {
    if (this.initialized) {
      return;
    }
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.initialized = true;
  },

  log(message) {
    Zotero.debug(`Collection Location Menu: ${message}`);
  },

  addToAllWindows() {
    for (const window of Zotero.getMainWindows()) {
      if (!window.ZoteroPane) {
        continue;
      }
      this.addToWindow(window);
    }
  },

  removeFromAllWindows() {
    for (const window of Zotero.getMainWindows()) {
      if (!window.ZoteroPane) {
        continue;
      }
      this.removeFromWindow(window);
    }
  },

  addToWindow(window) {
    if (this.windowStates.has(window)) {
      return;
    }

    const document = window.document;
    const itemMenuPopup = document.querySelector("#zotero-itemmenu");
    if (!itemMenuPopup) {
      this.log("Zotero item context menu was not found");
      return;
    }

    const menu = this.createXULElement(document, "menu");
    menu.setAttribute("id", this.config.menuID);
    menu.setAttribute("label", this.config.menuLabel);
    menu.hidden = true;

    const menuPopup = this.createXULElement(document, "menupopup");
    menuPopup.setAttribute("id", this.config.popupID);
    menu.appendChild(menuPopup);

    const state = {
      itemMenuPopup,
      menu,
      menuPopup,
      onPopupShowing: null,
      batchManager: null
    };

    const plugin = this;
    state.onPopupShowing = function (event) {
      if (event.target !== itemMenuPopup) {
        return;
      }
      plugin.refreshMenu(window, state);
    };

    itemMenuPopup.addEventListener("popupshowing", state.onPopupShowing);
    itemMenuPopup.appendChild(menu);
    this.windowStates.set(window, state);
  },

  removeFromWindow(window) {
    const state = this.windowStates.get(window);
    if (!state) {
      return;
    }

    if (state.itemMenuPopup && state.onPopupShowing) {
      state.itemMenuPopup.removeEventListener("popupshowing", state.onPopupShowing);
    }

    if (state.menu) {
      state.menu.remove();
    }

    if (state.batchManager && state.batchManager.overlay) {
      state.batchManager.overlay.remove();
    }

    this.windowStates.delete(window);
  },

  createXULElement(document, tagName) {
    if (typeof document.createXULElement === "function") {
      return document.createXULElement(tagName);
    }
    return document.createElement(tagName);
  },

  createHTMLElement(document, tagName) {
    return document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
  },

  clearElement(element) {
    while (element.firstChild) {
      element.firstChild.remove();
    }
  },

  refreshMenu(window, state) {
    const items = this.getSelectedTopLevelRegularItems(window);
    this.clearElement(state.menuPopup);

    if (!items.length) {
      state.menu.hidden = true;
      return;
    }

    state.menu.hidden = false;
    if (items.length === 1) {
      state.menu.setAttribute("label", this.config.menuLabel);
      this.refreshSingleItemMenu(window, state, items[0]);
      return;
    }

    state.menu.setAttribute("label", `${this.config.batchMenuLabel}：${items.length} 项`);
    this.refreshBatchMenu(window, state, items);
  },

  refreshSingleItemMenu(window, state, item) {
    const locations = this.getItemCollectionLocations(item);

    if (!locations.length) {
      const emptyItem = this.createXULElement(window.document, "menuitem");
      emptyItem.setAttribute("label", this.config.noCollectionsLabel);
      emptyItem.setAttribute("disabled", "true");
      state.menuPopup.appendChild(emptyItem);
      return;
    }

    for (const location of locations) {
      const locationMenu = this.createXULElement(window.document, "menu");
      locationMenu.setAttribute("label", `${this.config.collectionLabelPrefix}${location.path}`);
      locationMenu.setAttribute("tooltiptext", location.path);

      const locationPopup = this.createXULElement(window.document, "menupopup");
      locationMenu.appendChild(locationPopup);

      this.appendMenuItem(window.document, locationPopup, this.config.revealLabel, (event) => {
        event.stopPropagation();
        this.revealItemInCollection(window, item.id, location.collectionID);
      });

      this.appendSeparator(window.document, locationPopup);

      this.appendMenuItem(window.document, locationPopup, this.config.removeFromCollectionLabel, (event) => {
        event.stopPropagation();
        this.removeItemFromCollection(window, item.id, location.collectionID, location.path);
      });

      this.appendMenuItem(window.document, locationPopup, this.config.keepOnlyCollectionLabel, (event) => {
        event.stopPropagation();
        this.keepItemOnlyInCollection(window, item.id, location.collectionID, location.path);
      }, {
        disabled: locations.length <= 1
      });

      state.menuPopup.appendChild(locationMenu);
    }

    this.appendSeparator(window.document, state.menuPopup);
    this.appendMenuItem(window.document, state.menuPopup, this.config.removeAllCollectionsLabel, (event) => {
      event.stopPropagation();
      this.removeItemFromAllCollections(window, item.id, locations);
    });
  },

  refreshBatchMenu(window, state, items) {
    const batchHeader = this.createXULElement(window.document, "menuitem");
    batchHeader.setAttribute("label", `批量整理：${items.length} 个顶层文献条目`);
    batchHeader.setAttribute("disabled", "true");
    state.menuPopup.appendChild(batchHeader);

    this.appendMenuItem(window.document, state.menuPopup, this.config.openBatchManagerLabel, (event) => {
      event.stopPropagation();
      this.openBatchManager(window, items);
    });
  },

  appendMenuItem(document, parent, label, command, options = {}) {
    const menuItem = this.createXULElement(document, "menuitem");
    menuItem.setAttribute("label", label);
    if (options.disabled) {
      menuItem.setAttribute("disabled", "true");
    } else {
      menuItem.addEventListener("command", command);
    }
    parent.appendChild(menuItem);
    return menuItem;
  },

  appendSeparator(document, parent) {
    const separator = this.createXULElement(document, "menuseparator");
    parent.appendChild(separator);
    return separator;
  },

  getSelectedTopLevelRegularItems(window) {
    const candidates = [];
    const pushItems = (values) => {
      if (!Array.isArray(values)) {
        return;
      }
      for (const value of values) {
        if (value && typeof value === "object") {
          candidates.push(value);
        }
      }
    };

    const readSelection = (label, callback) => {
      try {
        pushItems(callback());
      } catch (error) {
        this.log(`Unable to read selected items via ${label}: ${error}`);
      }
    };

    readSelection("ZoteroPane.getSelectedObjects", () => window.ZoteroPane.getSelectedObjects());
    readSelection("ZoteroPane.getSelectedItems", () => window.ZoteroPane.getSelectedItems());

    if (window.ZoteroPane.itemsView) {
      readSelection("itemsView.getSelectedObjects", () => window.ZoteroPane.itemsView.getSelectedObjects());
      readSelection("itemsView.getSelectedItems", () => window.ZoteroPane.itemsView.getSelectedItems());

      const selection = window.ZoteroPane.itemsView.selection;
      if (selection && selection.selected && typeof window.ZoteroPane.itemsView.getRow === "function") {
        readSelection("itemsView.selection.selected", () => {
          const values = [];
          for (const index of selection.selected) {
            const row = window.ZoteroPane.itemsView.getRow(index);
            if (row && row.ref) {
              values.push(row.ref);
            }
          }
          return values;
        });
      }
    }

    const selectedItems = [];
    const seenItemIDs = new Set();

    for (const item of candidates) {
      if (!item || typeof item.isRegularItem !== "function" || typeof item.isTopLevelItem !== "function") {
        continue;
      }
      if (!item.isRegularItem() || !item.isTopLevelItem()) {
        continue;
      }
      if (seenItemIDs.has(item.id)) {
        continue;
      }
      seenItemIDs.add(item.id);
      selectedItems.push(item);
    }

    return selectedItems;
  },

  getItemCollectionLocations(item) {
    const collectionIDs = [...new Set(item.getCollections() || [])];
    const locations = [];

    for (const collectionID of collectionIDs) {
      const location = this.createCollectionLocation(collectionID);
      if (location) {
        locations.push(location);
      }
    }

    return locations.sort((left, right) => left.path.localeCompare(right.path));
  },

  getBatchCollectionLocations(items) {
    const byCollectionID = new Map();
    let unfiledCount = 0;

    for (const item of items) {
      const collectionIDs = [...new Set(item.getCollections() || [])];
      if (!collectionIDs.length) {
        unfiledCount += 1;
        continue;
      }

      for (const collectionID of collectionIDs) {
        const location = this.createCollectionLocation(collectionID);
        if (!location) {
          continue;
        }

        if (!byCollectionID.has(collectionID)) {
          byCollectionID.set(collectionID, {
            collectionID,
            path: location.path,
            itemIDs: []
          });
        }
        byCollectionID.get(collectionID).itemIDs.push(item.id);
      }
    }

    return {
      itemCount: items.length,
      unfiledCount,
      locations: [...byCollectionID.values()].sort((left, right) => left.path.localeCompare(right.path))
    };
  },

  createCollectionLocation(collectionID) {
    const collection = Zotero.Collections.get(collectionID);
    if (!collection || collection.deleted) {
      return null;
    }

    const names = [];
    const seen = new Set();
    let current = collection;

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name || this.config.unnamedCollectionLabel);

      if (!current.parentID) {
        break;
      }

      current = Zotero.Collections.get(current.parentID);
      if (current && current.deleted) {
        break;
      }
    }

    return {
      collectionID: collection.id,
      path: names.join(this.config.pathSeparator)
    };
  },

  async revealItemInCollection(window, itemID, collectionID) {
    try {
      const collection = Zotero.Collections.get(collectionID);
      if (!collection || collection.deleted) {
        throw new Error(`Collection ${collectionID} is unavailable`);
      }

      if (!window.ZoteroPane || !window.ZoteroPane.collectionsView) {
        throw new Error("ZoteroPane collections view is unavailable");
      }

      const selected = await window.ZoteroPane.collectionsView.selectCollection(collectionID);
      if (!selected) {
        throw new Error(`Could not select collection ${collectionID}`);
      }

      if (window.ZoteroPane.itemsView && typeof window.ZoteroPane.itemsView.waitForLoad === "function") {
        await window.ZoteroPane.itemsView.waitForLoad();
      }

      await window.ZoteroPane.selectItem(itemID);
    } catch (error) {
      Zotero.logError(error);
      this.log(`Failed to reveal item ${itemID} in collection ${collectionID}: ${error}`);
      Zotero.alert(
        window,
        "无法跳转到该文件夹",
        "无法跳转到该文件夹，可能已被删除或当前视图尚未加载。"
      );
    }
  },

  async revealItemsInCollection(window, itemIDs, collectionID) {
    try {
      const collection = Zotero.Collections.get(collectionID);
      if (!collection || collection.deleted) {
        throw new Error(`Collection ${collectionID} is unavailable`);
      }

      if (!window.ZoteroPane || !window.ZoteroPane.collectionsView) {
        throw new Error("ZoteroPane collections view is unavailable");
      }

      const selected = await window.ZoteroPane.collectionsView.selectCollection(collectionID);
      if (!selected) {
        throw new Error(`Could not select collection ${collectionID}`);
      }

      if (window.ZoteroPane.itemsView && typeof window.ZoteroPane.itemsView.waitForLoad === "function") {
        await window.ZoteroPane.itemsView.waitForLoad();
      }

      await window.ZoteroPane.selectItems(itemIDs);
    } catch (error) {
      Zotero.logError(error);
      this.log(`Failed to reveal items in collection ${collectionID}: ${error}`);
      Zotero.alert(
        window,
        "无法跳转到该文件夹",
        "无法跳转到该文件夹，可能已被删除或当前视图尚未加载。"
      );
    }
  },

  showBatchLocationSummary(window, items, summary) {
    const lines = [
      `已选择条目：${items.length}`,
      `涉及文件夹：${summary.locations.length}`,
      `未加入任何文件夹：${summary.unfiledCount}`
    ];

    if (summary.locations.length) {
      lines.push("");
      lines.push("文件夹位置：");
      for (const location of summary.locations.slice(0, 30)) {
        lines.push(`${location.itemIDs.length} 项 :: ${location.path}`);
      }
      if (summary.locations.length > 30) {
        lines.push(`……还有 ${summary.locations.length - 30} 个文件夹`);
      }
    }

    Zotero.alert(window, "所在文件夹汇总", lines.join("\n"));
  },

  openBatchManager(window, items) {
    const state = this.windowStates.get(window);
    if (!state) {
      return;
    }

    if (state.batchManager && state.batchManager.overlay) {
      state.batchManager.overlay.remove();
    }

    const itemIDs = [...new Set(items.map((item) => item.id))];
    const manager = {
      itemIDs,
      checkedItemIDs: new Set(itemIDs),
      statusText: "",
      overlay: this.createHTMLElement(window.document, "div")
    };

    manager.overlay.setAttribute("class", "clm-manager-overlay");
    manager.overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.closeBatchManager(window);
      }
    });

    state.batchManager = manager;
    window.document.documentElement.appendChild(manager.overlay);
    this.renderBatchManager(window, manager);
    window.setTimeout(() => {
      const firstCheckbox = manager.overlay.querySelector("input[type='checkbox']");
      if (firstCheckbox) {
        firstCheckbox.focus();
      }
    }, 0);
  },

  closeBatchManager(window) {
    const state = this.windowStates.get(window);
    if (!state || !state.batchManager) {
      return;
    }
    if (state.batchManager.overlay) {
      state.batchManager.overlay.remove();
    }
    state.batchManager = null;
  },

  refreshBatchManager(window, manager, statusText) {
    manager.statusText = statusText || "";
    this.renderBatchManager(window, manager);
  },

  renderBatchManager(window, manager) {
    const document = window.document;
    this.clearElement(manager.overlay);
    this.appendBatchManagerStyles(document, manager.overlay);

    const data = this.getBatchManagerData(manager.itemIDs);
    manager.itemIDs = data.items.map((entry) => entry.id);
    manager.checkedItemIDs = new Set(
      [...manager.checkedItemIDs].filter((itemID) => manager.itemIDs.includes(itemID))
    );
    if (!manager.checkedItemIDs.size) {
      manager.checkedItemIDs = new Set(manager.itemIDs);
    }

    const panel = this.createHTMLElement(document, "div");
    panel.setAttribute("class", "clm-manager");
    manager.overlay.appendChild(panel);

    const header = this.createHTMLElement(document, "div");
    header.setAttribute("class", "clm-manager-header");
    panel.appendChild(header);

    const titleBox = this.createHTMLElement(document, "div");
    header.appendChild(titleBox);

    const title = this.createHTMLElement(document, "div");
    title.setAttribute("class", "clm-manager-title");
    title.textContent = "所在文件夹批量管理器";
    titleBox.appendChild(title);

    const stats = this.createHTMLElement(document, "div");
    stats.setAttribute("class", "clm-manager-stats");
    stats.textContent = `顶层文献 ${data.items.length} 项，涉及文件夹 ${data.locations.length} 个，未加入任何文件夹 ${data.unfiledCount} 项`;
    titleBox.appendChild(stats);

    const closeButton = this.createHTMLElement(document, "button");
    closeButton.setAttribute("type", "button");
    closeButton.setAttribute("class", "clm-icon-button");
    closeButton.textContent = "关闭";
    closeButton.addEventListener("click", () => this.closeBatchManager(window));
    header.appendChild(closeButton);

    const toolbar = this.createHTMLElement(document, "div");
    toolbar.setAttribute("class", "clm-manager-toolbar");
    panel.appendChild(toolbar);

    const selectAllButton = this.createHTMLElement(document, "button");
    selectAllButton.setAttribute("type", "button");
    selectAllButton.textContent = "全选";
    selectAllButton.addEventListener("click", () => {
      manager.checkedItemIDs = new Set(manager.itemIDs);
      this.renderBatchManager(window, manager);
    });
    toolbar.appendChild(selectAllButton);

    const selectNoneButton = this.createHTMLElement(document, "button");
    selectNoneButton.setAttribute("type", "button");
    selectNoneButton.textContent = "全不选";
    selectNoneButton.addEventListener("click", () => {
      manager.checkedItemIDs = new Set();
      this.renderBatchManager(window, manager);
    });
    toolbar.appendChild(selectNoneButton);

    const targetSelect = this.createHTMLElement(document, "select");
    const emptyOption = this.createHTMLElement(document, "option");
    emptyOption.setAttribute("value", "");
    emptyOption.textContent = "选择一个文件夹位置";
    targetSelect.appendChild(emptyOption);
    for (const location of data.locations) {
      const option = this.createHTMLElement(document, "option");
      option.setAttribute("value", String(location.collectionID));
      option.textContent = `${location.path}（${location.itemIDs.length} 项）`;
      targetSelect.appendChild(option);
    }
    toolbar.appendChild(targetSelect);

    const targetCount = this.createHTMLElement(document, "span");
    targetCount.setAttribute("class", "clm-muted");
    toolbar.appendChild(targetCount);

    const tableWrap = this.createHTMLElement(document, "div");
    tableWrap.setAttribute("class", "clm-table-wrap");
    panel.appendChild(tableWrap);

    const table = this.createHTMLElement(document, "table");
    table.setAttribute("class", "clm-table");
    tableWrap.appendChild(table);

    const thead = this.createHTMLElement(document, "thead");
    table.appendChild(thead);
    const headerRow = this.createHTMLElement(document, "tr");
    thead.appendChild(headerRow);
    for (const label of ["", "标题", "文件夹位置"]) {
      const th = this.createHTMLElement(document, "th");
      th.textContent = label;
      headerRow.appendChild(th);
    }

    const tbody = this.createHTMLElement(document, "tbody");
    table.appendChild(tbody);
    for (const entry of data.items) {
      const row = this.createHTMLElement(document, "tr");
      tbody.appendChild(row);

      const checkCell = this.createHTMLElement(document, "td");
      row.appendChild(checkCell);
      const checkbox = this.createHTMLElement(document, "input");
      checkbox.setAttribute("type", "checkbox");
      checkbox.checked = manager.checkedItemIDs.has(entry.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          manager.checkedItemIDs.add(entry.id);
        } else {
          manager.checkedItemIDs.delete(entry.id);
        }
        updateActionState();
      });
      checkCell.appendChild(checkbox);

      const titleCell = this.createHTMLElement(document, "td");
      titleCell.textContent = entry.title;
      row.appendChild(titleCell);

      const locationsCell = this.createHTMLElement(document, "td");
      if (entry.locations.length) {
        locationsCell.textContent = entry.locations.map((location) => location.path).join("；");
      } else {
        locationsCell.textContent = this.config.noCollectionsLabel;
        locationsCell.setAttribute("class", "clm-muted");
      }
      row.appendChild(locationsCell);
    }

    const actions = this.createHTMLElement(document, "div");
    actions.setAttribute("class", "clm-manager-actions");
    panel.appendChild(actions);

    const revealButton = this.createHTMLElement(document, "button");
    revealButton.setAttribute("type", "button");
    revealButton.textContent = "跳转并选中";
    actions.appendChild(revealButton);

    const removeButton = this.createHTMLElement(document, "button");
    removeButton.setAttribute("type", "button");
    removeButton.textContent = "从选定文件夹移除";
    actions.appendChild(removeButton);

    const keepOnlyButton = this.createHTMLElement(document, "button");
    keepOnlyButton.setAttribute("type", "button");
    keepOnlyButton.textContent = "只保留选定文件夹";
    actions.appendChild(keepOnlyButton);

    const removeAllButton = this.createHTMLElement(document, "button");
    removeAllButton.setAttribute("type", "button");
    removeAllButton.textContent = "从所有文件夹移除";
    actions.appendChild(removeAllButton);

    const status = this.createHTMLElement(document, "div");
    status.setAttribute("class", "clm-manager-status");
    status.textContent = manager.statusText;
    panel.appendChild(status);

    const getSelectedItemIDs = () => [...manager.checkedItemIDs].filter((itemID) => manager.itemIDs.includes(itemID));
    const getTargetLocation = () => {
      const collectionID = Number(targetSelect.value);
      return data.locations.find((location) => location.collectionID === collectionID) || null;
    };
    const getTargetItemIDs = () => {
      const selectedIDs = new Set(getSelectedItemIDs());
      const targetLocation = getTargetLocation();
      if (!targetLocation) {
        return [];
      }
      return targetLocation.itemIDs.filter((itemID) => selectedIDs.has(itemID));
    };
    const updateActionState = () => {
      const selectedIDs = getSelectedItemIDs();
      const targetItemIDs = getTargetItemIDs();
      targetCount.textContent = targetSelect.value
        ? `选中条目中有 ${targetItemIDs.length} 项位于该文件夹`
        : `已勾选 ${selectedIDs.length} 项`;
      revealButton.disabled = !targetItemIDs.length;
      removeButton.disabled = !targetItemIDs.length;
      keepOnlyButton.disabled = !targetItemIDs.length;
      removeAllButton.disabled = !selectedIDs.length;
    };

    targetSelect.addEventListener("change", updateActionState);
    revealButton.addEventListener("click", () => {
      const targetLocation = getTargetLocation();
      const targetItemIDs = getTargetItemIDs();
      if (targetLocation && targetItemIDs.length) {
        this.revealItemsInCollection(window, targetItemIDs, targetLocation.collectionID);
      }
    });
    removeButton.addEventListener("click", async () => {
      const targetLocation = getTargetLocation();
      const targetItemIDs = getTargetItemIDs();
      if (!targetLocation || !targetItemIDs.length) {
        return;
      }
      const result = await this.applyRemoveItemsFromCollection(window, targetItemIDs, targetLocation.collectionID, targetLocation.path);
      if (result) {
        this.refreshBatchManager(window, manager, this.formatBatchOperationResult("从选定文件夹移除完成", result));
      }
    });
    keepOnlyButton.addEventListener("click", async () => {
      const targetLocation = getTargetLocation();
      const targetItemIDs = getTargetItemIDs();
      if (!targetLocation || !targetItemIDs.length) {
        return;
      }
      const result = await this.applyKeepItemsOnlyInCollection(window, targetItemIDs, targetLocation.collectionID, targetLocation.path);
      if (result) {
        this.refreshBatchManager(window, manager, this.formatBatchOperationResult("只保留选定文件夹完成", result));
      }
    });
    removeAllButton.addEventListener("click", async () => {
      const selectedIDs = getSelectedItemIDs();
      if (!selectedIDs.length) {
        return;
      }
      const result = await this.applyRemoveItemsFromAllCollections(window, selectedIDs, data.locations.length);
      if (result) {
        this.refreshBatchManager(window, manager, this.formatBatchOperationResult("从所有文件夹移除完成", result));
      }
    });

    updateActionState();
  },

  appendBatchManagerStyles(document, parent) {
    const style = this.createHTMLElement(document, "style");
    style.textContent = `
      .clm-manager-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(17, 24, 39, 0.42);
        font: menu;
      }
      .clm-manager {
        width: min(980px, calc(100vw - 64px));
        height: min(720px, calc(100vh - 64px));
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-sizing: border-box;
        padding: 16px;
        border: 1px solid rgba(0, 0, 0, 0.24);
        border-radius: 8px;
        background: -moz-dialog;
        color: -moz-dialogtext;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
      }
      .clm-manager-header,
      .clm-manager-toolbar,
      .clm-manager-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .clm-manager-header {
        justify-content: space-between;
      }
      .clm-manager-title {
        font-size: 18px;
        font-weight: 600;
      }
      .clm-manager-stats,
      .clm-muted {
        color: GrayText;
      }
      .clm-manager-toolbar select {
        flex: 1 1 auto;
        min-width: 260px;
      }
      .clm-table-wrap {
        flex: 1 1 auto;
        overflow: auto;
        border: 1px solid rgba(0, 0, 0, 0.18);
        border-radius: 6px;
        background: Field;
      }
      .clm-table {
        width: 100%;
        border-collapse: collapse;
        color: FieldText;
      }
      .clm-table th,
      .clm-table td {
        padding: 7px 8px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
        text-align: left;
        vertical-align: top;
      }
      .clm-table th:first-child,
      .clm-table td:first-child {
        width: 36px;
        text-align: center;
      }
      .clm-manager-actions {
        justify-content: flex-end;
      }
      .clm-manager-status {
        min-height: 18px;
        color: GrayText;
      }
    `;
    parent.appendChild(style);
  },

  getBatchManagerData(itemIDs) {
    const entries = [];
    const byCollectionID = new Map();
    let unfiledCount = 0;

    for (const itemID of itemIDs) {
      let item;
      try {
        item = this.getFreshTopLevelRegularItem(itemID);
      } catch (error) {
        this.log(`Skipping unavailable item ${itemID}: ${error}`);
        continue;
      }

      const locations = this.getItemCollectionLocations(item);
      if (!locations.length) {
        unfiledCount += 1;
      }

      for (const location of locations) {
        if (!byCollectionID.has(location.collectionID)) {
          byCollectionID.set(location.collectionID, {
            collectionID: location.collectionID,
            path: location.path,
            itemIDs: []
          });
        }
        byCollectionID.get(location.collectionID).itemIDs.push(item.id);
      }

      entries.push({
        id: item.id,
        title: item.getField("title") || "(无标题)",
        locations
      });
    }

    return {
      items: entries.sort((left, right) => left.title.localeCompare(right.title)),
      locations: [...byCollectionID.values()].sort((left, right) => left.path.localeCompare(right.path)),
      unfiledCount
    };
  },

  confirm(window, title, message) {
    if (typeof Services !== "undefined" && Services.prompt) {
      return Services.prompt.confirm(window, title, message);
    }
    return window.confirm(`${title}\n\n${message}`);
  },

  getFreshTopLevelRegularItem(itemID) {
    const item = Zotero.Items.get(itemID);
    if (!item || !item.isRegularItem() || !item.isTopLevelItem()) {
      throw new Error(`Item ${itemID} is unavailable or is not a top-level regular item`);
    }
    return item;
  },

  async revealItemInLibraryRoot(window, itemID) {
    await this.revealItemsInLibraryRoot(window, [itemID]);
  },

  async revealItemsInLibraryRoot(window, itemIDs) {
    if (window.ZoteroPane && typeof window.ZoteroPane.selectItems === "function") {
      await window.ZoteroPane.selectItems(itemIDs, { inLibraryRoot: true });
    }
  },

  async removeItemFromCollection(window, itemID, collectionID, path) {
    const title = "从文件夹移除";
    const message = `将从「${path}」移除此条目。\n\n这只会移除该文件夹中的位置，不会删除文献条目、附件、笔记或其他文件夹中的位置。`;
    if (!this.confirm(window, title, message)) {
      return;
    }

    try {
      const item = this.getFreshTopLevelRegularItem(itemID);
      item.removeFromCollection(collectionID);
      await item.saveTx();
      await this.revealItemInLibraryRoot(window, itemID);
    } catch (error) {
      Zotero.logError(error);
      this.log(`Failed to remove item ${itemID} from collection ${collectionID}: ${error}`);
      Zotero.alert(window, "移除失败", error && error.message ? error.message : String(error));
    }
  },

  async keepItemOnlyInCollection(window, itemID, collectionID, path) {
    let removeCount = 0;
    try {
      const item = this.getFreshTopLevelRegularItem(itemID);
      const currentCollections = [...new Set(item.getCollections() || [])];
      removeCount = currentCollections.filter((id) => id !== collectionID).length;
      if (!removeCount) {
        return;
      }
    } catch (error) {
      Zotero.logError(error);
      Zotero.alert(window, "合并失败", error && error.message ? error.message : String(error));
      return;
    }

    const title = "合并所在文件夹";
    const message = `将只保留「${path}」这个位置，并移除其他 ${removeCount} 个文件夹位置。\n\n这不会删除文献条目、附件或笔记。`;
    if (!this.confirm(window, title, message)) {
      return;
    }

    try {
      const item = this.getFreshTopLevelRegularItem(itemID);
      item.setCollections([collectionID]);
      await item.saveTx();
      await this.revealItemInCollection(window, itemID, collectionID);
    } catch (error) {
      Zotero.logError(error);
      this.log(`Failed to keep item ${itemID} only in collection ${collectionID}: ${error}`);
      Zotero.alert(window, "合并失败", error && error.message ? error.message : String(error));
    }
  },

  async removeItemFromAllCollections(window, itemID, locations) {
    const title = "从所有文件夹移除";
    const message = `将从全部 ${locations.length} 个文件夹中移除此条目。\n\n这会让条目变成“未归档”条目，但不会删除文献条目、附件或笔记。`;
    if (!this.confirm(window, title, message)) {
      return;
    }

    try {
      const item = this.getFreshTopLevelRegularItem(itemID);
      item.setCollections([]);
      await item.saveTx();
      await this.revealItemInLibraryRoot(window, itemID);
    } catch (error) {
      Zotero.logError(error);
      this.log(`Failed to remove item ${itemID} from all collections: ${error}`);
      Zotero.alert(window, "移除失败", error && error.message ? error.message : String(error));
    }
  },

  async applyRemoveItemsFromCollection(window, itemIDs, collectionID, path) {
    const title = "批量从文件夹移除";
    const message = `将从「${path}」移除 ${itemIDs.length} 个勾选条目。\n\n这只会移除这些条目在该文件夹中的位置，不会删除文献条目、附件或笔记。`;
    if (!this.confirm(window, title, message)) {
      return null;
    }

    const result = {
      changed: 0,
      unchanged: 0,
      failed: 0
    };

    for (const itemID of itemIDs) {
      try {
        const item = this.getFreshTopLevelRegularItem(itemID);
        if (!item.getCollections().includes(collectionID)) {
          result.unchanged += 1;
          continue;
        }
        item.removeFromCollection(collectionID);
        await item.saveTx();
        result.changed += 1;
      } catch (error) {
        result.failed += 1;
        Zotero.logError(error);
        this.log(`Failed to remove item ${itemID} from collection ${collectionID}: ${error}`);
      }
    }

    return result;
  },

  async applyKeepItemsOnlyInCollection(window, itemIDs, collectionID, path) {
    const title = "批量合并所在文件夹";
    const message = `将只为这 ${itemIDs.length} 个勾选条目保留「${path}」这个位置，并移除它们的其他文件夹位置。\n\n这不会删除文献条目、附件或笔记。`;
    if (!this.confirm(window, title, message)) {
      return null;
    }

    const result = {
      changed: 0,
      unchanged: 0,
      failed: 0
    };

    for (const itemID of itemIDs) {
      try {
        const item = this.getFreshTopLevelRegularItem(itemID);
        const currentCollections = [...new Set(item.getCollections() || [])];
        if (currentCollections.length === 1 && currentCollections[0] === collectionID) {
          result.unchanged += 1;
          continue;
        }
        item.setCollections([collectionID]);
        await item.saveTx();
        result.changed += 1;
      } catch (error) {
        result.failed += 1;
        Zotero.logError(error);
        this.log(`Failed to keep item ${itemID} only in collection ${collectionID}: ${error}`);
      }
    }

    return result;
  },

  async applyRemoveItemsFromAllCollections(window, itemIDs, locationCount) {
    const title = "批量从所有文件夹移除";
    const message = `将从所有文件夹中移除 ${itemIDs.length} 个勾选条目。\n\n这会让这些条目变成“未归档”条目，但不会删除文献条目、附件或笔记。涉及文件夹：${locationCount} 个。`;
    if (!this.confirm(window, title, message)) {
      return null;
    }

    const result = {
      changed: 0,
      unchanged: 0,
      failed: 0
    };

    for (const itemID of itemIDs) {
      try {
        const item = this.getFreshTopLevelRegularItem(itemID);
        const currentCollections = item.getCollections() || [];
        if (!currentCollections.length) {
          result.unchanged += 1;
          continue;
        }
        item.setCollections([]);
        await item.saveTx();
        result.changed += 1;
      } catch (error) {
        result.failed += 1;
        Zotero.logError(error);
        this.log(`Failed to remove item ${itemID} from all collections: ${error}`);
      }
    }

    return result;
  },

  formatBatchOperationResult(label, result) {
    return `${label}：已修改 ${result.changed}，无需修改 ${result.unchanged}，失败 ${result.failed}`;
  },

  async removeItemsFromCollection(window, itemIDs, collectionID, path) {
    const result = await this.applyRemoveItemsFromCollection(window, itemIDs, collectionID, path);
    if (!result) {
      return;
    }

    await this.revealItemsInLibraryRoot(window, itemIDs);
    this.showBatchOperationSummary(window, "批量移除完成", result);
  },

  async keepItemsOnlyInCollection(window, itemIDs, collectionID, path) {
    const result = await this.applyKeepItemsOnlyInCollection(window, itemIDs, collectionID, path);
    if (!result) {
      return;
    }

    await this.revealItemsInCollection(window, itemIDs, collectionID);
    this.showBatchOperationSummary(window, "批量合并完成", result);
  },

  async removeItemsFromAllCollections(window, itemIDs, locations) {
    const result = await this.applyRemoveItemsFromAllCollections(window, itemIDs, locations.length);
    if (!result) {
      return;
    }

    await this.revealItemsInLibraryRoot(window, itemIDs);
    this.showBatchOperationSummary(window, "批量移除完成", result);
  },

  showBatchOperationSummary(window, title, result) {
    Zotero.alert(
      window,
      title,
      [
        `已修改：${result.changed}`,
        `无需修改：${result.unchanged}`,
        `失败：${result.failed}`
      ].join("\n")
    );
  }
};
