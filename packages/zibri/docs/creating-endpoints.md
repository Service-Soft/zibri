# Creating endpoints
An endpoint is a method of a controller class. Its decorators give it a route, read and validate what the request carries, secure it and declare what it answers with.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Controller` | decorator | Marks a class as a controller and defines its base route |
| `ControllerInputData` | type | The options of `@Controller`: the versions and deadline of its routes, whether it may exist without being registered, and the DI options of the class |
| `Route` | type | A path, starting with `/` |
| `ControllerUtilities` | class | Where the endpoints of a controller are |
| `Get` | decorator | Defines a GET endpoint |
| `Post` | decorator | Defines a POST endpoint |
| `Put` | decorator | Defines a PUT endpoint |
| `Patch` | decorator | Defines a PATCH endpoint |
| `Delete` | decorator | Defines a DELETE endpoint |
| `BaseHttpDecoratorInput` | type | The options every endpoint decorator takes: the `versions` a route supports and its `timeoutInMs` |
| `HandlerTimeout` | type | How long a handler has to produce a result: milliseconds, or `'none'` for no deadline |
| `HttpMethod` | enum | The HTTP methods, such as `HttpMethod.GET` |
| `Router`, `RouterInterface` | class, interface | Registers controllers and routes with `registerRoute`, and answers the requests. Replaceable through `ZIBRI_DI_TOKENS.ROUTER` |
| `RouteConfigurationInput`, `RouteConfiguration`, `RouteHandler` | type, type, type | A route for `registerRoute` as you write it, the route as the router keeps it, and the function that handles its requests |
| `OpenApiRouteConfiguration` | type | Whether a route given to `registerRoute` appears in the OpenAPI document, with its responses and tags |
| `Property` | decorator | Decorators for defining model properties |
| `Body` | decorator | Injects and validates the request body, `Body.oneOf` for a body of several shapes |
| `BodyMetadataInput`, `JsonBodyMetadataInput`, `XmlBodyMetadataInput`, `FormDataBodyMetadataInput`, `FormUrlEncodedBodyMetadataInput`, `StreamBodyMetadataInput` | type, type, type, type, type, type | The options of `@Body` and `Body.stream`, such as `maxSize`, one type per content type |
| `OneOfBodyMetadataInput`, `JsonBodyOneOfMetadataInput`, `XmlBodyOneOfMetadataInput`, `FormDataBodyOneOfMetadataInput`, `FormUrlEncodedBodyOneOfMetadataInput`, `StreamBodyOneOfMetadataInput` | type, type, type, type, type, type | What `Body.oneOf` takes: the options of the body and the `shapes` it can be, one type per content type |
| `JsonBodyShapeMetadataInput`, `FormDataBodyShapeMetadataInput` | type, type | A shape a JSON or XML body can be, and a shape a form body can be, which is always a class |
| `DeclaredBodyInput`, `DeclaredJsonBodyInput`, `DeclaredXmlBodyInput`, `DeclaredFormDataBodyInput`, `DeclaredFormUrlEncodedBodyInput`, `DeclaredStreamBodyInput` | type, type, type, type, type, type | The `bodyMetadata` of a route given to `registerRoute`: a body of one `modelClass` per content type, or a body of several shapes |
| `BodyMetadata` | type | A request body as the route declares it, with every option resolved. What the parser and a body parser receive |
| `Param` | decorator | Decorators for path, query and header parameters |
| `PathParamMetadataInput`, `QueryParamMetadataInput`, `HeaderParamMetadataInput` | type, type, type | The options of `Param.path`, `Param.query` and `Param.header`: one of the per-type options below |
| `StringParamMetadataInput`, `NumberParamMetadataInput`, `BooleanParamMetadataInput`, `DateParamMetadataInput`, `ObjectParamMetadataInput`, `ArrayParamMetadataInput`, `ArrayParamItemMetadataInput` | type, type, type, type, type, type, type | The options of a parameter for each `type`, and of the items of an array parameter |
| `OneOfPathParamMetadataInput`, `OneOfQueryParamMetadataInput`, `PathParamShapeMetadataInput`, `QueryParamShapeMetadataInput` | type, type, type, type | A parameter of several shapes, `type: 'oneOf'`, and the shapes it can be. A path parameter is text, a number, a boolean or a date; a query or header parameter can also be an object or an array |
| `PathParamMetadata`, `QueryParamMetadata`, `HeaderParamMetadata` | type, type, type | A parameter as the route declares it, with every option resolved. What the parser receives |
| `Header` | type | The name of a header: a `KnownHeader`, or any custom one |
| `CurrentUser` | decorator, type | Injects the currently logged in user, and is the type of what it injects |
| `CurrentUserOptions` | type | Whether `@CurrentUser` requires a user, and which [auth strategies](./glossary.md#auth-strategy) may resolve them |
| `Auth` | decorator | Decorators for securing endpoints |
| `Response` | decorator | Decorators for documenting OpenAPI responses |
| `ResponseDecorator` | type | A `Response` decorator, which compiles only on a method that can return what it declares |
| `OpenApiResponse`, `JsonOpenApiResponse`, `EmptyOpenApiResponse`, `ErrorOpenApiResponse`, `FileOpenApiResponse`, `HtmlOpenApiResponse`, `RedirectOpenApiResponse` | type, type, type, type, type, type, type | One response a route documents, by its `type`. The `Response` decorators take it without the `type` |
| `FileResponse` | class | Response type for returning files |
| `PathFileResponseData`, `StreamFileResponseData` | type, type | What a `FileResponse` is made from: the path of a file, or a stream and its file name |
| `HtmlResponse` | class | Response type for returning HTML |
| `HtmlResponseOptions` | type | The content security policy of an `HtmlResponse`: `true` for the default policy, `false` for none, or the directives you set |
| `RedirectResponse` | class | Response type for sending the caller to another URL |
| `RedirectHttpStatus` | type | The statuses a redirect answers with: 302, 303 or 307 |
| `JsonResponse` | class | Response type for answering with headers beside a JSON body |
| `JsonResponseOptions` | type | The headers a `JsonResponse` answers with beside its body |
| `isFileResponse`, `isHtmlResponse`, `isRedirectResponse`, `isJsonResponse` | function, function, function, function | Whether a value is one of these responses, also after it has been through JSON and back, such as from a shared cache |
| `File` | class | Represents an uploaded file |
| `FormData` | class | Typed wrapper for a form-data request body |
| `FormDataLimits` | type | How many files, parts and fields a multipart body may have, via `ZIBRI_DI_TOKENS.FORM_DATA_LIMITS`. Defaults to 20, 1000 and 500 |
| `Parser`, `ParserInterface` | class, interface | Parses request bodies and path, query and header parameters. Replaceable through `ZIBRI_DI_TOKENS.PARSER` |
| `BodyParser` | decorator | Marks a class as a body parser, which you list in the `bodyParsers` option |
| `BodyParserInterface`, `AnyBodyParser`, `BodyParserMetadata` | interface, type, type | What a body parser implements for its `contentType`, a body parser of any one content type, and the body metadata it receives |
| `isBodyParser` | function | Whether a value has every member of `BodyParserInterface` |
| `JsonBodyParser`, `XmlBodyParser`, `FormDataBodyParser`, `FormUrlEncodedBodyParser`, `StreamBodyParser` | class, class, class, class, class | The built-in parsers of JSON, XML, form-data, URL-encoded and streamed bodies. Registered for you. Setting `bodyParsers` replaces them |
| `MimeType` | enum | Mime type constants (such as for allowed file uploads) |
| `FileMimeType`, `LooseFileMimeType` | type, type | The mime types a file can have, and the same with any custom mime type string |
| `FileExtension`, `mimeTypeToExtensions` | type, constant | The file extensions of every mime type that has them |
| `resolveMimeType`, `resolveFileExtension` | function, function | The mime type of a file path, `MimeType.OCTET_STREAM` for an unknown extension, and the file extension of a mime type |
| `isMimeType`, `isJsonMimeType`, `isXmlMimeType` | function, function, function | Whether a string is a known mime type, a JSON media type such as `application/scim+json`, or `application/xml` or `text/xml` |
| `OmitClass` | function | Creates a class that omits given properties from a base class |
| `PickClass` | function | Creates a class that picks given properties from a base class |
| `IntersectionClass` | function | Combines multiple classes into one |
| `CrudController` | function | Base controller providing generic CRUD endpoints |
| `CrudControllerOptions` | type | The options of `CrudController`: `maxLimit`, the largest page `findAll` reads. Defaults to 100 |
| `CrudControllerInterface` | interface | The endpoints of a `CrudController`: `create`, `findAll`, `findById`, `updateById` and `deleteById` |
| `HttpStatus` | enum | HTTP status code constants |
| `PaginationResult` | type | Shape of a paginated response |
| `CompressionOptions` | type | Whether responses are compressed, and from what size on, via `ZIBRI_DI_TOKENS.COMPRESSION_OPTIONS`. Defaults to on, from one kilobyte |
| `isCompressibleMimeType` | function | Whether a body of a content type is compressed on the way out. A type it does not know is sent as it is |

## Defining a controller
`@Controller` makes a class a controller:

```ts
// src/controllers/user.controller.ts
import { Controller } from 'zibri';

