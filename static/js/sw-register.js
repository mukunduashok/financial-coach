// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/js/sw.js").catch(() => {});
}
