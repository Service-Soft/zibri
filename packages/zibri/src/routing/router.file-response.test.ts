import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { KnownHeader } from '../http/known-header.enum';
import { Response } from '../open-api/decorators/response.decorator';
import { FileResponse } from '../parsing/form-data/file-response.model';

@Controller('/files')
class FilesController {
    @Response.file()
    @Get('/invoice')
    invoice(): FileResponse {
        return FileResponse.fromStream({ stream: Readable.from(['%PDF']), filename: 'Rechnung März.pdf' });
    }

    @Response.file()
    @Get('/report')
    report(): FileResponse {
        return FileResponse.fromStream({ stream: Readable.from(['%PDF']), filename: 'report "q3".pdf', disposition: 'inline' });
    }

    @Response.file()
    @Get('/notes')
    notes(): FileResponse {
        return FileResponse.fromStream({ stream: Readable.from(['notes']), filename: 'notes.txt' });
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [FilesController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

/**
 * The content disposition a file is answered with.
 * @param path - The route, below the controller.
 * @returns The header.
 */
async function dispositionOf(path: string): Promise<string | null> {
    const res: globalThis.Response = await fetch(`${baseUrl}/files${path}`);
    await res.arrayBuffer();
    return res.headers.get(KnownHeader.CONTENT_DISPOSITION);
}

// part of evaluation round 2, 03 §H6: the name was percent-encoded into the plain filename, which no
// browser decodes, and every file was a download
describe('the content disposition a file is answered with', () => {
    it('names a file outside ASCII in UTF-8, beside a name every client reads', async () => {
        // eslint-disable-next-line cspell/spellchecker
        await expect(dispositionOf('/invoice')).resolves.toBe('attachment; filename="Rechnung Marz.pdf"; filename*=UTF-8\'\'Rechnung%20M%C3%A4rz.pdf');
    });

    it('shows a file in the browser when it is inline, its name quoted as a quoted string has to be', async () => {
        await expect(dispositionOf('/report')).resolves.toBe('inline; filename="report \\"q3\\".pdf"');
    });

    it('names an ASCII file once', async () => {
        await expect(dispositionOf('/notes')).resolves.toBe('attachment; filename="notes.txt"');
    });
});