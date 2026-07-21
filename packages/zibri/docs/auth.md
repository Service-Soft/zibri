# Authentication & Authorization
The following guide will explain to you how the auth system in Zibri works and how you can extend it.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BaseUserEntity` | function | Helper base class to extend your own user entity from |
| `AuthService` | class | Manages the registered auth strategies and exposes generic auth checks |
| `JwtAuthStrategy` | class | Builtin auth strategy sending a Bearer token, used by default |
| `UserRepo` | decorator | Registers a class as the user repository |
| `UserRepositoryInterface` | interface | Contract for finding a user by email and resolving their credentials |
| `JwtCredentials` | class | Entity storing the credentials for the builtin `JwtAuthStrategy` |
| `repositoryTokenFor` | function | Resolves the DI token for a given entity's repository |

## Usage
### Auth strategies
Zibris auth system is based on so called "auth strategies".

Each strategy comes with all the required functionality built in to
- resolve a user
- login
- logout
- refresh the current login session
- check if there is a logged in user in the current request
- check if that logged in user has a specific role
- check if that logged in user belongs to a specific entity 
- functionality for resetting a password

You can register an auth strategy by defining it on the application options. By default the builtin JwtAuthStrategy is used.

However, you will probably never use these strategies directly, as Zibri provides an AuthService that automatically manages these strategies in the background for you:

### AuthService
The auth service is where the auth strategies are managed. It bundles all their functionality and provides generic methods to eg. check if there is a logged in user, with any of the auth strategies registered.

So you could use the builtin JwtAuthStrategy (registered by default when no auth strategies have been provided) which sends a Bearer token with the currently logged in user data and another custom strategy that might use cookies/anything else to determine the currently logged in user and the AuthService is able to determine if a user is logged in, no matter which strategy he uses.

### Creating and registering user models
Another crucial part of the auth system are users. They need to contain at least an email and an array of roles. A password is actually not required, as some strategies might use third party providers like google etc.

Zibri provides a helper class you can easily extend from:

```ts
// src/models/user.model.ts
import { Entity, Property, BaseUserEntity } from 'zibri';

import { Company } from './company.model';
import { Roles } from './roles.enum';

@Entity()
export class User extends BaseUserEntity(Roles) {
    // your custom properties that your users should have
}
```

For the builtin user service you now also need to register a user repository, so that a user can be found by email over multiple data source entities (used eg. by the default JwtAuthStrategy):

```ts
// src/repositories/user.repository.ts
import { inject, InjectRepository, JwtCredentials, Repository, repositoryTokenFor, UserRepo, UserRepositoryInterface } from 'zibri';

import { Roles, User, UserCreateData } from '../models';

// The whole "extends Repository<User, UserCreateData>" is not required, but in most cases it makes a lot of sense
@UserRepo()
export class UserRepository extends Repository<User, UserCreateData>
    implements UserRepositoryInterface<Roles, User, JwtCredentials> {

    constructor(
        @InjectRepository(User)
        repo: Repository<User>
    ) {
        super(User, repo);
    }

    async findByEmail(email: string): Promise<User> {
        return await this.findOne({ where: { email } });
    }

    async resolveCredentialsFor(user: User): Promise<JwtCredentials> {
        const repo: Repository<JwtCredentials> = inject(repositoryTokenFor(JwtCredentials));
        return repo.findOne({ where: { userId: user.id } });
    }
}
```

## See also
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — securing endpoints with the `@Auth` decorators
- [Data sources](./data-source.md) — repositories and entities used by the user model
- [Error handling](./error-handling.md) — errors thrown by the auth system
