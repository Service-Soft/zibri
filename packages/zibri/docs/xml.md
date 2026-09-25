# XML
Zibri reads and writes xml the same way it reads and writes json: a [model](./models.md) describes the document, and everything read or written is validated against it. A route, a websocket event and the http client all take an xml body, a route can answer with one, `XmlUtilities.generateFrom` writes one and `XmlUtilities.parseFrom` reads one.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `XmlElement` | decorator | Gives the child element of a property another name than the property's |
| `XmlAttribute` | decorator | Makes a property an attribute of the element |
| `XmlText` | decorator | Makes a property the element's own text |
| `XmlMixed` | decorator | Makes a property everything inside the element: its text and its child elements, in order |
| `XmlRoot` | decorator | Names the root element of a model, the namespace of the document and the prefixes it declares |
| `XmlNamespace` | decorator | Puts the elements a model declares into a namespace |
| `XmlUtilities` | class | `generateFrom` writes a document from a model and its data, `parseFrom` reads one, `resolveXmlString` checks text you wrote yourself |
| `XmlString` | type | Text that is a well formed xml document |
| `XmlGenerateOptions` | type | How `generateFrom` lays a document out |
| `XmlParseOptions` | type | How strictly `parseFrom` reads a document |
| `MimeType.XML` | enum member | Declares a body as xml, and a response that can be written as xml |

## Usage
### Describing a document
A model describes an element. Each property is a child element named after the property:

```ts
// src/models/order.model.ts
import { Property, XmlAttribute, XmlElement, XmlRoot, XmlText } from 'zibri';

export class Price {
    @XmlAttribute()
    @Property.string()
    currency!: string;

    @XmlText()
    @Property.number()
    amount!: number;
}

export class OrderItem {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Price })
    price!: Price;
}

@XmlRoot({ name: 'Order', namespace: 'urn:example:orders' })
export class Order {
    @XmlAttribute('id')
    @Property.string()
    orderId!: string;

    @XmlElement('Item')
    @Property.array({ items: { type: 'object', cls: () => OrderItem } })
    items!: OrderItem[];
}
```

`Order` describes this document:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:example:orders" id="42">
    <Item>
        <name>Pen</name>
        <price currency="EUR">1.5</price>
    </Item>
    <Item>
        <name>Paper</name>
        <price currency="EUR">4</price>
    </Item>
</Order>
```

- `@XmlElement('Item')` names the child element of a property.
- A property declared as an array is its element repeated, once per item.
- `@XmlAttribute()` makes a property an attribute, named after the property or after the name it is given.
- `@XmlText()` makes a property the element's own text. A model has at most one.
- `@XmlRoot` names the root element and the namespace of the document. Without it, the root element is named after the class and the document has no namespace. A model inside another model's document is named after its property and is in that document's namespace, whatever its own `@XmlRoot` says.

Elements and attributes are matched by their name without a namespace prefix, so `<o:Order xmlns:o="urn:example:orders">` is read as `Order` too.

### Namespaces
A model whose elements are in another namespace than the document's names it with `@XmlNamespace`, and the root declares the prefix it is written with:

```ts
// src/models/envelope.model.ts
import { Property, XmlNamespace, XmlRoot } from 'zibri';

@XmlNamespace('urn:example:header')
export class Header {
    @Property.string()
    id!: string;
}

@XmlRoot({ name: 'Envelope', namespace: 'urn:example:envelope', prefixes: { h: 'urn:example:header' } })
export class Envelope {
    @Property.object({ cls: () => Header })
    header!: Header;
}
```

`Envelope` describes this document:

```xml
<Envelope xmlns="urn:example:envelope" xmlns:h="urn:example:header">
    <header>
        <h:id>1</h:id>
    </header>
</Envelope>
```

- The child elements of a model are in the namespace of that model, so `header` is in the envelope's namespace and `id` in the header's.
- A namespace with a prefix is written with it, the root's own included. The root's namespace without a prefix is the document's default namespace.
- A model in a namespace the root declares no prefix for cannot be written.

### Mixed content
Text with elements in between, like `Hello <x id="name"/>!`, is a property marked with `@XmlMixed`. It is declared as a list of `oneOf`: the one shape of text holds a piece of text, and every other shape is a model, written as the element named like the shape:

```ts
// src/models/message.model.ts
import { OneOf, Property, XmlAttribute, XmlMixed } from 'zibri';

export class Placeholder {
    @XmlAttribute()
    @Property.string()
    id!: string;
}

export class Message {
    @XmlAttribute('xml:space')
    @Property.string({ required: false })
    space?: string;

    @XmlMixed()
    @Property.array({ items: { type: 'oneOf', shapes: { text: { type: 'string' }, x: { type: 'object', cls: () => Placeholder } } } })
    parts!: OneOf<{ text: string, x: Placeholder }>[];
}
```

`<Message>Hello <x id="name"/>!</Message>` is `{ parts: [{ shape: 'text', value: 'Hello ' }, { shape: 'x', value: { id: 'name' } }, { shape: 'text', value: '!' }] }`.

- A model with mixed content declares no other child elements and no `@XmlText`. Attributes are fine.
- An attribute of the `xml` namespace keeps its prefix, like `xml:space` above.

### Receiving an xml body
Declare a body as xml with `type: MimeType.XML`:

```ts
// src/controllers/order.controller.ts
import { Body, Controller, MimeType, Post } from 'zibri';

