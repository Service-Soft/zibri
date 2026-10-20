import { ScimFilter } from './scim-filter.model.ts';

/**
 * A part of a SCIM filter on users that compares an attribute without a column of its own, which the
 * users it holds for are found for ahead of the rest of the filter.
 */
export type ScimIndexedFilter = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    filter: Extract<ScimFilter, { type: 'comparison' | 'present' | 'valuePath' }>,
    /**
     * The attribute it is about, in lower case and with the attribute of a value path it stands in
     * before it, eg. `emails.value`, or for a value path the attribute alone, eg. `emails`.
     */
    key: string
};