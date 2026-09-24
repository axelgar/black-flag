// The one door to Google Tag Manager. Everything is a push onto dataLayer; GTM decides
// what becomes a GA4 event. Nothing here throws — a blocked tag script must never take
// the game down with it.

type Layer = Record<string, unknown>[];
const layer = (): Layer => {
  const w = window as unknown as { dataLayer?: Layer };
  return (w.dataLayer = w.dataLayer || []);
};

/** Push a named event with a flat bag of params. Safe to call before GTM has loaded. */
export function track(event: string, params: Record<string, unknown> = {}) {
  try { layer().push({ event, ...params }); } catch { /* ad blocker, private mode, whatever */ }
}

/** A hash route is one page to GA4, so screens are reported by hand. */
export const screen = (path: string) => track('screen_view', { screen_name: path.replace(/^\/unlock\/.*/, '/unlock') });
