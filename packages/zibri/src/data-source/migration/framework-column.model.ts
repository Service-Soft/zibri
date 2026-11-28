import { type BaseEntity } from '../../entity/base-entity.model';
import { type Newable } from '../../types/newable.type';

/**
 * A column a release added to an entity of the framework, which a data source managed by migrations adds to the table
 * itself, so that an application writes no migration of its own for it.
 */
export type FrameworkColumn = {
    /**
     * The entity, or a class of the application extending it.
     */
    entity: Newable<BaseEntity>,
    /**
     * The property, which the entity declares as not required: the rows stored before it hold none.
     */
    property: string,
    /**
     * What the rows stored before the column hold, once it is added. Empty without it, or when it resolves to
     * undefined.
     */
    storedValue?: () => string | undefined,
    /**
     * Whether a value says what a row without the column says, such as `'person'` for the kind of a user. A table
     * lacking the column, with `schemaManagement: 'external'`, takes such a value as written and stores nothing,
     * and refuses any other. Undefined and null alone without it.
     */
    meansAbsent?: (value: unknown) => boolean
};