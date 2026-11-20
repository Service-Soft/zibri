/**
 * When the account and the membership of an invitation are created: `'invite'` right away, so an administrator
 * manages them before the invited person reacts, or `'accept'` once they accept, so nobody gets an account or a
 * membership they never agreed to.
 */
export type InvitationCreateOn = 'invite' | 'accept';