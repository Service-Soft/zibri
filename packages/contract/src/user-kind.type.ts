/**
 * Who a user is: `'person'`, who logs in, or `'service'`, a service account acting through its API keys and the
 * access tokens they are exchanged for, which never logs in.
 */
export type UserKind = 'person' | 'service';