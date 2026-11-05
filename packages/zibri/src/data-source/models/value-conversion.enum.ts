/**
 * What happens to a stored value that a property change does not list.
 */
export enum ValueConversion {
    /**
     * Cast into the new type, eg. `42` into `'42'`. A value that is not the same value afterwards,
     * like `1.5` cast into a whole number or `'abc'` into a number, fails the migration.
     */
    CAST = 'CAST',
    /**
     * Not converted at all. Every value the rows hold has to be listed, and the migration fails naming
     * the ones that are not.
     */
    NONE = 'NONE'
}