import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { testFileFolder } from '../__testing__/constants';
import { PdfmakeTestUtilities } from '../__testing__/pdfmake-test.utilities';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { PdfAccessOptions } from './pdf-access-options.model';
import { PdfAttachmentDefinition, PdfDocument, PdfDocumentDefinition, PdfUtilities } from './pdf.utilities';

/**
 * A png of one red pixel.
 */
const PIXEL: Buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

/**
 * What a pdf holds that pdfmake 0.2 and 0.3 make alike from the same definition, unlike the bytes, which differ
 * by the pdfkit each writes with.
 */
type PdfSummary = {
    /**
     * The size of each page, as the pdf states it.
     */
    mediaBoxes: string[],
    /**
     * The fonts it embeds, without the tag of the subset.
     */
    fonts: string[],
    /**
     * The names of the files attached to it.
     */
    attachments: string[]
};

/**
 * What is read from the manifest of a package.
 */
type Manifest = {
    /**
     * The version of the package.
     */
    version: string,
    /**
     * The versions of the packages it asks the consumer for.
     */
    peerDependencies?: Record<string, string>
};

/**
 * Reads a created document to its end.
 * @param doc - The document.
 * @returns The bytes of the pdf, as latin1 text.
 */
async function render(doc: PdfDocument): Promise<string> {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ended: Promise<void> = new Promise(resolve => doc.on('end', resolve));
    doc.end();
    await ended;
    return Buffer.concat(chunks).toString('latin1');
}

/**
 * Sums a pdf up.
 * @param pdf - The bytes of the pdf, as latin1 text.
 * @returns What it holds.
 */
function summaryOf(pdf: string): PdfSummary {
    return {
        mediaBoxes: [...pdf.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(match => match[1]?.trim() ?? ''),
        // the name of every embedded font, without the tag that marks it as a subset. Each one is
        // named twice, by the font and by the font it descends from
        fonts: [...new Set([...pdf.matchAll(/\/BaseFont \/(?:[A-Z]{6}\+)?([\w-]+)/g)].map(match => match[1] ?? ''))].sort(),
        attachments: [...pdf.matchAll(/\/F \(([^)]+)\)/g)].map(match => match[1] ?? '').sort()
    };
}

PdfmakeTestUtilities.describeOnEvery('PdfUtilities.resolve', () => {
    // a string handed as `src` is read as a file path, so the type asks for the path brand
    // the rest of the framework resolves one with, rather than for any string a request carried
    it('attaches a file by a resolved path, raw content, or nothing a plain string could be', async () => {
        const definition: PdfAttachmentDefinition[] = [
            { src: FsUtilities.getPath(__dirname, 'pdf.utilities.test.ts'), options: { name: 'by-path.ts' } },
            { src: Buffer.from('raw file content'), options: { name: 'raw.txt' } },
            // @ts-expect-error a plain string is not a path the framework resolved
            { src: '/etc/passwd', options: { name: 'any-string.txt' } }
        ];
        const access: PdfAccessOptions = { allowedFolders: [FsUtilities.getPath(__dirname)] };

        const pdf: string = await render(await PdfUtilities.resolve(
            { content: ['with attachments'], attachments: definition.slice(0, 2) },
            undefined,
            undefined,
            access
        ));

        expect(pdf).toContain('/F (by-path.ts)');
        expect(pdf).toContain('/F (raw.txt)');
    });

    it('sets bold and italic text in fonts of their own', async () => {
        const pdf: string = await render(await PdfUtilities.resolve({
            content: [
                'regular',
                { text: 'bold', bold: true },
                { text: 'italic', italics: true },
                { text: 'bold italic', bold: true, italics: true }
            ],
            attachments: []
        }));

        expect(summaryOf(pdf).fonts).toStrictEqual(['Roboto-Italic', 'Roboto-Medium', 'Roboto-MediumItalic', 'Roboto-Regular']);
    });

    it('embeds an image given as its content, with nothing allowed', async () => {
        const dataUrl: string = `data:image/png;base64,${PIXEL.toString('base64')}`;

        const pdf: string = await render(await PdfUtilities.resolve({
            images: { pixel: dataUrl },
            content: [{ image: 'pixel', width: 10 }, { image: dataUrl, width: 10 }],
            attachments: []
        }));

        expect(pdf).toContain('/Subtype /Image');
    });
});

describe('PdfUtilities.resolve', () => {
    // the suites run with one install of each version the peer range admits, so a version added to the range is one
    // added to the tests
    it('is tested with every version of pdfmake the peer range admits', () => {
        const manifest: Manifest = JsonUtilities.parse(readFileSync(FsUtilities.getPath(__dirname, '..', '..', 'package.json'), 'utf8'));
        const admitted: (string | undefined)[] = (manifest.peerDependencies?.['pdfmake'] ?? '')
            .split('||')
            .map(range => /^\^(\d+\.\d+)\./.exec(range.trim())?.[1]);
        const tested: (string | undefined)[] = PdfmakeTestUtilities.installs.map(installedAs => {
            const installed: Manifest = JsonUtilities.parse(readFileSync(require.resolve(`${installedAs}/package.json`), 'utf8'));
            return /^(\d+\.\d+)\./.exec(installed.version)?.[1];
        });

        expect(tested).toStrictEqual(admitted);
    });

    it('makes the same pdf with pdfmake 0.2 and 0.3', async () => {
        const definition: PdfDocumentDefinition = {
            pageSize: 'A5',
            content: [
                { text: 'Invoice 42', bold: true, fontSize: 18 },
                { table: { body: [['Item', 'Total'], ['Widgets', '42']] } },
                { text: 'Terms', italics: true, pageBreak: 'before' }
            ],
            attachments: [{ src: Buffer.from('<invoice/>'), options: { name: 'invoice.xml' } }]
        };

        const summaries: PdfSummary[] = [];
        for (const installedAs of PdfmakeTestUtilities.installs) {
            summaries.push(summaryOf(await render(await PdfmakeTestUtilities.resolveWith(installedAs, () => PdfUtilities.resolve(definition)))));
        }

        expect(summaries[0]).toStrictEqual({
            mediaBoxes: ['0 0 419.53 595.28', '0 0 419.53 595.28'],
            fonts: ['Roboto-Italic', 'Roboto-Medium', 'Roboto-Regular'],
            attachments: ['invoice.xml']
        });
        expect(summaries[1]).toStrictEqual(summaries[0]);
    });
});

