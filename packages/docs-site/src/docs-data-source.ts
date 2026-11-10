import { createInMemoryDataSource } from 'zibri-testing';

// the site stores nothing of its own, and is never deployed as a server: it runs while the pages are written and
// while they are exported. The tables of the framework are kept in memory for as long as it runs
export const DocsDataSource: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource();