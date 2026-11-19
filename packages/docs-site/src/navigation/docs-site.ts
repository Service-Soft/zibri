import { DocsSite } from 'zibri';

import { BASE_PATH } from '../base-path';
import { navigation } from './navigation';

// the documentation of the framework, the page a reader starts with at the address of the site
export const DOCS_SITE: DocsSite = {
    basePath: BASE_PATH,
    homePage: 'README.md',
    title: 'Zibri',
    navigation
};