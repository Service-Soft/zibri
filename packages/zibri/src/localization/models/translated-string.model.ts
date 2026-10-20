
/**
 * A string that has been translated by eg. $ts or $t``.getValue('en-US').
 */
export type TranslatedString = string & {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    __brand: 'translation'
};