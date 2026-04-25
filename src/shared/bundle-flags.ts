const falseValues = new Set(["0", "false", "off", "no"]);

function enabled(name: string, fallback: boolean): boolean {
  const value = typeof process === "undefined" ? undefined : process.env[name];
  if (value === undefined) return fallback;
  return !falseValues.has(value.toLowerCase());
}

export const bundleFlags = {
  online: enabled("GAMES_BUNDLE_ONLINE", true),
  pwa: enabled("GAMES_BUNDLE_PWA", true),
  staticLite: enabled("GAMES_BUNDLE_STATIC_LITE", false),
} as const;

export function onlineFeaturesEnabled(): boolean {
  return bundleFlags.online && !bundleFlags.staticLite;
}

export function pwaFeaturesEnabled(): boolean {
  return bundleFlags.pwa && !bundleFlags.staticLite;
}
