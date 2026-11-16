import path from 'node:path';

import { $ts, Auth, Controller, DocsPage, DocsUtilities, FileResponse, FsUtilities, Get, HtmlResponse, NotFoundError, Param, Response,
    TsxUtilities } from 'zibri';

import { ApiExport } from '../api/api-export.model';
import { API_FOLDER, ApiReferenceUtilities } from '../api/api-reference.utilities';
import { BASE_PATH } from '../base-path';
import { DOCS_DIR } from '../docs-dir';
import { DOCS_SITE } from '../navigation/docs-site';
import { ApiIndexPageTemplate } from '../templates/pages/api-index-page';
import { ApiPageTemplate } from '../templates/pages/api-page';
import { DocsPageTemplate } from '../templates/pages/docs-page';

const IMAGE_FILE: RegExp = /^[\w-]+\.(png|jpe?g|gif|svg|webp)$/;

// every page of the documentation at the address its file gives it
@Auth.skip({ allowRedundant: true })
@Controller(BASE_PATH, { versions: 'all' })
export class DocsController {

    @Response.html()
    @Get()
    home(): HtmlResponse {
        return this.render(`${BASE_PATH}/`);
    }

    // the API reference is a folder of its own, which this answers for rather than a route of its own, as the router
    // promises no order between a literal path and one of parameters
    @Response.html()
    @Get('/:page')
    rootPage(@Param.path('page') page: string): HtmlResponse {
        return page === API_FOLDER
            ? HtmlResponse.fromString(TsxUtilities.renderPage(ApiIndexPageTemplate))
            : this.render(`${BASE_PATH}/${page}/`);
    }

    @Response.html()
    @Get('/:folder/:page')
    folderPage(@Param.path('folder') folder: string, @Param.path('page') page: string): HtmlResponse {
        return folder === API_FOLDER ? this.renderApiPage(page) : this.render(`${BASE_PATH}/${folder}/${page}/`);
    }

    // an image a page of a folder shows, which the markdown names beside the page
    @Response.file()
    @Get('/images/:folder/:file')
    async image(@Param.path('folder') folder: string, @Param.path('file') file: string): Promise<FileResponse> {
        const imageFile: string = path.join(DOCS_DIR, folder, file);
        // a name and nothing else, so no request reaches a file outside the folders of the pages
        if (!/^[\w-]+$/.test(folder) || !IMAGE_FILE.test(file) || !await FsUtilities.exists(FsUtilities.getPath(imageFile))) {
            throw new NotFoundError($ts`There is no image at ${folder}/${file}.`);
        }
        return await FileResponse.fromPath(FsUtilities.getPath(imageFile), { disposition: 'inline' });
    }

    private render(address: string): HtmlResponse {
        const page: DocsPage | undefined = DocsUtilities.findPageAt(DOCS_SITE, address);
        if (page == undefined) {
            throw new NotFoundError($ts`There is no page at ${address}.`);
        }
        return HtmlResponse.fromString(TsxUtilities.renderPage(DocsPageTemplate, { page }));
    }

    private renderApiPage(name: string): HtmlResponse {
        const apiExport: ApiExport | undefined = ApiReferenceUtilities.findExport(name);
        if (apiExport == undefined) {
            throw new NotFoundError($ts`Zibri exports nothing named ${name}.`);
        }
        return HtmlResponse.fromString(TsxUtilities.renderPage(ApiPageTemplate, { apiExport }));
    }
}