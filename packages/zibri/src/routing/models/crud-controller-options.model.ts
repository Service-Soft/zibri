import { FilterConfig, OrderConfig } from 'zibri-contract';

/**
 * Options for a CRUD controller.
 */
export type CrudControllerOptions<T extends object = object> = {
    /**
     * The largest page `findAll` reads. A larger `limit` is answered with a 400. Defaults to 100.
     */
    maxLimit?: number,
    /**
     * How `findAll` filters, a match for each property of the entity, nested for objects, relations and the items of
     * arrays: `{ title: 'iLike', address: { city: 'equals' } }`. Without one, `findAll` takes no filter.
     */
    filter?: FilterConfig<T>,
    /**
     * The properties `findAll` may be ordered by, nested for objects and relations to one row, or false for none.
     * Defaults to every string, number, boolean and date of the entity and of the objects inside it that holds its
     * value as it is.
     */
    order?: false | OrderConfig<T>
};