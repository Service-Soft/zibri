import { DocsSite } from 'zibri';

import { navigation } from './navigation';
import { BASE_PATH } from '../base-path';

// the documentation of the framework, the page a reader starts with at the address of the site
export const DOCS_SITE: DocsSite = {
    basePath: BASE_PATH,
    homePage: 'getting-started.md',
    title: 'Zibri',
    navigation
};