# Creating endpoints
Zibri uses controller classes for registering endpoints.

## Defining a controller
You can define any class to be a controller by using the `@Controller` decorator:

```ts
import { Controller } from 'zibri';

@Controller('/users')
export class UserController {
    // ...
}
```

The `/users` provided to the decorator is the base route of the controller. Meaning that all endpoints you define in the controller are prefixed with it.

You then need to register the controller in the application:

```ts
// index.ts

// ...
    const app: ZibriApplication = new ZibriApplication({
        name: 'Api',
        baseUrl: 'http://localhost:3000',
        controllers: [
            UserController
        ],
        // ...
    })
// ...
```

## Defining endpoints on the controller
To actual define your first endpoint, you need to create a method and decorate it with the respective decorators. The example below shows a simple endpoint for getting some arbitrary users:

```ts
import { Controller, Get, Property } from 'zibri';

class User {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ required: false })
    name?: string;

    @Property.string({ format: 'email' })
    email!: string;
}

@Controller('/users')
export class UserController {

    @Get() // <- Defines that its is a get endpoint
    async find(): Promise<User[]> {
        return [{ id: '42', name: 'Test User', email: 'user@test.com' }];
    }

}
```

By default, a value you return in your method is sent as json to the client. If you want to return a different content type you can take a look at the [changing the return type section](#changing-the-return-type)

You can try the example above and navigate to your applications open api explorer (`explorer` by default).

You should now see a new route get `/users` with the correctly defined return type.

## Accessing request data

### request body

To access the request body, you need to use the `@Body()` decorator with the class of the request body. This also automatically handles validation for you:

```ts
import { Body, Controller, Post, OmitType } from 'zibri';

class User {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ required: false })
    name?: string;

    @Property.string({ format: 'email' })
    email!: string;
}

class UserCreateDto extends OmitType(User, ['id']) {}

@Controller('/users')
export class UserController {

    @Post()
    async create(
        @Body(UserCreateDTO) // <- Automatically handles validation for you
        createData: UserCreateDTO
    ): Promise<User> {
        const createdUser = // ... create a new user
        return createdUser;
    }

}
```

For the special case of uploading files we have a [separate section](#handling-file-uploads).

You can try the example above and navigate to your applications open api explorer (`explorer` by default).

You should now see a new route post `/users` with the correctly defined request body and return type.

### path, query and header params

To access path, query and header params you can use the respective decorators on your route:

```ts
import { Controller, Post, Param } from 'zibri';

@Controller('/newsletters')
export class NewsletterController {

    @Post('/:id/signup')
    async create(
        @Param.path('id', { type: 'string', format: 'uuid' })
        newsletterId: string,
        @Param.header('User-Agent')
        userAgent: string
        @Param.query('affiliateId', { required: false })
        affiliateId?: string,
    ): Promise<void> {
        // your logic for signing up for a newsletter
    }

}
```

These decorators also handle validation for you.

You can try the example above and navigate to your applications open api explorer (`explorer` by default).

You should now see a new route post `/newsletters/:id/signup` with the correctly defined parameters.

### Accessing the currently logged in user

Zibri provides an easy way to inject the currently logged in user by leveraging its auth framework. We won't go into the details of how that works here, but you can inject a user as follows:

```ts
import { Auth, Controller, CurrentUser, Get } from 'zibri';

@Controller('/users')
export class UserController {

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

You can try the example above and navigate to your applications open api explorer (`explorer` by default).

You should now see a new route get `/articles` which can return different results based on whether you are logged in or not.

### handling file uploads
Zibri supports the uploading of one or multiple files together with some optional request data by using form-data:

```ts
import { Body, Controller, File, FormData, MimeType, Post, Property } from 'zibri';

class FileUploadDTO {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;

    @Property.array({ items: { type: 'file' } })
    files!: File[];
}

@Controller('/files')
export class FilesController {
    @Post()
    async upload(
        @Body(FileUploadDTO, { type: MimeType.FORM_DATA })
        formData: FormData<FileUploadDTO>
    ): Promise<void> {
        // Do something with the form data
    }
}
```

## Securing endpoints
To secure and protect your endpoints Zibri provides the `@Auth` namespace which has a lot of differnt decorators that handle most use cases. These decorators can be used either on the whole controller, securing every endpoint on it or on a single endpoint, depending on your needs.

Every decorator also comes with a `skip` property, so you can easily secure a controller and skip all auth or certain auth rules for a single endpoint.

### isLoggedIn
Checks if there is a logged in requesting user.

```ts
import { Auth, Controller, Get } from 'zibri';

@Auth.isLoggedIn()
@Controller('/auth')
export class AuthController {

    @Auth.skip() //<- You could also do @Auth.isLoggedIn.skip(), because the controller is only decorated with @Auth.isLoggedIn()
    @Get('/public-stuff')
    async getPublicStuff(): Promise<unknown> {
        // your logic that returns public stuff
    }

    // We don't need to decorate the endpoint with @Auth.isLoggedIn because that is already done on the controller level
    @Get('/private-stuff')
    async getPrivateStuff(): Promise<unknown> {
        // your logic that returns private stuff
    }
}
```

### isNotLoggedIn
Checks if there is no requesting user.

```ts
import { Auth, Controller, Post } from 'zibri';

@Controller('/auth')
export class AuthController {

    @Auth.isNotLoggedIn()
    @Post('/login')
    async login(): Promise<unknown> {
        // a user that is already logged in should not be able to login again.
    }
}
```

### hasRole
Determines if the currently logged in user has a certain role:

```ts
import { Auth, Controller, Get } from 'zibri';

@Auth.isLoggedIn()
@Controller('/auth')
export class AuthController {

    // ...

    // ensures that the logged in user has the role of "admin"
    @Auth.hasRole(['admin'])
    @Get('/admin-stuff')
    async getAdminStuff(): Promise<unknown> {
        // your logic that returns stuff for admin users
    }
}
```

### belongsTo
Probably the most complex auth decorator of Zibri is `@Auth.belongsTo`.

It automatically checks if the ressource being requested belongs to the currently logged in user.

```ts
import { Auth, Controller, Get, Property } from 'zibri';

// !IMPORTANT: unless you are using a custom auth strategy this needs to be an entity
// that is registered in a database. More on that can be found on the page "handling-databases".
class PersonalDocument {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ format: 'uuid' })
    userId!: string;
}