@Controller('/users')
export class UserController {
    // ...
}
```

`/users` is the base route of the controller. Every endpoint of the controller is prefixed with it.

A class extending a controller keeps its endpoints. Give it a `@Controller` of its own to serve them under another base route. `ControllerUtilities.resolveUrl(UserController)` answers where the endpoints of a controller are: your `baseUrl`, followed by its base route.

Register the controller in the application:

```ts
// src/index.ts
import { ZibriApplication } from 'zibri';

import { applicationOptions } from './application-options';
import { UserController } from './controllers/user.controller';

// ...
    const app: ZibriApplication = new ZibriApplication({
        ...applicationOptions,
        controllers: [
            UserController
        ]
    })
// ...
```

## Defining endpoints on the controller
To define an endpoint, decorate a method of the controller with the decorator of its HTTP method. `@Get()` makes this one answer `GET /users`:

```ts
// src/controllers/user.controller.ts
import { Controller, Get, Property } from 'zibri';

class User {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ required: false })
    name?: string | null;

    @Property.string({ format: 'email' })
    email!: string;
}

@Controller('/users')
export class ReadingUserController {

    @Get()
    async find(): Promise<User[]> {
        return [{ id: '42', name: 'Ada', email: 'ada@example.com' }];
    }

}
```

The value the method returns is sent as JSON. To answer with another content type, see [changing the return type](#changing-the-return-type).

The OpenAPI explorer, at `http://localhost:3000/explorer` by default, lists the route `GET /users` with its return type, see [the OpenAPI document](./open-api.md).

