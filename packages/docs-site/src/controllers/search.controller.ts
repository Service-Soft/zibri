import { Readable } from 'node:stream';

import { Auth, Controller, FileResponse, Get, JsonUtilities, Response } from 'zibri';

import { BASE_PATH } from '../base-path';
import { SearchIndexUtilities } from '../search/search-index.utilities';

// what the search of a page looks through, which the page fetches when a reader starts to search
@Auth.skip({ allowRedundant: true })
@Controller(`${BASE_PATH}/search`, { versions: 'all' })
export class SearchController {
    // the same while the site runs, so it is made once
    private index: string | undefined;

    @Response.file()
    @Get('/v1/index.json')
    entries(): FileResponse {
        this.index ??= JsonUtilities.stringify(SearchIndexUtilities.resolveEntries());
        return FileResponse.fromStream({
            stream: Readable.from([this.index]),
            filename: 'index.json',
            mimeType: 'application/json',
            size: Buffer.byteLength(this.index),
            disposition: 'inline'
        });
    }
}