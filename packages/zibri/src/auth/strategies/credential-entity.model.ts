import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * A row that belongs to a user.
 */
type UserRow = BaseEntity & {
    /**
     * The user the row belongs to.
     */
    userId: string
};

/**
 * An entity whose rows the credentials of an auth strategy are checked against, and the write to one
 * of them that ends what a credential authenticates.
 *
 * A websocket connection that connected with such a credential is checked again once that write is
 * committed, however it was made, and closed when its credential no longer resolves to its user.
 */
export type CredentialEntity = {
    /**
     * The entity. Each row names the user it belongs to.
     */
    entityClass: Newable<UserRow>,
    /**
     * `'remove'` when removing a row ends the logins or keys it holds, such as a session or a refresh
     * token. `'insert'` when inserting one ends a credential, such as a revoked token.
     */
    endedBy: 'remove' | 'insert'
};