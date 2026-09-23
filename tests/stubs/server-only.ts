/**
 * Stub for the `server-only` marker package.
 *
 * That package deliberately throws unless it is resolved under React's
 * "react-server" condition, which Vitest does not set. Aliasing it here lets
 * server modules be unit tested directly. The real guarantee is unaffected:
 * it comes from the Next.js build, which still fails if a client component
 * imports one of these modules.
 */
export {};
