/**
 * Which tenant the rows of an entity belong to.
 *
 * `'shared'` for an entity whose rows belong to no tenant - users, sessions, keys, anything the whole
 * application shares. Otherwise the string property holding the tenant each row belongs to: every
 * read and write is narrowed to the active tenant by it, and `unscoped` does not lift that.
 *
 * The property's own `required` decides whether every row needs a tenant. A property that is not
 * required makes a row without a tenant one that every tenant sees.
 */
export type EntityTenant<TKey extends string = string> = 'shared' | {
    /**
     * The string property holding the id of the tenant a row belongs to.
     */
    property: TKey
};