PdfmakeTestUtilities.describeWith('pdfmake', 'PdfUtilities.create', () => {
    it('creates the pdf at once', async () => {
        // eslint-disable-next-line typescript/no-deprecated -- the synchronous create of pdfmake 0.2, which 3.x keeps until 4.0
        const pdf: string = await render(PdfUtilities.create({ content: ['created at once'], attachments: [] }, undefined));

        expect(pdf.startsWith('%PDF-')).toBe(true);
    });
});

PdfmakeTestUtilities.describeWith('pdfmake-0.3', 'PdfUtilities.create', () => {
    it('points to PdfUtilities.resolve, as pdfmake 0.3 creates a pdf asynchronously', () => {
        // eslint-disable-next-line typescript/no-deprecated -- the synchronous create of pdfmake 0.2, which 3.x keeps until 4.0
        expect(() => PdfUtilities.create({ content: ['created at once'], attachments: [] }, undefined)).toThrow('Use PdfUtilities.resolve.');
    });
});

PdfmakeTestUtilities.describeWith('pdfmake-0.3', 'what a pdf reads besides its definition', () => {
    const folder: FsPath = FsUtilities.getPath(testFileFolder, `pdf-access-${UUIDUtilities.generate()}`);
    const image: FsPath = FsUtilities.getPath(folder, 'logo.png');
    const requests: string[] = [];
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        await FsUtilities.mkdir(FsUtilities.getPath(folder, 'inner'));
        await writeFile(image, PIXEL);
        server = createServer((request, response) => {
            requests.push(request.url ?? '');
            response.writeHead(200, { 'content-type': 'image/png' });
            response.end(PIXEL);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address: AddressInfo | string | null = server.address();
        origin = `http://127.0.0.1:${typeof address === 'object' && address != undefined ? address.port : 0}`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await FsUtilities.rm(folder);
    });

    it('refuses a file the definition names, when no folder is allowed', async () => {
        await expect(PdfUtilities.resolve({ content: [{ image, width: 10 }], attachments: [] }))
            .rejects.toThrow(`The pdf may not read "${image}"`);
    });

    it('reads a file inside an allowed folder', async () => {
        const pdf: string = await render(await PdfUtilities.resolve(
            { content: [{ image, width: 10 }], attachments: [] },
            undefined,
            undefined,
            { allowedFolders: [folder] }
        ));

        expect(pdf).toContain('/Subtype /Image');
    });

    it('refuses a file outside the allowed folders, one in a folder sharing the start of the name included', async () => {
        const access: PdfAccessOptions = { allowedFolders: [FsUtilities.getPath(folder, 'inner')] };
        const outOfIt: string = `${folder}/inner/../logo.png`;
        const sharingTheStart: string = `${folder}/inner-logo.png`;

        await expect(PdfUtilities.resolve({ content: [{ image: outOfIt, width: 10 }], attachments: [] }, undefined, undefined, access))
            .rejects.toThrow(`The pdf may not read "${outOfIt}"`);
        await expect(PdfUtilities.resolve({ content: [{ image: sharingTheStart, width: 10 }], attachments: [] }, undefined, undefined, access))
            .rejects.toThrow(`The pdf may not read "${sharingTheStart}"`);
    });

    it('refuses an attachment by its path, when no folder is allowed', async () => {
        await expect(PdfUtilities.resolve({ content: ['with an attachment'], attachments: [{ src: image, options: { name: 'logo.png' } }] }))
            .rejects.toThrow(`The pdf may not read "${image}"`);
    });

    it('fetches no URL allowUrl does not allow', async () => {
        const url: string = `${origin}/refused.png`;

        await expect(PdfUtilities.resolve(
            { images: { logo: url }, content: [{ image: 'logo', width: 10 }], attachments: [] },
            undefined,
            undefined,
            { allowedFolders: [folder], allowUrl: allowed => allowed.endsWith('/allowed.png') }
        )).rejects.toThrow(`The pdf may not fetch "${url}"`);
        expect(requests).not.toContain('/refused.png');
    });

    it('fetches a URL allowUrl allows', async () => {
        const pdf: string = await render(await PdfUtilities.resolve(
            { images: { logo: `${origin}/allowed.png` }, content: [{ image: 'logo', width: 10 }], attachments: [] },
            undefined,
            undefined,
            { allowedFolders: [], allowUrl: url => url.startsWith(`${origin}/`) }
        ));

        expect(pdf).toContain('/Subtype /Image');
        expect(requests).toContain('/allowed.png');
    });
});