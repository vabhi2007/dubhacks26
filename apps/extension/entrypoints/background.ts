// Owner: C. Toolbar click opens the side panel; Alt+Shift+S captures the visible tab and hands it to the panel.
// TODO(C): region-select overlay (content script) before capture; video-frame snap.
export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== "snap" || !tab?.windowId) return;
    await browser.sidePanel.open({ windowId: tab.windowId });
    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 90 });
    await browser.storage.session.set({ pendingSnap: { dataUrl, pageUrl: tab.url, at: Date.now() } });
  });
});
