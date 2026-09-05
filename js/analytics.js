// The one door to Google Tag Manager. Everything is a push onto dataLayer; GTM decides
// what becomes a GA4 event. Nothing here throws — a blocked tag script must never take
// the game down with it.

const layer = () => (window.dataLayer = window.dataLayer || []);

/** Push a named event with a flat bag of params. Safe to call before GTM has loaded. */
export function track(event, params = {}) {
  try { layer().push({ event, ...params }); } catch { /* ad blocker, private mode, whatever */ }
}

/** A hash route is one page to GA4, so screens are reported by hand. */
export const screen = (path) => track('screen_view', { screen_name: path });
