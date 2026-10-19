/**
 * Options for a CRUD controller.
 */
export type CrudControllerOptions = {
    /**
     * The largest page `findAll` reads. A larger `limit` is answered with a 400. Defaults to 100.
     */
    maxLimit?: number
};