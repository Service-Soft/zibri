/**
 * All possible relations.
 */
export enum Relation {
    HAS_ONE = 'has-one',
    BELONGS_TO_ONE = 'belongs-to-one',
    ONE_TO_MANY = 'one-to-many',
    MANY_TO_ONE = 'many-to-one',
    MANY_TO_MANY = 'many-to-many'
}