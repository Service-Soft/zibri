import path from 'node:path';

// the pages of the documentation beside the sources of the framework. The site is built, tested, run and exported from
// its own folder of the repository, which is where npm starts its scripts
export const DOCS_DIR: string = path.join(process.cwd(), '..', 'zibri', 'docs');