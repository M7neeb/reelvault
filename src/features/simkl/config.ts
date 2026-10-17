/**
 * Simkl app configuration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO GET A client_id
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Go to https://simkl.com/settings/developer/  (free, instant, no approval)
 * 2. Create a new app and choose the client type **"Mobile, desktop & browser apps"**.
 * 3. Copy the `client_id` it gives you and paste it below.
 *
 * WHY THAT TYPE — and why it matters:
 *   The client type is FIXED AT REGISTRATION and cannot be changed. Correcting it
 *   means registering a whole new app. There are three:
 *
 *     | Type                              | secret | redirect URI | OAuth | Device/PIN |
 *     |-----------------------------------|--------|--------------|-------|------------|
 *     | Mobile, desktop & browser apps    | no     | required     | yes   | yes        |
 *     | TV, devices & command line        | no     | none         | NO    | yes        |
 *     | Server apps & services            | YES    | required     | yes   | yes        |
 *
 *   "Mobile, desktop & browser apps" is the one that supports BOTH flows, which
 *   is exactly what this app needs:
 *     - right now, in Expo Go, a custom URL scheme (`reelvault://`) cannot be
 *       redirected to, so we use the Device/PIN flow;
 *     - once there is a real build, we can add the OAuth + PKCE flow without
 *       re-registering anything.
 *
 *   No client_secret is minted for this type, so there is no secret to leak.
 *
 * IS IT SAFE TO COMMIT THE client_id?  Yes. Under AUTH V2 it is public and
 * reaches nothing user-specific on its own. Only the secret and the user tokens
 * need protecting, and those live in expo-secure-store, never in git.
 */

/** Public. Safe to commit. A build-time EXPO_PUBLIC_SIMKL_CLIENT_ID overrides it. */
export const SIMKL_CLIENT_ID =
  process.env.EXPO_PUBLIC_SIMKL_CLIENT_ID || '7744eae2e1ba22d5e593c3db62542a2ada39ddb7a269854d2e01bba6af1fe2ca';

/**
 * Ask for write scope up front.
 *
 * Omitting `scope` silently gives read-only, and widening later means sending the
 * user through consent a second time. An *unrecognised* scope string is also
 * silently downgraded to read-only rather than rejected - so a typo here produces
 * a token that works fine until the first write, then 403s.
 */
export const SIMKL_SCOPE = 'media:read media:write';

/** Simkl asks for an identifying User-Agent on auth requests. */
export const SIMKL_USER_AGENT = 'reelvault/1.1 (personal app)';

/** The API host is `api.simkl.com` even though the docs live on `api.simkl.org`. */
export const SIMKL_API = 'https://api.simkl.com';

/** Where the user approves the code. */
export const SIMKL_PIN_PAGE = 'https://simkl.com/pin';

export const hasSimklClientId = () => SIMKL_CLIENT_ID.trim().length > 0;
