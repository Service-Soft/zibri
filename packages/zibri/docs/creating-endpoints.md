# Creating endpoints
Zibri uses controller classes for registering endpoints.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Controller` | decorator | Marks a class as a controller and defines its base route |
| `ControllerUtilities` | class | Where the endpoints of a controller are |
| `Get` | decorator | Defines a GET endpoint |
| `Post` | decorator | Defines a POST endpoint |
| `Put` | decorator | Defines a PUT endpoint |
| `Patch` | decorator | Defines a PATCH endpoint |
| `Delete` | decorator | Defines a DELETE endpoint |
| `Property` | namespace | Decorators for defining model properties |
| `Body` | decorator | Injects and validates the request body, `Body.oneOf` for a body of several shapes |
| `Param` | namespace | Decorators for path, query and header parameters |
| `CurrentUser` | decorator | Injects the currently logged in user |
| `Auth` | namespace | Decorators for securing endpoints |
| `Response` | namespace | Decorators for documenting OpenAPI responses |
| `FileResponse` | class | Response type for returning files |
| `HtmlResponse` | class | Response type for returning html |
| `RedirectResponse` | class | Response type for sending the caller to another url |
| `JsonResponse` | class | Response type for answering with headers beside a json body |
| `File` | class | Represents an uploaded file |
| `FormData` | class | Typed wrapper for a form-data request body |
| `MimeType` | enum | Mime type constants (eg. for allowed file uploads) |
| `OmitClass` | function | Creates a class that omits given properties from a base class |
| `PickClass` | function | Creates a class that picks given properties from a base class |
| `IntersectionClass` | function | Combines multiple classes into one |
| `CrudController` | function | Base controller providing generic CRUD endpoints |
| `HttpStatus` | enum | HTTP status code constants |
| `PaginationResult` | type | Shape of a paginated response |

## Usage
### Defining a controller
You can define any class to be a controller by using the `@Controller` decorator:

```ts
// src/controllers/user.controller.ts
import { $ts, BaseEntity, CompressionOptions, CookieAuthStrategy, Controller, defineProvider, Entity, EntityScopeContext, FsUtilities, HttpStatus, InjectRepository, Post, Repository, Response, scopeFor, UnauthorizedError, ZIBRI_DI_TOKENS, ZibriApplication } from 'zibri';

import { applicationOptions } from '../application-options';
import { CreateUserData, GalleryDTO } from '../models';

@Controller('/users')
export class UserController {
    // ...
}
```

The `/users` provided to the decorator is the base route of the controller. Meaning that all endpoints you define in the controller are prefixed with it.

A class extending a controller keeps its endpoints. Give it a `@Controller` of its own to serve them under another base route. `ControllerUtilities.resolveUrl(UserController)` answers where the endpoints of a controller are: your `baseUrl`, followed by its base route.

You then need to register the controller in the application:

```ts
// src/index.ts

// ...
    const app: ZibriApplication = new ZibriApplication({
        ...applicationOptions,
        controllers: [
            UserController
        ]
    })
// ...
```

### Defining endpoints on the controller
To actual define your first endpoint, you need to create a method and decorate it with the respective decorators. The example below shows a simple endpoint for getting some arbitrary users:

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

    @Get() // <- Defines that its is a get endpoint
    async find(): Promise<User[]> {
        return [{ id: '42', name: 'Test User', email: 'user@test.com' }];
    }

}
```

