import { DocsSite } from 'zibri';

import * as gettingStarted from './pages/getting-started.md';
import * as writingAPage from './pages/guides/writing-a-page.md';

// the documentation of the application: every page, in the order of the navigation. The file of a page, below pages/,
// gives it its address
export const DOCS_SITE: DocsSite = {
    basePath: '/docs',
    homePage: 'getting-started.md',
    title: 'Docs',
    navigation: [
        { file: 'getting-started.md', module: gettingStarted },
        { title: 'Guides', pages: [{ file: 'guides/writing-a-page.md', module: writingAPage }] }
    ]
};