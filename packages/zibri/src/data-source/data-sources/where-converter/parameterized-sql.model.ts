/**
 * A piece of sql together with the values its named placeholders stand for.
 */
export type ParameterizedSql = {
    /**
     * The sql, with a `:name` placeholder for every value.
     */
    sql: string,
    /**
     * The values, keyed by the name of the placeholder that stands in for each.
     */
    parameters: Record<string, unknown>
};