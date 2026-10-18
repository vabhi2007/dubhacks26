// Owner: C. Toolbar click opens the side panel. Alt+Shift+S opens it and injects the snap overlay (overlay.ts); the
// selection comes back here, we capture the visible tab, and the panel crops to it. Pages the extension can't script
// (chrome://, the Web Store) fall back to capturing the whole tab.
import type { Selection } from "../lib/selection";
import type { CapturedMessage, OverlayMessage } from "./overlay";

export type PendingSnap = { dataUrl: string; pageUrl?: string; at: number; selection?: Selection };

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== "snap" || !tab?.id || !tab.windowId) return;
    await browser.sidePanel.open({ windowId: tab.windowId });
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["/overlay.js"] });
    } catch {
      await capture(tab.windowId, tab.url);
    }
  });

  browser.runtime.onMessage.addListener((msg: OverlayMessage, sender) => {
    const tab = sender.tab;
    if (msg?.type === "alfred:selection" && tab?.windowId)
      void capture(tab.windowId, tab.url, msg.selection).finally(() => {
        // Let the page restore anything it hid for the screenshot (e.g. YouTube's player controls).
        if (tab.id) browser.tabs.sendMessage(tab.id, { type: "alfred:captured" } satisfies CapturedMessage).catch(() => {});
      });
    // "alfred:cancel": nothing was captured; the panel keeps showing whatever it had.
  });
});

async function capture(windowId: number, pageUrl: string | undefined, selection?: Selection) {
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 90 });
  const snap: PendingSnap = { dataUrl, pageUrl, at: Date.now(), ...(selection && { selection }) };
  await browser.storage.session.set({ pendingSnap: snap });
}
