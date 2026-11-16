import { DocsUtilities } from 'zibri';

import { SearchEntry } from './search-entry.model';
import { ApiCommentUtilities } from '../api/api-comment.utilities';
import { ApiPageUtilities } from '../api/api-page.utilities';
import { ApiReferenceUtilities } from '../api/api-reference.utilities';
import { DOCS_SITE } from '../navigation/docs-site';
import { BADGE_LOOKS } from '../templates/components/kind-badge';

/**
 * Where the browser fetches what the search looks through, below the site.
 */
export const SEARCH_INDEX_ADDRESS: string = DocsUtilities.resolveSearchIndexAddress(DOCS_SITE);

/**
 * What the search of the site looks through.
 */
export abstract class SearchIndexUtilities {
    /**
     * Every page, every section of one, and every export of the API reference.
     * @returns The entries, pages first.
     */
    static resolveEntries(): SearchEntry[] {
        return [
            ...DocsUtilities.resolveSearchEntries(DOCS_SITE),
            ...ApiReferenceUtilities.resolveExports().map(apiExport => {
                const [first] = apiExport.declarations;
                return {
                    title: apiExport.name,
                    address: ApiReferenceUtilities.resolveAddress(apiExport.name),
                    context: first == undefined ? '' : ApiCommentUtilities.resolveFirstSentence(ApiPageUtilities.findComment(first)),
                    keywords: [],
                    badge: BADGE_LOOKS[apiExport.kind]
                };
            })
        ];
    }
}