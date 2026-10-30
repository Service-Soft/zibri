# Document generation
`PdfUtilities` builds PDF documents from a [pdfmake](https://pdfmake.github.io/docs/) document definition, such as a report, a receipt or an invoice. The [invoicing plugin](./invoicing-plugin.md) renders its invoices with it. XML documents are written from models, see [XML](./xml.md).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `PdfUtilities` | class | Creates a PDF document from a definition |
| `PdfDocument` | type | The stream returned by `PdfUtilities.create` (a `PDFKit.PDFDocument`) |
| `PdfDocumentDefinition` | type | Full pdfmake document definition, plus `attachments` |
| `PdfAttachmentDefinition` | type | A single file attachment embedded into the PDF |
| `PdfContentDefinition` | type | Any pdfmake content element (text, table, image, columns, ...) |
| `PdfColumnDefinition` | type | A single column inside a `columns` layout |
| `PdfTableCellDefinition` | type | A single cell inside a table body |
| `PdfContentSize` | type | Width of a column/table cell (`number`, `'50%'`, `'auto'`, `'*'`) |
| `PdfImageDefinition` | type | Definition of an image embedded into the document |
| `PdfBufferOptions` | type | Options passed through to pdfmake's PDF buffer generation |

## Generating a PDF
`PdfUtilities.create` takes a `PdfDocumentDefinition` and returns a `PdfDocument`, which is a readable stream. Pipe it to one or more writable destinations, then call `.end()` to flush it:

```ts
// src/reports/report-pdf.function.ts
import { createWriteStream, WriteStream } from 'fs';
import { PdfDocument, PdfDocumentDefinition, PdfUtilities } from 'zibri';

export function createReportPdf(): PdfDocument {
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

    const doc: PdfDocument = PdfUtilities.create(definition, undefined);
    const out: WriteStream = createWriteStream('report.pdf');
    doc.pipe(out);
    doc.end();
    return doc;
}
```

`content` takes the full pdfmake DSL: `PdfContentDefinition` is pdfmake's `Content` type. A definition takes everything pdfmake takes, plus `attachments`.

An endpoint returns a `PdfDocument` with `FileResponse.fromStream`, see [creating endpoints](./creating-endpoints.md#returning-files):

```ts
// src/controllers/report.controller.ts
import { Controller, FileResponse, Get, PdfDocument, PdfUtilities, Response } from 'zibri';

@Controller('/reports')
export class ReportController {
    @Response.file()
    @Get('/monthly.pdf')
    async getMonthlyReport(): Promise<FileResponse> {
        const doc: PdfDocument = PdfUtilities.create({ attachments: [], content: ['Hello world'] }, undefined);
        doc.end();
        return FileResponse.fromStream({ stream: doc, filename: 'monthly.pdf' });
    }
}
```

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

## Requirements
| Package | Used for |
|---|---|
| `pdfmake` | Laying out and writing PDF documents. You install it |

## See also
- [XML](./xml.md) — writing and reading xml documents with `XmlUtilities.generateFrom` and `XmlUtilities.parseFrom`
- [Creating endpoints](./creating-endpoints.md) — returning a generated PDF file from a controller via `FileResponse`
