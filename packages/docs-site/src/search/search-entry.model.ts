import type { DocsSearchEntry } from 'zibri';

/**
 * Something the search finds: a page or a section of one, as for every documentation, or an export of the API
 * reference with the badge of its kind.
 */
export type SearchEntry = DocsSearchEntry & {
    badge?: SearchBadge
};

/**
 * The badge of the kind of an export in a result of the search.
 */
export type SearchBadge = {
    letter: string,
    classes: string
};