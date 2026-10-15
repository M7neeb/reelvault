/**
 * Simkl AUTH V2 - shared types.
 *
 * Field names are snake_case here on purpose: these are the exact keys Simkl
 * returns. `repo.ts` translates snake_case to camelCase for the DB layer; this
 * file does the same job for the API boundary.
 */

/** Response from `POST /oauth2/device`. */
export type SimklDeviceStart = {
  device_code: string;
  /** 8 characters, hyphen included (e.g. `BDWP-HQPK`). Not case-sensitive. */
  user_code: string;
  /** `https://simkl.com/pin` - the user types the code by hand. */
  verification_uri: string;
  /** `https://simkl.com/pin?user_code=BDWP-HQPK` - pre-filled. Prefer this one. */
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

/** What `POST /oauth2/token` returns once the user approves. */
export type SimklTokens = {
  access_token: string;
  refresh_token: string;
  scope?: string;
  expires_in?: number;
  token_type?: string;
  /** Added by us: when we stored it, so we can age it without trusting the clock skew. */
  obtained_at: number;
};

/**
 * Simkl's polling errors.
 *
 * Note `invalid_client` is a 401 while the rest are 400s - it means the
 * registration is wrong, not that the user is slow, so retrying cannot fix it.
 */
export type SimklPollError =
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'invalid_client';