@Controller('/orders')
export class OrderController {
    @Post()
    async create(@Body(Order, { type: MimeType.XML }) order: Order): Promise<void> {
        // your logic
    }
}
```

The route accepts `application/xml` and `text/xml`. The body is validated like a json body: an element the model does not declare is reported as an unknown key, and a missing attribute as a missing property. A document that is not well formed, or that declares its own entities, is answered with a `400`.

A websocket event takes an xml body the same way, sent as a string:

```ts
// src/controllers/order.websocket-controller.ts
import { WebsocketBody, WebsocketController, WebsocketRoute } from 'zibri';

@WebsocketController()
export class OrderWebsocketController {
    @WebsocketRoute('order')
    async receiveOrder(@WebsocketBody(Order, { type: MimeType.XML }) order: Order): Promise<void> {
        // your logic
    }
}
```

### Answering with xml
A response declared with `Response.object`, `Response.paginated` or `Response.keysetPage` names the formats it can be written in with `mimeTypes`. The request's `Accept` header picks one. Between formats the request weighs equally, the one it names first is taken, and when it names none or accepts anything, the first one the response lists is taken:

```ts
// src/controllers/order-lookup.controller.ts
import { Get, Response } from 'zibri';

@Controller('/order-lookup')
export class OrderLookupController {
    @Response.object(Order, { mimeTypes: [MimeType.JSON, MimeType.XML] })
    @Get('/latest')
    async findLatest(): Promise<Order> {
        return { orderId: '42', items: [] };
    }
}
```

The handler returns the data of the model either way. As xml, it is written as the document the model describes and validated against the model first; data that does not fit is answered with a `500`. A request accepting neither format is answered with a `406`, and the response carries `Vary: Accept`.

An xml response is one model, which is the root element of the document. A list is a model holding it. A page is written as a `PaginationResult` or `KeysetPage` element, with one `items` element per item.

`Response.empty` takes `mimeTypes` too, and answers json and xml by default. Every json and empty response of a route names the same formats, and the application refuses to start otherwise:

```ts
// src/controllers/order-by-id.controller.ts
import { Controller, Get, MimeType, Param, Response } from 'zibri';

@Controller('/order-by-id')
export class OrderByIdController {
    @Response.object(Order, { mimeTypes: [MimeType.JSON, MimeType.XML] })
    @Response.empty()
    @Get('/:id')
    async findById(@Param.path('id') id: string): Promise<Order | undefined> {
        // your logic, answering 204 when there is no order
        return undefined;
    }
}
```

An error is answered with xml when the request prefers it, on any route. See [error handling](./error-handling.md#how-the-global-error-handler-processes-an-error).

### Writing a document
`XmlUtilities.generateFrom` writes the data of a model as its document, an `XmlString`. The data has the type of the model, and it is validated against the model before it is written:

```ts
// src/services/order.service.ts
import { HttpClientInterface, HttpClientResponse, inject, MimeType, XmlString, XmlUtilities, ZIBRI_DI_TOKENS } from 'zibri';

export async function sendOrder(order: Order): Promise<HttpClientResponse<Order>> {
    const xml: XmlString = await XmlUtilities.generateFrom(Order, order);

    const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    return await http.post('https://some-api.com/orders', xml, {
        requestBodyType: MimeType.XML,
        responseBody: { modelClass: Order, type: MimeType.XML }
    });
}
```

Elements are written in the order their properties are declared in, and a property without a value is left out. Data that does not fit the model throws an `InternalError`, with the validation error as its `cause`.

The document is written on one line. With `{ indent: true }`, an element holding only other elements puts each of them on a line of its own, indented by two spaces. Text, and an element holding text, is written exactly as it is.

The example also reads the response as xml: a `responseBody` with `type: MimeType.XML` is read and validated like a request body. See [the http client](./http-client.md#body).

The http client sends an `XmlString` as an xml body. A document you write some other way becomes one with `XmlUtilities.resolveXmlString`, which throws an `InternalError` for text that is not a well formed xml document.

### Reading a document
`XmlUtilities.parseFrom` reads a document as the data of a model, the way an xml body is read, and validates it:

```ts
// src/services/order-import.service.ts
import { XmlUtilities } from 'zibri';

export async function readOrder(xml: string): Promise<Order> {
    return await XmlUtilities.parseFrom(Order, xml);
}
```

A document that is not well formed, or does not have the structure of the model, throws an `InternalError`. Values that break the rules of the model throw a `ValidationError`. An element of the root that the model does not declare is reported too, unless you pass `{ allowAdditionalProperties: true }`.

## See also
- [Models](./models.md) — the `@Property` decorators that say what each value is
- [Creating endpoints](./creating-endpoints.md#request-body) — request bodies in general
- [Websocket](./websocket.md) — receiving messages
- [Http client](./http-client.md) — sending requests and reading responses