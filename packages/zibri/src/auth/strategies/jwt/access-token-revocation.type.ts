/**
 * When an access token stops working once what it was issued for has ended: a logout, ended logins, a
 * revoked api key, or the token itself revoked.
 *
 * - `onExpiry`: when it expires. Checking a token reads nothing to find out.
 * - `immediately`: at once. Checking a token reads whether its login or its client still exists.
 */
export type AccessTokenRevocation = 'onExpiry' | 'immediately';