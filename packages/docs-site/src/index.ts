import path from 'node:path';

import { ZibriApplication } from 'zibri';

import { applicationOptions } from './application-options';
import { SiteExport } from './export/site-export.model';
import { SiteExportUtilities } from './export/site-export.utilities';

// where "export" writes the site, which is what is published at its path
const EXPORT_DIR: string = path.join(process.cwd(), '.generated');

async function start(): Promise<void> {
    const app: ZibriApplication = new ZibriApplication(applicationOptions);
    const port: number = Number(process.env['PORT'] ?? '4000');
    await app.init();
    await app.start(port);
    if (process.argv[2] !== 'export') {
        return;
    }
    // "export" writes what the running site answers, and stops it again
    const exported: SiteExport = await SiteExportUtilities.exportAll(`http://localhost:${port}`, EXPORT_DIR);
    await app.shutdown();
    if (exported.problems.length > 0) {
        throw new Error([`The site has ${exported.problems.length} links that lead nowhere:`, ...exported.problems].join('\n'));
    }
    // eslint-disable-next-line no-console
    console.info(`Exported ${exported.files.length} files to ${EXPORT_DIR}.`);
}

// eslint-disable-next-line promise/prefer-await-to-callbacks
void start().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});