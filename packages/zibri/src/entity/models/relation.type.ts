/**
 * Marks a type as the type of a to-one relation property. Never present at runtime.
 */
declare const relationBrand: unique symbol;

/**
 * The type of a to-one relation property: `@Property.hasOne`, `@Property.belongsToOne` and
 * `@Property.manyToOne` are declared on a property of this type, as `owner!: Relation<User>`.
 *
 * It holds the related entity like the entity's own type would, and it is assigned one like it.
 */
// Two entities that relate to each other import each other, and the type a decorated property declares is
// recorded when its class is defined - which, for es modules, reads the other class before its module has
// run, and fails. A type built from an intersection is recorded as Object instead. The brand is optional, so
// any value of the entity's type is one of this, and named, so the decorators can tell this type apart
// oxlint-disable-next-line jsdoc-js/require-jsdoc
export type Relation<T> = T & { readonly [relationBrand]?: T };