By default, a value you return in your method is sent as json to the client. If you want to return a different content type you can take a look at the [changing the return type section](#changing-the-return-type)

You can try the example above and navigate to your applications open api explorer (`http://localhost:3000/explorer` by default).

You should now see a new route get `/users` with the correctly defined return type.

### Inheritance for controllers
You can use inheritance for controllers using generics and even with the provided helper types like "OmitClass", "PickClass" etc. Zibri additionally provides a helper type for defining base crud endpoints that you can also extend from:

```ts
// src/controllers/test-crud.controller.ts
import { IntersectionClass, Controller, CrudController, OmitClass, PickClass } from 'zibri';

import { Test, TestCreateDTO, TestUpdateDTO } from '../models';

@Controller('/metrics')
class MetricsController {
    @Get('/dashboard')
    async dashboard(): Promise<unknown> {
        return {};
    }
}

@Controller('/tests-crud')
export class TestCrudController extends IntersectionClass(
    OmitClass(CrudController(Test, TestCreateDTO, TestUpdateDTO), ['deleteById']),
    PickClass(MetricsController, ['dashboard'])
) {}
```

The above will expose the endpoints
- `POST /tests-crud` (coming from CrudController, with TestCreateDTO as body)
- `GET /tests-crud` (coming from CrudController, which returns a PaginatedResponse of Test)
- `GET /tests-crud/:id` (coming from CrudController, which returns a single Test)
- `PATCH /tests-crud/:id` (coming from CrudController, which updates a single Test with TestUpdateDTO)
- `GET /metrics` (coming from MetricsController, which in this example returns a html dashboard)

### Accessing request data

#### request body

To access the request body, you need to use the `@Body()` decorator with the [model](./models.md) of the request body. This also automatically handles validation for you:

```ts
// src/controllers/user.controller.ts
import { Body, Post, OmitClass } from 'zibri';

class UserCreateDTO extends OmitClass(User, ['id']) {}

@Controller('/users')
export class WritingUserController {

    @Post()
    async create(
        @Body(UserCreateDTO) // <- Automatically handles validation for you
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

For the special case of uploading files we have a [separate section](#handling-file-uploads). A body sent as xml is declared with `type: MimeType.XML`, see [XML](./xml.md#receiving-an-xml-body).

A json body is read in every json type: `application/json`, and every format written in json that carries the `+json` suffix, such as `application/scim+json` or `application/merge-patch+json`. A body that names one of them, eg. `@Body(UserCreateDTO, { type: MimeType.JSON_SCIM })`, is read in that one alone, and any other is refused with a `415`.

You can try the example above and navigate to your applications open api explorer (`http://localhost:3000/explorer` by default).

You should now see a new route post `/users` with the correctly defined request body and return type.

A body that is a list of the model is declared with `isArray`:

```ts
@Controller('/users')
export class BulkUserController {
    @Post('/bulk')
    async createMany(@Body(UserCreateDTO, { isArray: true }) createData: UserCreateDTO[]): Promise<void> {
        // your logic
    }
}
```

#### A form

A body an html form sends without files is declared with `type: MimeType.FORM_URL_ENCODED`. Each field fills the property of the same name, read as that property's type, and a field sent once per item fills a list:

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

#### A body of several shapes

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

#### path, query and header params

To access path, query and header params you can use the respective decorators on your route:

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

These decorators also handle validation for you.

You can try the example above and navigate to your applications open api explorer (`http://localhost:3000/explorer` by default).

You should now see a new route post `/newsletters/:id/signup` with the correctly defined parameters.

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

#### Accessing the currently logged in user

Zibri provides an easy way to inject the currently logged in user by leveraging its auth framework. We won't go into the details of how that works here, but you can inject a user as follows:

```ts
// src/controllers/user.controller.ts
import { Auth, Controller, CurrentUser, Get } from 'zibri';

@Controller('/users')
export class CurrentUserController {

    @Auth.isLoggedIn() // <- Automatically handles checking that there is a logged in user
    @Get('/me')
    async getMe(
        @CurrentUser() // <- Injects the currently logged in user automatically.
        user: User
    ): Promise<void> {
        // your logic
    }

}
```

In the example above it's required to be logged in to access the route. You can also omit the `@Auth` decorator and pass `false` to the `@CurrentUser` decorator. This makes the user parameter optional:

```ts
// src/controllers/article.controller.ts
import { Controller, CurrentUser, Get } from 'zibri';

@Controller('/articles')
export class ArticleController {

    @Get()
    async getArticles(
        @CurrentUser(false) // <- Marks the currently logged in user as optional
        user?: User
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

A bare `@CurrentUser()` is required on its own: a request it cannot resolve a user for is answered with a 401, whether or not the route also carries an `@Auth` decorator. That is what makes the parameter's type honest — a handler declaring `user: User` is never called with nothing.

A second argument narrows which credential may identify that user, which is worth stating on a route that accepts only one of several ways in:

```ts
@Controller('/users')
export class SessionOnlyController {
    @Get('/session-only')
    async sessionOnly(
        @CurrentUser(true, [CookieAuthStrategy])
        user: User
    ): Promise<void> {
        // reached only by a caller the cookie strategy resolved, even though the application
        // accepts bearer tokens elsewhere
    }
}
```

You can try the example above and navigate to your applications open api explorer (`http://localhost:3000/explorer` by default).

You should now see a new route get `/articles` which can return different results based on whether you are logged in or not.

#### handling file uploads
Zibri supports the uploading of one or multiple files together with some optional request data by using form-data:

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

> Notice that `FormData` is being imported from Zibri.

Every file property says which files it accepts: `allowedMimeTypes` lists the mime types, or is
`'all'` for any of them. A file of another type is answered with `400`.

Uploads are written to disk while the request is handled, and a cron job removes the ones nothing claimed. The default location is `.zibri/uploads` in your application — the nearest `package.json` above the entry point, so it stays put no matter which directory the app was started from. A generated project's `.gitignore` already covers it.

Point it somewhere else with the `FILE_UPLOAD_TEMP_FOLDER` token:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER,
    useFactory: () => FsUtilities.getPath('/var/lib/my-app/uploads')
})
```

Worth setting explicitly if the application runs somewhere its own directory is read only, or if two applications share a host and you would rather they did not share an upload folder.

##### limits on a multipart body

A multipart body is bounded twice: by how much it weighs and by how many parts it is made of. `baseMaxSize` covers the weight. The counts are `FORM_DATA_LIMITS`, and they matter because each part costs something while it is being read — every file part holds an open write stream, so a thousand one-byte files weigh nothing and still tie up a thousand file descriptors.

The defaults allow 20 files, 1000 parts and 500 fields. A body over any of them is answered with `413`. Set them once for the application:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.FORM_DATA_LIMITS,
    useFactory: () => ({ maxFiles: 20, maxParts: 1000, maxFields: 500 })
})
```

