/**
 * A relation's value, written so that the class it names is not read while the decorators run.
 *
 * TypeScript records the type of a decorated property, and for a class declared further down the same
 * file that is a reference read before the class exists. Through a generic alias it records `Object`.
 */
export type Relation<T> = T;