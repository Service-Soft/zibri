# Document generation
Zibri wraps [pdfmake](https://pdfmake.github.io/docs/) and [xmlbuilder2](https://oozcitak.github.io/xmlbuilder2/) so PDF and XML documents can be built without pulling in and configuring those libraries yourself. Both wrappers are general-purpose — they aren't tied to invoicing, even though the invoicing plugin is currently the only built-in consumer (PDF invoices and XRechnung/Peppol XML).

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
| `XmlUtilities` | class | Creates and parses XML documents |
| `XML` | type | An XML node returned by `XmlUtilities.create`/`.ele()` (an `XMLBuilder`) |

## Usage
### Generating a PDF
`PdfUtilities.create` takes a `PdfDocumentDefinition` and returns a `PdfDocument` — a readable stream, not a `Buffer`. Pipe it to one or more writable destinations, then call `.end()` to flush it:

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

`content` accepts the full pdfmake DSL directly (`PdfContentDefinition` is just an alias for pdfmake's `Content` type) — Zibri doesn't simplify or restrict it, only requires `attachments` in addition to what pdfmake itself expects.
<br>
Since a `PdfDocument` is a plain readable stream, it can be returned directly from an endpoint via `FileResponse.fromStream` (see [creating endpoints](./creating-endpoints.md#returning-files)):

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

### Attaching files to a PDF
Add entries to `attachments` on the document definition. Each entry needs an `options.name` and either a file path or the raw content:

```ts
const definition: PdfDocumentDefinition = {
    attachments: [
        {
            src: Buffer.from('raw file content'),
            options: { name: 'data.csv' }
        }
    ],
    content: ['Invoice with an attached csv export']
};
```

### Building an XML document
`XmlUtilities.create` returns the root `XML` node. Build the tree with `.ele()` (add a child element), `.att()` (set an attribute) and `.txt()` (set text content) — all chainable, matching xmlbuilder2's own API:

```ts
// src/reports/report-xml.function.ts
import { XML, XmlUtilities } from 'zibri';

export function createReportXml(): string {
    const root: XML = XmlUtilities.create().ele('report', { version: '1.0' });

    const item: XML = root.ele('item');
    item.ele('name').txt('Widgets');
    item.ele('total').txt('42').att('currency', 'EUR');

    return root.end({ prettyPrint: true });
}
```

`create` defaults to `{ version: '1.0', encoding: 'utf8' }` for the XML declaration; pass a `XMLBuilderCreateOptions` object to override it.

### Parsing XML
`XmlUtilities.parse<T>` parses an XML string into a plain object:

```ts
import { XmlUtilities } from 'zibri';

type ReportXml = { report: { item: { name: string, total: string } } };

const parsed: ReportXml = XmlUtilities.parse<ReportXml>(xmlString);
```

## See also
- [Creating endpoints](./creating-endpoints.md) — returning a generated PDF/XML file from a controller via `FileResponse`
