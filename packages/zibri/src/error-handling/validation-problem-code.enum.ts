/**
 * What kind of problem a value has, for a client to tell problems apart by.
 *
 * Named after the option of the property that the value breaks, where there is one.
 */
export enum ValidationProblemCode {
    /**
     * The value is missing, and the property is required.
     */
    REQUIRED = 'required',
    /**
     * The value is of another type than the property holds.
     */
    TYPE = 'type',
    /**
     * The value is not in the `format` of the property.
     */
    FORMAT = 'format',
    /**
     * The value does not match the `regex` of the property.
     */
    REGEX = 'regex',
    /**
     * The value is none of the `enum` of the property.
     */
    ENUM = 'enum',
    /**
     * The value is shorter than the `minLength` of the property.
     */
    MIN_LENGTH = 'minLength',
    /**
     * The value is longer than the `maxLength` of the property.
     */
    MAX_LENGTH = 'maxLength',
    /**
     * The value is below the `min` of the property.
     */
    MIN = 'min',
    /**
     * The value is above the `max` of the property.
     */
    MAX = 'max',
    /**
     * The date is not before the `before` of the property.
     */
    BEFORE = 'before',
    /**
     * The date is not after the `after` of the property.
     */
    AFTER = 'after',
    /**
     * The file is larger than the `maxSize` of the property.
     */
    MAX_SIZE = 'maxSize',
    /**
     * The file is none of the `allowedMimeTypes` of the property.
     */
    ALLOWED_MIME_TYPES = 'allowedMimeTypes',
    /**
     * The value breaks a check of its entity that was declared without a code of its own.
     */
    CHECK = 'check',
    /**
     * The key is none of the properties of the model.
     */
    UNKNOWN_KEY = 'unknownKey',
    /**
     * The value holds a relation, which create and update data cannot.
     */
    RELATION = 'relation',
    /**
     * The value fits none of the shapes the property can hold.
     */
    NO_SHAPE_FITS = 'noShapeFits',
    /**
     * The value names none of the shapes the property can hold.
     */
    UNKNOWN_SHAPE = 'unknownShape'
}