There is no per-field size here: a field's bytes are already inside the body's budget, and how long one value may legitimately be belongs to the field — say it with `@Property.string({ maxLength })` on the model.

An endpoint that needs different ones says so beside its size, and overrides only what it names:

```ts
@Controller('/files')
export class GalleryController {
    @Post('/gallery')
    async uploadGallery(
        @Body(GalleryDTO, { type: MimeType.FORM_DATA, baseMaxSize: '5mb', limits: { maxFiles: 100 } })
        form: FormData<GalleryDTO>
    ): Promise<void> {}
}
```

### Securing endpoints
To secure and protect your endpoints Zibri provides the `@Auth` namespace which has a lot of differnt decorators that handle most use cases. These decorators can be used either on the whole controller, securing every endpoint on it or on a single endpoint, depending on your needs.

Every decorator also comes with a `skip` property, so you can easily secure a controller and skip all auth or certain auth rules for a single endpoint.

An endpoint carrying none of these decorators is not unprotected by omission: it gets whatever the application declared as its `defaultAuth`, which is a required option with no default. If that is `'requireLogin'`, an endpoint you meant to be public says so with `@Auth.skip()`. See [what an undecorated route requires](./auth.md#what-an-undecorated-route-requires).

#### isLoggedIn
Checks if there is a logged in requesting user.

```ts
// src/controllers/auth.controller.ts
import { Auth, Controller, Get } from 'zibri';

@Auth.isLoggedIn()
@Controller('/auth')
export class AuthController {

    @Auth.skip() //<- You could also do @Auth.isLoggedIn.skip(), because the controller is only decorated with @Auth.isLoggedIn()
    @Get('/public-stuff')
    async getPublicStuff(): Promise<unknown> {
        // your logic that returns public stuff
        return {};
    }

    // We don't need to decorate the endpoint with @Auth.isLoggedIn because that is already done on the controller level
    @Get('/private-stuff')
    async getPrivateStuff(): Promise<unknown> {
        // your logic that returns private stuff
        return {};
    }
}
```

#### isNotLoggedIn
Checks if there is no requesting user.

```ts
// src/controllers/auth.controller.ts
import { Auth, Controller, Post } from 'zibri';

@Controller('/auth')
export class LoginAuthController {

    @Auth.isNotLoggedIn()
    @Post('/login')
    async login(): Promise<unknown> {
        // a user that is already logged in should not be able to login again.
        return {};
    }
}
```

#### hasRole
Determines if the currently logged in user holds a certain role in the [tenant](./tenancy.md#members-and-their-roles) the request is for, through their membership in it:

```ts
// src/controllers/auth.controller.ts
import { Auth, Controller, Get } from 'zibri';

@Auth.isLoggedIn()
@Controller('/auth')
export class AdminAuthController {

    // ...

    // ensures that the logged in user has the role of "admin" in the request's tenant
    @Auth.hasRole(['admin'])
    @Get('/admin-stuff')
    async getAdminStuff(): Promise<unknown> {
        // your logic that returns stuff for admin users
        return {};
    }
}
```

#### hasPlatformRole
Determines if the currently logged in user holds a certain role of their own, independant of the tenant the request is for:

```ts
// src/controllers/operations.controller.ts
import { Auth, Controller, Get } from 'zibri';

@Controller('/operations')
export class OperationsController {

    // ensures that the logged in user operates the whole application
    @Auth.hasPlatformRole(['operator'])
    @Get('/tenants')
    async listTenants(): Promise<unknown> {
        return {};
    }
}
```

#### Which rows a caller may see
"This resource belongs to the logged in user" is declared once on the entity rather than on each endpoint, so it applies to every query and cannot be forgotten on one of them:

```ts
@Entity({
    scope: {
        restrictedTo: scopeFor<PersonalDocument>((ctx: EntityScopeContext) => {
            if (!ctx.currentUser) {
                throw new UnauthorizedError($ts`Documents belong to a user.`);
            }
            return { userId: ctx.currentUser.id };
        })
    }
})
export class PersonalDocument extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string({ format: 'uuid' })
    userId!: string;
}
```

```ts
@Auth.isLoggedIn()
@Controller('/personal-documents')
export class PersonalDocumentController {
    constructor(
        @InjectRepository(PersonalDocument)
        private readonly documents: Repository<PersonalDocument>
    ) {}

    // answers with the caller's own documents
    @Get()
    async list(): Promise<PersonalDocument[]> {
        return await this.documents.findAll();
    }

    // 404 for a document somebody else owns, the same as for one that does not exist
    @Get('/:id')
    async byId(@Param.path('id') id: string): Promise<PersonalDocument> {
        return await this.documents.findById(id);
    }
}
```

See [restricting which rows a caller may see](./data-source.md#restricting-which-rows-a-caller-may-see) for what it does to writes, how rows that are public and rows that are private live in one table, and what code outside a request has to say.

### Defining open api responses
For defining responses, Zibri offers the `@Response` namespace which has a lot of decorators you can use on your endpoints:

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
        // your logic that might throw an 404 error
    }

}
```

A json response is written as `application/json`, or as another json type it names among its `mimeTypes`, eg. `mimeTypes: [MimeType.JSON_SCIM, MimeType.JSON]`: the request's `Accept` picks one, and the first is taken when it accepts several or names none.

Several `@Response.object` with the same status are one of their classes, which the OpenAPI document describes as `oneOf`. `@Response.object` also takes a function answering the class, eg. `@Response.object(() => User)`, for a class that is only known once the application has started.

The json and empty responses of an endpoint answer in the same formats, and the application refuses to start otherwise. `@Response.empty()` answers json and xml by default, so next to responses answering one of them alone it names that one, eg. `mimeTypes: [MimeType.JSON]`. See [XML](./xml.md#answering-with-xml).

There are additional decorators for non json return values, which are documented in the [changing the return type section](#changing-the-return-type)

#### Response statuses
A declared status is the one the endpoint answers with, not just the one it documents:

```ts
@Controller('/users')
export class CreatedStatusController {
    @Response.object(User, { status: HttpStatus.CREATED })
    @Post()
    async create(@Body(CreateUserData) data: CreateUserData): Promise<User> {
        return { id: '42', ...data }; // answers 201
    }
}
```

Zibri picks it by matching what you returned against what you declared — the object, array, file and
html declarations each describe a different shape, and `@Response.error` never applies to a value
that was returned successfully. Declare two responses that could both describe the same value and
neither is chosen, because the answer would otherwise depend on the order you wrote the decorators
in.

**An endpoint that returns nothing answers `204`**, whether or not it says so with
`@Response.empty()`. Reach for `@Response.empty({ status: HttpStatus.ACCEPTED })` when the work was only
accepted rather than done.

### Changing the return type
By default, Zibri sends back the returned value from your endpoints as json. In the following, we will take a look at how you can change that. A route can also answer with json or xml, picked by the request's `Accept` header, see [XML](./xml.md#answering-with-xml).

#### Returning files
To return files instead of json, Zibri offers the `FileResponse` class:

```ts
// src/controllers/file.controller.ts
import { Controller, FileResponse, Get, Response } from 'zibri';

@Controller('/files')
export class DownloadFileController {
    @Response.file() // <- Used by the open api explorer.
    @Get('/download')
    async downloadFile(): Promise<FileResponse> {
        return FileResponse.fromPath(FsUtilities.getPath('some/path/to/a/file'));
    }
}

```

#### Returning html
To return html instead of json, Zibri offers the `HtmlResponse` class:

```ts
// src/controllers/html.controller.ts
import { Controller, HtmlResponse, Get, Response } from 'zibri';

@Controller('/html')
export class HtmlController {
    @Response.html() // <- Used by the open api explorer.
    @Get('/hello-world')
    async getPage(): Promise<HtmlResponse> {
        return HtmlResponse.fromString('<h1>Hello world</h1>');
    }
}

```

#### Redirecting
To send the caller on to another url, return a `RedirectResponse`. `@Response.redirect()` answers with 303 See Other, which a client follows with a GET; pass `status` for 302 Found or 307 Temporary Redirect:

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

#### Answering with headers
To answer with headers of your own beside a json body, return a `JsonResponse`. The status and the json type are the ones the route declares, as for a body returned as it is:

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

### Deadlines
A handler has a limited time to produce a result. The application sets it with `handlerInMs`, a controller sets it for all of its routes, and a route sets its own:

```ts
// src/controllers/export.controller.ts
import { Controller, Get, Post, Property } from 'zibri';

class ExportResult {
    @Property.string()
    downloadUrl!: string;
}

@Controller('/exports', { timeoutInMs: 30_000 })
export class ExportController {

    // 30 seconds, from the controller
    @Get('/')
    async findAll(): Promise<ExportResult[]> {
        return [];
    }

    // two seconds, because this one answers a dropdown
    @Get('/names', { timeoutInMs: 2_000 })
    async findNames(): Promise<string[]> {
        return [];
    }

    // as long as it takes
    @Post('/', { timeoutInMs: 'none' })
    async create(): Promise<ExportResult> {
        return { downloadUrl: '/files/export.csv' };
    }
}
```

A handler that runs out of its time is answered with `504 Gateway Timeout`, carrying the `traceId` of the request like every other error. The clock covers the handler alone: once it has returned and the response is being written, nothing cuts it off, so a stream, a download and a page of server-sent events are outside a deadline without having to say so.

The handler itself is not stopped — nothing can stop code that is waiting for something. What the framework does instead is tell everything that waits on your behalf, and three of its own already listen:

| Waits on | What the deadline does to it |
|---|---|
| `HttpClient` | Ends the call and lets the connection go. Whichever of the call's own `timeoutMs` and the route's deadline comes first is the one that ends it, and a retry that was backing off stops backing off |
| `LeaseService` in `'wait'` mode | Stops queueing for the lease instead of waiting out its `acquireTimeoutInMs` |
| `MultithreadingService.waitForThreadJob` | Stops waiting for the job. The job keeps running and still records what it did — a caller going away is not a reason to throw work away |
| A repository | Refuses the next operation rather than issuing it. A statement already running is stopped where it runs, when the store can do that |

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
        // whatever the handler waits for is what needs to hear about the deadline
        const res: Response = await fetch(`https://upstream.example.com/search?q=${q}`, { signal: ctx?.signal });
        return await res.json() as string[];
    }
}
```

The deadline is independent of `requestInMs`, which is about the request arriving rather than about the work it asks for. A slow upload spends its own budget and the handler it reaches still gets all of its own.

### How a response is sent
Whatever an endpoint returns is serialized once and written. Two things happen to it on the way out, both decided per request:

**Compression.** A body of a text-shaped type — json, html, css, csv, xml, svg, plain text — is encoded with brotli or gzip when the client's `accept-encoding` asks for one and the body is at least a kilobyte. Streamed responses have no length to compare against and are always encoded. Everything else is sent as it is: an image, a video, a font or an office document is already compressed, and `text/event-stream` must not be, because an encoder holds bytes back until it has enough of them to be worth writing.

The response carries `Vary: Accept-Encoding` either way, so a cache in front of it keeps the two answers apart.

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.COMPRESSION_OPTIONS,
    // where something in front of the application already compresses, this is work better spent
    // there: it runs on the same thread pool that hashes passwords
    useFactory: (): CompressionOptions => ({ enabled: false, thresholdInBytes: 1024 })
})
```

**ETags.** Every response gets a weak validator computed from the body before it is encoded, and a request repeating it in `If-None-Match` is answered with `304 Not Modified` and no body at all. Nothing has to be configured for this, and it is worth knowing when measuring: a client that sends the header is not measuring what it takes to build the answer.

## See also
- [Models](./models.md) — the `@Property` decorators request bodies and responses are declared with
- [Data sources](./data-source.md) — entities used as request bodies, and the scopes that restrict their rows
- [Error handling](./error-handling.md) — the errors thrown/documented via `@Response.error`
- [Templating](./templating.md) — building the html returned via `HtmlResponse`
