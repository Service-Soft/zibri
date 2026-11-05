/**
 * An attribute a SCIM filter or patch path names, eg. `userName`, `name.givenName` or
 * `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber`.
 */
export type ScimAttributePath = {
    /**
     * The schema of an extension the attribute belongs to, or undefined for a core attribute.
     */
    uri: string | undefined,
    /**
     * The name of the attribute.
     */
    attribute: string,
    /**
     * The name of the sub-attribute of a complex attribute, if one is named.
     */
    subAttribute: string | undefined
};

/**
 * How a SCIM filter compares an attribute with a value (RFC 7644, 3.4.2.2).
 */
export type ScimComparisonOperator = 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'gt' | 'lt' | 'ge' | 'le';

/**
 * A value a SCIM filter compares with.
 */
export type ScimFilterValue = string | number | boolean | null;

/**
 * A SCIM filter, read into what it says (RFC 7644, 3.4.2.2).
 */
export type ScimFilter = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'comparison',
    // eslint-disable-next-line jsdoc/require-jsdoc
    path: ScimAttributePath,
    // eslint-disable-next-line jsdoc/require-jsdoc
    operator: ScimComparisonOperator,
    // eslint-disable-next-line jsdoc/require-jsdoc
    value: ScimFilterValue
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'present',
    // eslint-disable-next-line jsdoc/require-jsdoc
    path: ScimAttributePath
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'and' | 'or',
    // eslint-disable-next-line jsdoc/require-jsdoc
    left: ScimFilter,
    // eslint-disable-next-line jsdoc/require-jsdoc
    right: ScimFilter
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'not',
    // eslint-disable-next-line jsdoc/require-jsdoc
    filter: ScimFilter
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'valuePath',
    // eslint-disable-next-line jsdoc/require-jsdoc
    path: ScimAttributePath,
    // eslint-disable-next-line jsdoc/require-jsdoc
    filter: ScimFilter
};