/**
 * Why a stored value cannot become a value of the property a migration changes it into.
 */
export enum ConversionRefusal {
    /**
     * The value is not what the current property describes.
     */
    NOT_CURRENT = 'NOT_CURRENT',
    /**
     * The conversion casts nothing, and does not list the value.
     */
    NOT_LISTED = 'NOT_LISTED',
    /**
     * The value cast into the new property is not the same value any more.
     */
    DOES_NOT_FIT = 'DOES_NOT_FIT',
    /**
     * The value is missing, and the new property requires one.
     */
    MISSING = 'MISSING'
}