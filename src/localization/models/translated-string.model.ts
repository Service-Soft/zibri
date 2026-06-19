
/**
 * A string that has been translated by eg. $ts or $t``.getValue('en-US').
 */
export type TranslatedString = string & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    __brand: 'translation'
};