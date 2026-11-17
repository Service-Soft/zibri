import { Readable } from 'node:stream';

import { $ts, Auth, Controller, DocsPage, DocsUtilities, FileResponse, Get, HtmlResponse, JsonUtilities, NotFoundError, Param, Response, TsxUtilities } from 'zibri';

import { DocsPageTemplate } from '../templates/docs/docs-page';
import { DOCS_SITE } from '../templates/docs/docs-site';

@Auth.skip({ allowRedundant: true })
@Controller(DOCS_SITE.basePath, { versions: 'all' })
export class DocsController {
    // the same while the application runs, so it is made once
    private searchIndex: string | undefined;

    @Response.html()
    @Get()
    home(): HtmlResponse {
        return this.render(`${DOCS_SITE.basePath}/`);
    }

    @Response.html()
    @Get('/:page')
    rootPage(@Param.path('page') page: string): HtmlResponse {
        return this.render(`${DOCS_SITE.basePath}/${page}/`);
    }

    @Response.html()
    @Get('/:folder/:page')
    folderPage(@Param.path('folder') folder: string, @Param.path('page') page: string): HtmlResponse {
        return this.render(`${DOCS_SITE.basePath}/${folder}/${page}/`);
    }

    // what the search looks through, which a page fetches once a reader starts to search. Three parts long, so no page
    // of a folder is at its address
    @Response.file()
    @Get('/search/v1/index.json')
    searchEntries(): FileResponse {
        this.searchIndex ??= JsonUtilities.stringify(DocsUtilities.resolveSearchEntries(DOCS_SITE));
        return FileResponse.fromStream({
            stream: Readable.from([this.searchIndex]),
            filename: 'index.json',
            mimeType: 'application/json',
            size: Buffer.byteLength(this.searchIndex),
            disposition: 'inline'
        });
    }

    private render(address: string): HtmlResponse {
        const page: DocsPage | undefined = DocsUtilities.findPageAt(DOCS_SITE, address);
        if (page == undefined) {
            throw new NotFoundError($ts`There is no page at ${address}.`);
        }
        return HtmlResponse.fromString(TsxUtilities.renderPage(DocsPageTemplate, { page }));
    }
}