@Auth.isLoggedIn()
@Controller('/auth')
export class AuthController {
    // This defines:
    // - that there needs to be a personal document with the id of the path paramter "id"
    // - that said personal document needs to have a "userId"
    // - that said userId matches the id of the currently logged in user.
    // both "id" and "userId" are the default values, so they could be omitted in this case.
    @Auth.belongsTo(PersonalDocument, 'id', 'userId')
    @Get('/personal-documents/:id')
    async getPersonalDocument(): Promise<PersonalDocument> {
        // your logic that returns the personal document with the given path parameter id
    }
}
```

## Defining open api responses
For defining responses, Zibri offers the `@Response` namespace which has a lot of decorators you can use on your endpoints:

```ts
import { Controller, Get, HttpStatus, PaginationResult, Response } from 'zibri';

@Controller('/users')
export class UserController {

    @Response.error(HttpStatus.NOT_FOUND)
    @Response.object(User)
    @Response.array(User)
    @Response.paginated(User)
    @Response.empty()
    @Get()
    async exampleEndpoint(): Promise<void | User | User[] | PaginationResult<User>> {
        // your logic that might throw an 404 error
    }

}
```

There are additional decorators for non json return values, which are documented in the [changing the return type section](#changing-the-return-type)

## Changing the return type
By default, Zibri sends back the returned value from your endpoints as json. In the following, we will take a look at how you can change that.

### Returning files
To return files instead of json, Zibri offers the `FileResponse` class:

```ts
import { Controller, FileResponse, Get, Response } from 'zibri';

@Controller('/files')
export class FileController {
    @Response.file() // <- Used by the open api explorer.
    @Get('/download')
    async downloadFile(): Promise<FileResponse> {
        return FileResponse.fromPath('some/path/to/a/file');
    }
}

```

### Returning html
To return html instead of json, Zibri offers the `HtmlResponse` class:

```ts
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
