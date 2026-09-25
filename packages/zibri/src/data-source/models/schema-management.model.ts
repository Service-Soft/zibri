/**
 * Who is responsible for making the database match the entities.
 *
 * Required on every sql data source rather than defaulted, because every value is right for somebody
 * and the wrong one is only noticed after it has already acted. Stating it is cheap; discovering it
 * from behavior is a dropped column.
 */
export type SchemaManagement
    /**
     * The framework alters the database to match the entity classes on every boot.
     *
     * Convenient while the model is still moving, and unsafe once anything is stored: it issues the
     * ALTER and DROP statements needed to make the database agree with the classes, so a renamed
     * property takes the old column and its contents with it. It also runs after migrations, so it
     * can undo one.
     */
    = 'synchronize'
    /**
     * The data source's own migrations are the only thing that changes the schema.
     *
     * Saying this and then shipping no migrations means nothing would ever create a table, so it is
     * refused at boot rather than left to surface as a failing query.
     */
        | 'migrations'
    /**
     * Something outside the application owns the schema entirely.
     *
     * Behaves like `migrations` - the framework issues no ddl of its own - but it states that having
     * no migrations is the intention, so nothing objects to it.
     */
        | 'external';