## Extending a controller
A controller can extend another, generic ones included, and so can a class built with `OmitClass`, `PickClass` and `IntersectionClass`. `CrudController` builds a controller with the CRUD endpoints of an entity, to extend from:

```ts
// src/controllers/task.controller.ts
import { Controller, CrudController, Get, IntersectionClass, OmitClass, PickClass } from 'zibri';

import { Task, TaskCreateDTO, TaskUpdateDTO } from '../models';

@Controller('/metrics')
class MetricsController {
    @Get('/dashboard')
    async dashboard(): Promise<unknown> {
        return {};
    }
}

@Controller('/tasks')
export class TaskController extends IntersectionClass(
    OmitClass(CrudController(Task, TaskCreateDTO, TaskUpdateDTO), ['deleteById']),
    PickClass(MetricsController, ['dashboard'])
) {}
```

This controller serves these endpoints:
- `POST /tasks`, from `CrudController`, with `TaskCreateDTO` as body
- `GET /tasks`, from `CrudController`, answering a `PaginationResult` of `Task`
- `GET /tasks/:id`, from `CrudController`, answering a single `Task`
- `PATCH /tasks/:id`, from `CrudController`, updating a single `Task` with `TaskUpdateDTO`
- `GET /tasks/dashboard`, from `MetricsController`, under the base route of the class that picked it

`GET /tasks` takes `page` and `limit` from the query: whole numbers of at least 1, and a `limit` of
at most 100. Anything else is answered with a 400. Pass `maxLimit` to allow larger pages:

```ts
// src/controllers/task-export.controller.ts
import { Controller, CrudController } from 'zibri';

import { Task, TaskCreateDTO, TaskUpdateDTO } from '../models';

@Controller('/task-exports')
export class TaskExportController extends CrudController(Task, TaskCreateDTO, TaskUpdateDTO, { maxLimit: 500 }) {}
```

## Accessing request data

### Request body

To read the request body, decorate a parameter with `@Body()` and the [model](./models.md) of the body. The body is validated against the model before the method runs:

```ts
// src/controllers/user.controller.ts
import { Body, Controller, OmitClass, Post } from 'zibri';

class UserCreateDTO extends OmitClass(User, ['id']) {}

@Controller('/users')
export class WritingUserController {

    @Post()
    async create(
        @Body(UserCreateDTO)
        createData: UserCreateDTO
    ): Promise<User> {
        const createdUser: User = await this.createUser(createData); // ... create a new user
        return createdUser;
    }

    private async createUser(createData: UserCreateDTO): Promise<User> {
        return { id: '42', ...createData };
    }

}
```

