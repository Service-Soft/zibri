import { createContext, RenderContext } from 'zibri';

/**
 * Where the page that renders is, which its headings note as they render, top to bottom.
 */
export type PageSection = {
    // the anchor of the last `##` heading rendered, such as `key-exports`
    id: string
};

// the section a construct of a page is in. A page provides its own, so markdown outside a page, such as a comment in
// the API reference, is in none
export const PageSectionContext: RenderContext<PageSection | undefined> = createContext<PageSection | undefined>(undefined);