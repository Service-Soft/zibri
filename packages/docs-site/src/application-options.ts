import { SemVerUtilities, ZibriApplicationOptions } from 'zibri';

import { DocsController } from './controllers/docs.controller';
import { SearchController } from './controllers/search.controller';
import { DocsDataSource } from './docs-data-source';
import { version } from '../package.json';
import { providers } from './providers';

if (!SemVerUtilities.isSemVerVersion(version)) {
    throw new Error('The version of the package.json is not valid.');
}

export const applicationOptions: ZibriApplicationOptions = {
    name: 'Zibri',
    baseUrl: 'http://localhost:4000',
    version,
    // a mistake only the render can see fails the page, so the export fails on it rather than publishing it
    environment: 'development',
    controllers: [DocsController, SearchController],
    websocketControllers: [],
    dataSources: [DocsDataSource],
    // nobody logs in to the site
    defaultAuth: 'public',
    authStrategies: [],
    twoFactorAtLogin: 'never',
    providers
};