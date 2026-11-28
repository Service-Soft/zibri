---
keywords: [pdf, documents, reports, report generation, export]
---

# Document generation
`PdfUtilities` builds PDF documents from a [pdfmake](https://pdfmake.github.io/docs/) document definition, such as a report, a receipt or an invoice. The [invoicing plugin](../plugins/invoicing-plugin.md) renders its invoices with it. XML documents are written from models, see [XML](../endpoints/xml.md).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `PdfUtilities` | class | Creates a PDF document from a definition |
| `PdfDocument` | type | The stream returned by `PdfUtilities.resolve` (a `PDFKit.PDFDocument`) |
| `PdfDocumentDefinition` | type | Full pdfmake document definition, plus `attachments` |
| `PdfAttachmentDefinition` | type | A single file attachment embedded into the PDF |
| `PdfContentDefinition` | type | Any pdfmake content element (text, table, image, columns, ...) |
| `PdfColumnDefinition` | type | A single column inside a `columns` layout |
| `PdfTableCellDefinition` | type | A single cell inside a table body |
| `PdfContentSize` | type | Width of a column/table cell (`number`, `'50%'`, `'auto'`, `'*'`) |
| `PdfImageDefinition` | type | Definition of an image embedded into the document |
| `PdfBufferOptions` | type | Options passed through to pdfmake's PDF buffer generation |
| `PdfPageSize` | type | The size of the pages: a standard size such as `'A4'` or `'LETTER'`, or a width and a height in points |
| `PdfFontOptions`, `PdfFontFamily`, `PdfFontFile` | type, type, type | The font families a PDF may be set in and the fallbacks among them, the files of one family, and one file, via `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS` |
| `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS` | DI token | The fonts besides Roboto, and the fallbacks. Defaults to none |
| `PdfAccessOptions` | type | The folders a PDF reads files from and the URLs it fetches, with pdfmake 0.3, via `ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS` |
| `ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS` | DI token | What a PDF reads besides its definition, with pdfmake 0.3. Defaults to no folder and no URL |

## Generating a PDF
`PdfUtilities.resolve` takes a `PdfDocumentDefinition` and returns a `PdfDocument`, which is a readable stream. Pipe it to one or more writable destinations, then call `.end()` to flush it:

```ts
// src/reports/report-pdf.function.ts
import { createWriteStream, WriteStream } from 'fs';
import { PdfDocument, PdfDocumentDefinition, PdfUtilities } from 'zibri';

export async function createReportPdf(): Promise<PdfDocument> {
    const definition: PdfDocumentDefinition = {
        attachments: [],
        content: [
            { text: 'Monthly report', bold: true, fontSize: 18 },
            {
                table: {
                    headerRows: 1,
                    widths: ['*', 100],
                    body: [
                        [{ text: 'Item', bold: true }, { text: 'Total', bold: true }],
                        ['Widgets', '42']
                    ]
                },
                margin: [0, 15, 0, 0]
            }
        ]
    };

    const doc: PdfDocument = await PdfUtilities.resolve(definition);
    const out: WriteStream = createWriteStream('report.pdf');
    doc.pipe(out);
    doc.end();
    return doc;
}
```

`content` takes the full pdfmake DSL: `PdfContentDefinition` is pdfmake's `Content` type. A definition takes everything pdfmake takes, plus `attachments`.

`PdfUtilities.create` creates the same PDF synchronously, with pdfmake 0.2 alone. It is deprecated: use `PdfUtilities.resolve`, which works with 0.2 and 0.3, see [choosing the pdfmake version](#choosing-the-pdfmake-version).

An endpoint returns a `PdfDocument` with `FileResponse.fromStream`, see [creating endpoints](../endpoints/creating-endpoints.md#returning-files):

```ts
// src/controllers/report.controller.ts
import { Controller, FileResponse, Get, PdfDocument, PdfUtilities, Response } from 'zibri';

@Controller('/reports')
export class ReportController {
    @Response.file()
    @Get('/monthly.pdf')
    async getMonthlyReport(): Promise<FileResponse> {
        const doc: PdfDocument = await PdfUtilities.resolve({ attachments: [], content: ['Hello world'] });
        doc.end();
        return FileResponse.fromStream({ stream: doc, filename: 'monthly.pdf' });
    }
}
```

## Setting the fonts
A PDF is set in Roboto, which draws Latin, Greek and Cyrillic. Register other font families with `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS`, and name the ones a character is set in when the font of its text cannot draw it, such as a Japanese name in an otherwise Latin document:

```ts
// src/providers.ts
import { defineProvider, FsUtilities, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS,
    useValue: {
        families: {
            NotoSansJp: { normal: FsUtilities.getPath('assets', 'fonts', 'NotoSansJP-Regular.otf') },
            NotoSansArabic: { normal: FsUtilities.getPath('assets', 'fonts', 'NotoSansArabic-Regular.ttf') }
        },
        fallbacks: ['NotoSansJp', 'NotoSansArabic']
    }
})
```

A family takes a TrueType or OpenType file of one font, as a path or as its content. A style it has no file for, such as `bold`, is set in `normal`. A document is set in another family with `font`, on an element, a style or `defaultStyle`.

Each character a text's own font cannot draw is set in the first of `fallbacks` that can, and the spaces between such characters with them. A character no family draws comes out blank. Which characters a family draws is read from its `normal` file.

## Attaching files to a PDF
Add entries to `attachments` on the document definition. Each entry needs an `options.name` and either the raw content or the path of a file, as `FsUtilities.getPath` resolves one:

```ts
// src/invoices/invoice-definition.ts
import { PdfDocumentDefinition } from 'zibri';

export const invoiceDefinition: PdfDocumentDefinition = {
    attachments: [
        {
            src: Buffer.from('raw file content'),
            options: { name: 'data.csv' }
        }
    ],
    content: ['Invoice with an attached csv export']
};
```

With pdfmake 0.3, an attachment given by its path is read only from an allowed folder, see [reading files and URLs](#reading-files-and-urls).

## Choosing the pdfmake version
A PDF is created with pdfmake 0.2 or 0.3, whichever your application installs. `PdfUtilities.resolve` and the [invoicing plugin](../plugins/invoicing-plugin.md) work with both, and a definition gives the same PDF with each.

| With pdfmake 0.3 | What to do |
|---|---|
| A PDF is created asynchronously, and `PdfUtilities.create` throws | Create it with `await PdfUtilities.resolve(...)` |
| A PDF reads no file and fetches no URL its definition names, such as an image by its path | Allow the folders and URLs it reads, see [reading files and URLs](#reading-files-and-urls) |

The types of a definition are those of pdfmake 0.2, which 0.3 takes as well.

## Reading files and URLs
A definition can name a file, such as an image or an attachment by its path, or with pdfmake 0.3 a URL, such as an image in `images`. With pdfmake 0.3, a PDF reads such a file or URL only when `ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS` allows it, and otherwise throws:

```ts
// src/providers.ts
import { defineProvider, FsUtilities, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS,
    useValue: {
        allowedFolders: [FsUtilities.getPath('assets', 'pdf')],
        allowUrl: (url: string) => url.startsWith('https://cdn.example.com/')
    }
})
```

| Option | What it is |
|---|---|
| `allowedFolders` | The folders a PDF reads files from. A path inside one of them is read, any other is refused. Required |
| `allowUrl` | Whether a PDF fetches a URL. No URL is fetched by default |

Content given in the definition is always read, such as an image as a data URL or an attachment as a `Buffer`. So are the fonts of `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS`.

> [!WARNING]
> With pdfmake 0.2, `PDF_ACCESS_OPTIONS` has no effect: a PDF reads every path its definition names. Give a definition built from a request the content of a file, never a path the request names.

## Requirements
| Package | Used for |
|---|---|
| `pdfmake` | Laying out and writing PDF documents, in version 0.2 or 0.3. You install it |
| `@types/pdfmake` | The types of the document definitions |

## See also
- [XML](../endpoints/xml.md) — writing and reading xml documents with `XmlUtilities.generateFrom` and `XmlUtilities.parseFrom`
- [Creating endpoints](../endpoints/creating-endpoints.md) — returning a generated PDF file from a controller via `FileResponse`