Uploading files has [a section of its own](#handling-file-uploads). A body sent as XML is declared with `type: MimeType.XML`, see [XML](./xml.md#receiving-an-xml-body).

A JSON body is read in every JSON type: `application/json`, and every format written in JSON that carries the `+json` suffix, such as `application/scim+json` or `application/merge-patch+json`. A body that names one of them, such as `@Body(UserCreateDTO, { type: MimeType.JSON_SCIM })`, is read in that one alone, and any other is refused with a `415`.

The OpenAPI explorer lists the route `POST /users` with its request body and return type.

A body that is a list of the model is declared with `isArray`:

```ts
// src/controllers/user.controller.ts
import { Body, Controller, Post } from 'zibri';

@Controller('/users')
export class BulkUserController {
    @Post('/bulk')
    async createMany(@Body(UserCreateDTO, { isArray: true }) createData: UserCreateDTO[]): Promise<void> {
        // your logic
    }
}
```

### A form

A body an HTML form sends without files is declared with `type: MimeType.FORM_URL_ENCODED`. Each field fills the property of the same name, read as that property's type, and a field sent once per item fills a list:

```ts
// src/controllers/newsletter.controller.ts
import { Body, Controller, MimeType, Post, Property } from 'zibri';

class NewsletterSignUp {
    @Property.string({ format: 'email' })
    email!: string;

    @Property.array({ items: { type: 'string' }, required: false })
    topics?: string[];
}

@Controller('/newsletter-sign-ups')
export class NewsletterSignUpController {
    @Post()
    async signUp(
        @Body(NewsletterSignUp, { type: MimeType.FORM_URL_ENCODED })
        form: NewsletterSignUp
    ): Promise<void> {
        // your logic
    }
}
```

A form with files is a [multipart body](#handling-file-uploads).

### A body of several shapes

When a route accepts one of several bodies, list them with `Body.oneOf`. A shape is anything a shape of a [property of several shapes](./models.md#a-value-of-several-shapes) can be, so a body can also be one model or a list of them. Unlike such a property, a body names no shape:

```ts
// src/controllers/invite.controller.ts
import { Body, Controller, Post, Property } from 'zibri';

class EmailInvite {
    @Property.string({ format: 'email' })
    email!: string;
}

class LinkInvite {
    @Property.date()
    expiresAt!: Date;
}

@Controller('/invites')
export class InviteController {
    @Post()
    async create(
        @Body.oneOf({
            shapes: [
                { type: 'object', cls: () => EmailInvite },
                { type: 'object', cls: () => LinkInvite },
                { type: 'array', items: { type: 'object', cls: () => EmailInvite } }
            ]
        })
        invite: EmailInvite | LinkInvite | EmailInvite[]
    ): Promise<void> {
        // your logic
    }
}
```

The body becomes the first shape it fits, in the order they are listed. So put the more specific shape first: a date is also a string, so with `string` listed before `date` you will never get a `Date`. A body that fits none of them is answered with a `400` naming every shape. In the OpenAPI document the body is `anyOf` its shapes.

A form body can be one of several classes, with `type: MimeType.FORM_DATA` or `type: MimeType.FORM_URL_ENCODED`. Each shape has to be a class.

### Path, query and header params

To read path, query and header parameters, decorate a parameter with `@Param.path`, `@Param.query` or `@Param.header`:

```ts
// src/controllers/newsletter.controller.ts
import { Controller, Post, Param } from 'zibri';

@Controller('/newsletters')
export class NewsletterController {

    @Post('/:id/signup')
    async create(
        @Param.path('id', { type: 'string', format: 'uuid' })
        newsletterId: string,
        @Param.header('User-Agent')
        userAgent: string,
        @Param.query('affiliateId', { type: 'string', required: false })
        affiliateId?: string,
    ): Promise<void> {
        // your logic for signing up for a newsletter
    }

}
```

Each parameter is validated against what its decorator declares. The OpenAPI explorer lists the route `POST /newsletters/:id/signup` with its parameters.

A parameter can be one of several shapes as well. Like a body, it becomes the first shape it fits:

```ts
// src/controllers/report.controller.ts
import { Controller, Get, Param } from 'zibri';

@Controller('/reports')
export class ReportController {

    @Get('/:day')
    async find(
        @Param.path('day', { type: 'oneOf', shapes: [{ type: 'date' }, { type: 'string', enum: { today: 'today' } }] })
        day: Date | 'today',
        @Param.query('limit', { type: 'oneOf', shapes: [{ type: 'number', min: 1 }, { type: 'string', enum: { all: 'all' } }] })
        limit: number | 'all'
    ): Promise<void> {
        // your logic
    }

}
```

The shapes of a path parameter can be text, numbers, booleans and dates. Query and header parameters can also be objects and arrays.

An array query parameter takes one value per item, `?tags=a&tags=b`, and `?tags=a` alone is a list of one. One value spelling a JSON array, `?tags=["a","b"]`, is read as that list. An object query parameter is one value spelling the object as JSON.

### Accessing the currently logged in user

`@CurrentUser()` injects the logged in user, as the [auth strategies](./auth.md) of the application resolve them. `@Auth.isLoggedIn()` makes the route require one:

```ts
// src/controllers/user.controller.ts
import { Auth, Controller, CurrentUser, Get } from 'zibri';

@Controller('/users')
export class CurrentUserController {

    @Auth.isLoggedIn()
    @Get('/me')
    async getMe(
        @CurrentUser()
        user: CurrentUser
    ): Promise<void> {
        // your logic
    }

}
```

The user is a `CurrentUser`: your user without their roles, with the `permissions` and `platformPermissions` the request may use, see [roles and permissions](./roles-and-permissions.md#in-your-own-code). `CurrentUser<User>` types it as your own user entity.

To make the user optional, leave out the `@Auth` decorator and pass `required: false` to `@CurrentUser`:

```ts
// src/controllers/article.controller.ts
import { Controller, CurrentUser, Get } from 'zibri';

@Controller('/articles')
export class ArticleController {

    @Get()
    async getArticles(
        @CurrentUser({ required: false })
        user?: CurrentUser
    ): Promise<void> {
        if (user) {
            // return normal articles and premium articles
        }
        else {
            // return only normal articles
        }
    }

}
```

`required: false` says what the handler is given, not who may call it. Under `defaultAuth: 'isLoggedIn'`, the route also needs `@Auth.skip()`, or an anonymous caller is answered with a `401`, see [what an undecorated route requires](./auth.md#what-an-undecorated-route-requires).

A bare `@CurrentUser()` requires a user on its own. A request it resolves no user for is answered with a `401`, whether or not the route carries an `@Auth` decorator, so a handler declaring `user: CurrentUser` always gets one.

`authStrategies` names the auth strategies that may identify the user. The route below is reached only by a caller the cookie strategy resolved, even where the application accepts bearer tokens:

```ts
// src/controllers/user.controller.ts
import { Controller, CookieAuthStrategy, CurrentUser, Get } from 'zibri';

@Controller('/users')
export class SessionOnlyController {
    @Get('/session-only')
    async sessionOnly(
        @CurrentUser({ authStrategies: [CookieAuthStrategy] })
        user: CurrentUser
    ): Promise<void> {
        // your logic
    }
}
```

### Handling file uploads
To upload files, declare a multipart body with `type: MimeType.FORM_DATA`. It carries one or more files beside the other fields of its model:

```ts
// src/controllers/file.controller.ts
import { Body, Controller, File, FormData, MimeType, Post, Property } from 'zibri';

class FileUploadDTO {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;

    @Property.array({ items: { type: 'file', allowedMimeTypes: 'all' } })
    files!: File[];
}

@Controller('/files')
export class FileController {
    @Post()
    async upload(
        @Body(FileUploadDTO, { type: MimeType.FORM_DATA })
        formData: FormData<FileUploadDTO>
    ): Promise<void> {
        // Do something with the form data
    }
}
```

The `FormData` type is the one imported from `zibri`.

Every file property says which files it accepts: `allowedMimeTypes` lists the mime types, or is
`'all'` for any of them. A file of another type is answered with `400`.

Uploads are written to disk while the request is handled. A cron job removes the ones nothing claimed. They go to `.zibri/uploads` in your application by default, beside the nearest `package.json` above the entry point, whichever directory the application was started from. A generated project's `.gitignore` covers it.

Point it somewhere else with the `FILE_UPLOAD_TEMP_FOLDER` token:

```ts
// src/providers.ts
import { defineProvider, FsUtilities, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER,
    useFactory: () => FsUtilities.getPath('/var/lib/my-app/uploads')
})
```

Set it where the application's own directory is read only, or where two applications on one host would otherwise share the folder.

#### Limits on a multipart body

A multipart body has two kinds of limits: its size, and how many parts it has. `baseMaxSize` limits the size. `FORM_DATA_LIMITS` limits the counts, since every file part keeps a file open while it arrives.

The defaults allow 20 files, 1000 parts and 500 fields. A body over any of them is answered with `413`. Set them once for the application:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.FORM_DATA_LIMITS,
    useFactory: () => ({ maxFiles: 20, maxParts: 1000, maxFields: 500 })
})
```

A field's bytes count toward the size of the body. To limit a single field, give its property a `maxLength`: `@Property.string({ maxLength })`.

An endpoint that needs other limits sets them in `limits`, beside its size. It overrides only what it names:

```ts
// src/controllers/file.controller.ts
import { Body, Controller, FormData, MimeType, Post } from 'zibri';

import { GalleryDTO } from '../models';

@Controller('/files')
export class GalleryController {
    @Post('/gallery')
    async uploadGallery(
        @Body(GalleryDTO, { type: MimeType.FORM_DATA, baseMaxSize: '5mb', limits: { maxFiles: 100 } })
        form: FormData<GalleryDTO>
    ): Promise<void> {}
}
```

## Securing endpoints
The decorators of the `@Auth` namespace secure endpoints. Put one on a controller to secure every endpoint on it, or on a single endpoint.

Every decorator has a `skip` property. On one endpoint of a secured controller, `@Auth.skip()` skips every rule, and a decorator's own `skip`, such as `@Auth.isLoggedIn.skip()`, skips that one.

An endpoint with none of these decorators gets the application's `defaultAuth`, a required option. If it is `'isLoggedIn'`, mark an endpoint that is public with `@Auth.skip()`. See [what an undecorated route requires](./auth.md#what-an-undecorated-route-requires).

### Requiring a logged in user
`@Auth.isLoggedIn()` checks that there is a logged in user. Here `/private-stuff` requires one through the controller, and `/public-stuff` skips the rule:

```ts
// src/controllers/auth.controller.ts
import { Auth, Controller, Get } from 'zibri';

@Auth.isLoggedIn()
@Controller('/auth')
export class AuthController {

    @Auth.skip()
    @Get('/public-stuff')
    async getPublicStuff(): Promise<unknown> {
        // your logic that returns public stuff
        return {};
    }

    @Get('/private-stuff')
    async getPrivateStuff(): Promise<unknown> {
        // your logic that returns private stuff
        return {};
    }
}
```

### Requiring no logged in user
`@Auth.isNotLoggedIn()` checks that there is no logged in user, for a route such as a login:

```ts
// src/controllers/auth.controller.ts
import { Auth, Controller, Post } from 'zibri';

@Controller('/auth')
export class LoginAuthController {

    @Auth.isNotLoggedIn()
    @Post('/login')
    async login(): Promise<unknown> {
        // your logic
        return {};
    }
}
```

### Requiring a permission
`@Auth.hasPermission()` checks that a role of the user's [membership](./glossary.md#membership) in the request's [tenant](./tenancy.md#members-and-their-roles) carries the permission, here `invoices.export`. See [roles and permissions](./roles-and-permissions.md):

```ts
// src/controllers/invoice.controller.ts
import { Auth, Controller, Get } from 'zibri';

import { Permissions } from '../models/permissions';

@Controller('/invoices')
export class InvoiceExportController {

    @Auth.hasPermission(Permissions.INVOICES_EXPORT)
    @Get('/export')
    async export(): Promise<unknown> {
        return {};
    }
}
```

### Requiring a platform permission
`@Auth.hasPlatformPermission()` checks that one of the user's own roles carries the permission, whatever tenant the request is for. It fits a route for whoever operates the whole application:

```ts
// src/controllers/operations.controller.ts
import { Auth, Controller, Get } from 'zibri';

import { PlatformPermissions } from '../models/permissions';

@Controller('/operations')
export class OperationsController {

    @Auth.hasPlatformPermission(PlatformPermissions.TENANTS_MANAGE)
    @Get('/tenants')
    async listTenants(): Promise<unknown> {
        return {};
    }
}
```

### Which rows a caller may see
Which rows belong to the logged in user is declared once, on the entity, and applies to every query of every endpoint. A row the caller may not see is not found, the same as a row that does not exist. See [restricting which rows a caller may see](./data-source.md#restricting-which-rows-a-caller-may-see).

## Defining OpenAPI responses
The decorators of the `@Response` namespace declare what an endpoint answers with. The OpenAPI document shows them:

```ts
// src/controllers/user.controller.ts
import { Controller, Get, HttpStatus, MimeType, PaginationResult, Response } from 'zibri';

@Controller('/users')
export class DocumentedUserController {

    @Response.error(HttpStatus.NOT_FOUND)
    @Response.object(User)
    @Response.array(User)
    @Response.paginated(User)
    @Response.empty({ mimeTypes: [MimeType.JSON] })
    @Get()
    async exampleEndpoint(): Promise<void | User | User[] | PaginationResult<User>> {
        // your logic that might throw a 404 error
    }

}
```

Each decorator compiles only on a method that can return what it declares, once awaited: `@Response.object(User)` on a method returning `Promise<Task>` does not compile. A method returning a union takes one decorator per member, as above. A `JsonResponse` counts as the body it wraps.

A JSON response is written as `application/json`, or as another JSON type it names among its `mimeTypes`, such as `mimeTypes: [MimeType.JSON_SCIM, MimeType.JSON]`: the request's `Accept` picks one, and the first is taken when it accepts several or names none.

A JSON response is written with the properties its class declares, nested models included. A handler returning a stored row under a class that names fewer of its columns sends only those. A nested object that allows additional properties keeps them, and a property of type `unknown` keeps whatever it holds. A response declaring no class is written as returned.

Several `@Response.object` with the same status are one of their classes, which the OpenAPI document describes as `oneOf`. `@Response.object` also takes a function answering the class, such as `@Response.object(() => User)`, for a class that is only known once the application has started.

The JSON and empty responses of an endpoint answer in the same formats. `@Response.empty()` answers JSON and XML by default, so next to responses answering one of them alone it names that one, such as `mimeTypes: [MimeType.JSON]`. See [XML](./xml.md#answering-with-xml).

The decorators for responses other than JSON are in [changing the return type](#changing-the-return-type).

### Response statuses
An endpoint answers with the status it declares. This one answers `201`:

```ts
// src/controllers/user.controller.ts
import { Body, Controller, HttpStatus, Post, Response } from 'zibri';

import { CreateUserData } from '../models';

@Controller('/users')
export class CreatedStatusController {
    @Response.object(User, { status: HttpStatus.CREATED })
    @Post()
    async create(@Body(CreateUserData) data: CreateUserData): Promise<User> {
        return { id: '42', ...data };
    }
}
```

The status is the one of the declaration that matches what the method returned. The object, array,
file and HTML declarations each match a different shape. `@Response.error` never matches a returned
value. When two declarations match the same value, neither status is taken and the endpoint answers
`200`, whatever order the decorators are in.

An endpoint that returns nothing answers `204`, with or without `@Response.empty()`. Declare
`@Response.empty({ status: HttpStatus.ACCEPTED })` for work that is accepted and not done yet.

## Changing the return type
An endpoint answers with JSON by default. Return one of the classes below to answer with a file,
with HTML, with a redirect or with headers of your own. A route can also answer with JSON or XML,
picked by the request's `Accept` header, see [XML](./xml.md#answering-with-xml).

The `@Response` decorator beside each of them declares the response for the OpenAPI document.

### Returning files
To answer with a file, return a `FileResponse`:

```ts
// src/controllers/file.controller.ts
import { Controller, FileResponse, FsUtilities, Get, Response } from 'zibri';

@Controller('/files')
export class DownloadFileController {
    @Response.file()
    @Get('/download')
    async downloadFile(): Promise<FileResponse> {
        return FileResponse.fromPath(FsUtilities.getPath('some/path/to/a/file'));
    }
}

```

### Returning HTML
To answer with HTML, return an `HtmlResponse`:

```ts
// src/controllers/html.controller.ts
import { Controller, HtmlResponse, Get, Response } from 'zibri';

@Controller('/html')
export class HtmlController {
    @Response.html()
    @Get('/hello-world')
    async getPage(): Promise<HtmlResponse> {
        return HtmlResponse.fromString('<h1>Hello world</h1>');
    }
}

```

### Redirecting
To send the caller on to another URL, return a `RedirectResponse`. `@Response.redirect()` answers with 303 See Other, which a client follows with a GET; pass `status` for 302 Found or 307 Temporary Redirect:

```ts
// src/controllers/docs.controller.ts
import { Controller, Get, RedirectResponse, Response } from 'zibri';

@Controller('/docs')
export class DocsController {
    @Response.redirect()
    @Get('/latest')
    latest(): RedirectResponse {
        return RedirectResponse.to('https://docs.example.com/v3');
    }
}
```

### Answering with headers
To answer with headers of your own beside a JSON body, return a `JsonResponse`. The status and the JSON type are the ones the route declares, as for a body returned as it is:

```ts
// src/controllers/document.controller.ts
import { Controller, Get, JsonResponse, KnownHeader, Param, Property, Response } from 'zibri';

class DocumentModel {
    @Property.string()
    id!: string;

    @Property.number()
    revision!: number;
}

@Controller('/documents')
export class DocumentController {
    @Response.object(DocumentModel)
    @Get('/:id')
    find(
        @Param.path('id')
        id: string
    ): JsonResponse<DocumentModel> {
        const document: DocumentModel = { id, revision: 3 };
        return JsonResponse.of(document, { headers: { [KnownHeader.ETAG]: `W/"${document.revision}"` } });
    }
}
```

A `GET` answered with an `etag` answers a request whose `If-None-Match` names that etag with `304 Not Modified` and no body.

## Deadlines
A handler has a limited time to produce a result. `handlerTimeoutInMs` of `ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS` sets it for the application, 30 seconds by default. A controller sets it for all of its routes, and a route sets its own:

```ts
// src/controllers/export.controller.ts
import { Controller, Get, Post, Property } from 'zibri';

class ExportResult {
    @Property.string()
    downloadUrl!: string;
}

@Controller('/exports', { timeoutInMs: 30_000 })
export class ExportController {

    @Get('/')
    async findAll(): Promise<ExportResult[]> {
        return [];
    }

    @Get('/names', { timeoutInMs: 2_000 })
    async findNames(): Promise<string[]> {
        return [];
    }

    @Post('/', { timeoutInMs: 'none' })
    async create(): Promise<ExportResult> {
        return { downloadUrl: '/files/export.csv' };
    }
}
```

`findAll` has the 30 seconds of its controller, `findNames` two seconds, and `create` as long as it takes.

A handler that runs out of its time is answered with `504 Gateway Timeout`, carrying the `traceId` of the request like every other error. The deadline covers the handler alone. Writing the response is outside it, so a stream, a download and server-sent events need no deadline of their own.

The handler keeps running after its deadline. What it waits on through the framework stops waiting:

| Waits on | What the deadline does to it |
|---|---|
| `HttpClient` | Ends the call and lets the connection go. Whichever of the call's own `timeoutInMs` and the route's deadline comes first ends it, and a retry that was backing off stops |
| `LeaseService` in `'wait'` mode | Stops queueing for the [lease](./glossary.md#lease) instead of waiting out its `acquireTimeoutInMs` |
| `MultithreadingService.waitForThreadJob` | Stops waiting for the job. The job keeps running and records what it did |
| A repository | Refuses its next operation. A statement already running is stopped, where the data source supports that |

Each of those fails with the same `GatewayTimeoutError` the caller was answered with, so one error describes the whole request.

For anything else a handler waits on, `signal` on the request context fires the moment the deadline passes. Pass it on:

```ts
// src/controllers/search.controller.ts
import { Controller, Get, HttpRequestContext, inject, Param, WebsocketRequestContext, ZIBRI_DI_TOKENS } from 'zibri';

@Controller('/search')
export class SearchController {

    @Get('/', { timeoutInMs: 2_000 })
    async findAll(
        @Param.query('q', { type: 'string' })
        q: string
    ): Promise<string[]> {
        const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        // your own call, with the signal passed on
        const res: Response = await fetch(`https://upstream.example.com/search?q=${q}`, { signal: ctx?.signal });
        return await res.json() as string[];
    }
}
```

The deadline is separate from `requestTimeoutInMs`, which limits how long the request takes to arrive. A slow upload does not shorten the deadline of the handler it reaches.

## How a response is sent
Whatever an endpoint returns is serialized once and written. On the way out it is compressed and gets an ETag, both decided per request.

**Compression.** A body of a text type, such as JSON, HTML, CSS, CSV, XML, SVG or plain text, is encoded with brotli or gzip when the client's `accept-encoding` asks for one and the body is at least a kilobyte. A streamed response of such a type is always encoded. Every other type, such as an image, a video or an office document, is sent as it is, and so is `text/event-stream`.

The response carries `Vary: Accept-Encoding` either way, so a cache in front of it keeps the two answers apart.

Turn compression off where a proxy in front of the application compresses already:

```ts
// src/providers.ts
import { CompressionOptions, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.COMPRESSION_OPTIONS,
    useFactory: (): CompressionOptions => ({ enabled: false, thresholdInBytes: 1024 })
})
```

**ETags.** Every response gets a weak ETag, computed from the body before it is encoded. A `GET` repeating it in `If-None-Match` is answered with `304 Not Modified` and no body. There is nothing to configure. A load test sending `If-None-Match` measures those `304`s, not the time it takes to build the answer.

## Requirements
| Package | Used for |
|---|---|
| `express` | Receiving HTTP requests and sending the responses |
| `path-to-regexp` | Matching request paths to routes and their path parameters |
| `@fastify/busboy` | Reading multipart bodies, the ones carrying file uploads. You install it |
| `swagger2openapi` | Reading a Swagger 2.0 document when generating entities from an OpenAPI document. You install it |

## See also
- [Models](./models.md) — the `@Property` decorators request bodies and responses are declared with
- [Data sources](./data-source.md) — entities used as request bodies, and the scopes that restrict their rows
- [The OpenAPI document](./open-api.md) — where the document the decorators describe is served, and how to restrict it
- [Error handling](./error-handling.md) — the errors thrown/documented via `@Response.error`
- [Templating](./templating.md) — building the html returned via `HtmlResponse`
