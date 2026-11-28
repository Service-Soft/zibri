/**
 * Whether a login by a link sent by email asks for a second factor once the link was accepted.
 *
 * - `twoFactorAtLogin`: as `twoFactorAtLogin` of the application says, like a login with a password. Codes by email
 * do not count as its second factor: the link proved the same mailbox.
 * - `none`: a login by a link is complete on its own.
 */
export type LoginLinkSecondFactor = 'twoFactorAtLogin' | 'none';