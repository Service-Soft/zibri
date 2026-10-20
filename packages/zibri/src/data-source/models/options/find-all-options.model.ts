import { BaseRepositoryOptions } from './base-repository-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { EntityOrder } from '../../../entity/models/entity-order.model.ts';
import { EntityRelations, RelationKeysOf } from '../../../entity/models/entity-relations.model.ts';
import { Where } from '../where/where-filter.model.ts';

/**
 * Options for finding multiple entities.
 */
export type FindAllOptions<T extends BaseEntity> = BaseRepositoryOptions
    & {
        /**
         * The order to read the entities in.
         *
         * A property of the entity, or of one it reaches through a relation. Reading part of a
         * result completes whatever is written here by the primary key, so that every row has a
         * position of its own and a later page holds the rows the earlier one did not.
         */
        order?: EntityOrder<T>,
        /**
         * How many entities to pass over before the first one that is returned.
         */
        skip?: number,
        /**
         * How many entities to read at most, or `'all'` for every one that matches.
         *
         * A call that says neither is claiming the result is small enough to hold, and that claim is
         * checked: reading a table that has grown past what the call assumed is refused rather than
         * quietly cut short, because a caller that loops over a trimmed result does part of its work
         * and nothing says so.
         *
         * `'all'` is how a read that means it says so. It is the same unbounded read either way - it
         * is only no longer an accident, and it can be searched for.
         */
        take?: number | 'all',
        /**
         * The where filter to find the options by.
         */
        where?: Where<T>,
        /**
         * The relations to include in the found entities.
         *
         * A relation of a relation is asked for by naming it in turn, `{ album: { artist: true } }`.
         * A relation the filter or the order names is read whether or not it is here, because
         * neither can be answered without it - and it is left off the rows again, so what comes back
         * is what this asked for.
         */
        relations?: EntityRelations<T> | RelationKeysOf<T>[],
        /**
         * Whether encrypted properties are decrypted on the way out. Defaults to true.
         *
         * Set it to false to get the values exactly as they are stored. What that gets you is the
         * envelope - which strategy and key a value was written with, and whether it is bound to its
         * row - none of which survives decryption. That is what makes it possible to ask whether a
         * value is still stored the way it should be, rather than only what it says.
         *
         * The values come back as encryption strings, so anything reading the property as a plain
         * value will be wrong about it. Writing one back through a repository re-encrypts it, which
         * would encrypt the ciphertext a second time.
         */
        autoDecrypt?: boolean
    };