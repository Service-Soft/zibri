import { inject, ZIBRI_DI_TOKENS } from '../di';
import { register } from '../di/register.function';
import { UnauthorizedError } from '../error-handling';
import { HttpRequest } from '../http';
import { LoggerInterface } from '../logging';
import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';
import { AuthServiceInterface } from './auth-service.interface';
import { AuthStrategyInterface } from './auth-strategy.interface';
import { AuthStrategies, BaseUser, HasRoleMetadata, IsLoggedInMetadata, IsNotLoggedInMetadata, SkipHasRoleMetadata, SkipIsLoggedInMetadata, SkipIsNotLoggedInMetadata } from './models';

export class AuthService implements AuthServiceInterface {
    private readonly logger: LoggerInterface;

    readonly strategies: AuthStrategies = [];

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    init(authStrategies: AuthStrategies): void {
        for (const strategy of authStrategies) {
            register({ token: strategy, useClass: strategy });
            this.strategies.push(strategy);
        }
        if (authStrategies.length) {
            this.logger.info(
                'initializes',
                authStrategies.length,
                authStrategies.length > 1 ? 'auth strategies' : 'auth strategy'
            );
            for (const strategy of authStrategies) {
                this.logger.info('  -', strategy.name);
                inject(strategy).init();
            }
        }

        // const entitiesInDataSources: Newable<BaseEntity>[] = [];
        // for (const dataSourceClass of GlobalRegistry.dataSourceClasses) {
        //     const dataSource: BaseDataSource = inject(dataSourceClass);
        //     this.logger.info(`  - ${dataSourceClass.name} (${dataSource.entities.length} entities)`);
        //     entitiesInDataSources.push(...dataSource.entities);
        //     await dataSource.init();
        // }

        // this.checkForOrphanedEntities(entitiesInDataSources);
    }

    async login<Role extends string, UserType extends BaseUser<Role>, AuthDataType, CredentialsType>(
        strategy: Newable<AuthStrategyInterface<Role, UserType, AuthDataType, CredentialsType>>,
        credentials: CredentialsType
    ): Promise<AuthDataType> {
        return await inject(strategy).login(credentials);
    }

    async getCurrentUser<Role extends string, UserType extends BaseUser<Role>, B extends boolean = false>(
        request: HttpRequest,
        allowedStrategies: AuthStrategies,
        optional: B
    ): Promise<B extends true ? UserType | undefined : UserType> {
        // eslint-disable-next-line stylistic/max-len
        const strategies: AuthStrategyInterface<Role, UserType, unknown, unknown>[] = allowedStrategies.map(s => inject(s)) as unknown as AuthStrategyInterface<Role, UserType, unknown, unknown>[];
        const res: PromiseSettledResult<UserType | undefined>[] = await Promise.allSettled(strategies.map(s => s.resolveUser(request)));
        const currentUser: UserType | undefined = (
            res.find(r => r.status === 'fulfilled' && r.value !== undefined) as PromiseFulfilledResult<UserType> | undefined
        )?.value;
        if (currentUser === undefined && !optional) {
            throw new UnauthorizedError('Could not resolve the currently logged in user.');
        }
        return currentUser as B extends true ? UserType | undefined : UserType;
    }

    async checkAccess(controllerClass: Newable<Object>, controllerMethod: string, request: HttpRequest): Promise<void> {
        // TODO
        const isLoggedInMetadata: IsLoggedInMetadata | undefined = this.resolveIsLoggedInMetadata(controllerClass, controllerMethod);
        const isNotLoggedInMetadata: IsNotLoggedInMetadata | undefined = this.resolveIsNotLoggedInMetadata(
            controllerClass,
            controllerMethod
        );
        const hasRoleMetadata: HasRoleMetadata | undefined = this.resolveHasRoleMetadata(controllerClass, controllerMethod);

        // isLoggedIn
        if (
            (isLoggedInMetadata || hasRoleMetadata)
            && !await this.isLoggedIn(request, isLoggedInMetadata?.allowedStrategies ?? this.strategies)
        ) {
            throw new UnauthorizedError('You need to be logged in to access this route.');
        }
        // isNotLoggedIn
        if (
            isNotLoggedInMetadata
            && await this.isLoggedIn(request, isLoggedInMetadata?.allowedStrategies ?? this.strategies)
        ) {
            throw new UnauthorizedError('You cannot be logged in when accessing this route.');
        }

        // hasRole
        if (
            hasRoleMetadata
            && !await this.hasRole(request, hasRoleMetadata.allowedStrategies ?? this.strategies, hasRoleMetadata.allowedRoles)
        ) {
            throw new UnauthorizedError(`You need to have one role of ${hasRoleMetadata.allowedRoles} to access this route.`);
        }
        // 3 belongsTo
    }

    async isLoggedIn(
        request: HttpRequest,
        allowedStrategies: AuthStrategies
    ): Promise<boolean> {
        const strategies: AuthStrategyInterface<string, BaseUser<string>, unknown, unknown>[] = allowedStrategies.map(s => inject(s));
        try {
            return await Promise.any(strategies.map(s => s.isLoggedIn(request)));
        }
        catch {
            return false;
        }
    }

    async hasRole(request: HttpRequest, allowedStrategies: AuthStrategies, allowedRoles: string[]): Promise<boolean> {
        const strategies: AuthStrategyInterface<string, BaseUser<string>, unknown, unknown>[] = allowedStrategies.map(s => inject(s));
        try {
            return await Promise.any(strategies.map(s => s.hasRole(request, allowedRoles)));
        }
        catch {
            return false;
        }
    }

    resolveIsLoggedInMetadata(controllerClass: Newable<Object>, controllerMethod: string): IsLoggedInMetadata | undefined {
        const controllerIsLoggedIn: IsLoggedInMetadata | undefined = MetadataUtilities.getControllerIsLoggedIn(controllerClass);
        const routeIsLoggedIn: IsLoggedInMetadata | undefined = MetadataUtilities.getRouteIsLoggedIn(
            controllerClass,
            controllerMethod
        );
        const controllerSkipIsLoggedIn: SkipIsLoggedInMetadata | undefined = MetadataUtilities.getControllerSkipIsLoggedIn(controllerClass);
        const routeSkipIsLoggedIn: SkipIsLoggedInMetadata | undefined = MetadataUtilities.getRouteSkipIsLoggedIn(
            controllerClass,
            controllerMethod
        );

        if (routeIsLoggedIn && routeSkipIsLoggedIn) {
            throw new Error(
                `The route ${controllerClass.name}.${controllerMethod} was decorated with both @Auth.isLoggedIn and @Auth.isLoggedIn.skip`
            );
        }
        if (controllerIsLoggedIn && controllerSkipIsLoggedIn) {
            throw new Error(
                `The controller ${controllerClass.name} was decorated with both @Auth.isLoggedIn and @Auth.isLoggedIn.skip`
            );
        }

        if (!routeIsLoggedIn && !controllerIsLoggedIn && routeSkipIsLoggedIn) {
            this.logger.warn(`Useless @Auth.isLoggedIn.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerIsLoggedIn && controllerSkipIsLoggedIn) {
            this.logger.warn(`Useless @Auth.isLoggedIn.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipIsLoggedIn) {
            return undefined;
        }
        if (routeIsLoggedIn) {
            return routeIsLoggedIn;
        }
        if (controllerSkipIsLoggedIn) {
            return undefined;
        }
        return controllerIsLoggedIn;
    }

    resolveIsNotLoggedInMetadata(controllerClass: Newable<Object>, controllerMethod: string): IsNotLoggedInMetadata | undefined {
        const controllerIsNotLoggedIn: IsNotLoggedInMetadata | undefined = MetadataUtilities.getControllerIsNotLoggedIn(controllerClass);
        const routeIsNotLoggedIn: IsNotLoggedInMetadata | undefined = MetadataUtilities.getRouteIsNotLoggedIn(
            controllerClass,
            controllerMethod
        );
        const controllerSkipIsNotLoggedIn: SkipIsNotLoggedInMetadata | undefined
            = MetadataUtilities.getControllerSkipIsNotLoggedIn(controllerClass);
        const routeSkipIsNotLoggedIn: SkipIsNotLoggedInMetadata | undefined = MetadataUtilities.getRouteSkipIsNotLoggedIn(
            controllerClass,
            controllerMethod
        );

        if (routeIsNotLoggedIn && routeSkipIsNotLoggedIn) {
            throw new Error(
                // eslint-disable-next-line stylistic/max-len
                `The route ${controllerClass.name}.${controllerMethod} was decorated with both @Auth.isNotLoggedIn and @Auth.isNotLoggedIn.skip`
            );
        }
        if (controllerIsNotLoggedIn && controllerSkipIsNotLoggedIn) {
            throw new Error(
                `The controller ${controllerClass.name} was decorated with both @Auth.isNotLoggedIn and @Auth.isNotLoggedIn.skip`
            );
        }

        if (!routeIsNotLoggedIn && !controllerIsNotLoggedIn && routeSkipIsNotLoggedIn) {
            this.logger.warn(`Useless @Auth.isNotLoggedIn.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerIsNotLoggedIn && controllerSkipIsNotLoggedIn) {
            this.logger.warn(`Useless @Auth.isNotLoggedIn.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipIsNotLoggedIn) {
            return undefined;
        }
        if (routeIsNotLoggedIn) {
            return routeIsNotLoggedIn;
        }
        if (controllerSkipIsNotLoggedIn) {
            return undefined;
        }
        return controllerIsNotLoggedIn;
    }

    resolveHasRoleMetadata(controllerClass: Newable<Object>, controllerMethod: string): HasRoleMetadata | undefined {
        const controllerHasRole: HasRoleMetadata | undefined = MetadataUtilities.getControllerHasRole(controllerClass);
        const routeHasRole: HasRoleMetadata | undefined = MetadataUtilities.getRouteHasRole(
            controllerClass,
            controllerMethod
        );
        const controllerSkipHasRole: SkipHasRoleMetadata | undefined = MetadataUtilities.getControllerSkipHasRole(controllerClass);
        const routeSkipHasRole: SkipHasRoleMetadata | undefined = MetadataUtilities.getRouteSkipHasRole(
            controllerClass,
            controllerMethod
        );

        if (routeHasRole && routeSkipHasRole) {
            throw new Error(
                `The route ${controllerClass.name}.${controllerMethod} was decorated with both @Auth.hasRole and @Auth.hasRole.skip`
            );
        }
        if (controllerHasRole && controllerSkipHasRole) {
            throw new Error(
                `The controller ${controllerClass.name} was decorated with both @Auth.hasRole and @Auth.hasRole.skip`
            );
        }

        if (!routeHasRole && !controllerHasRole && routeSkipHasRole) {
            this.logger.warn(`Useless @Auth.hasRole.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerHasRole && controllerSkipHasRole) {
            this.logger.warn(`Useless @Auth.hasRole.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipHasRole) {
            return undefined;
        }
        if (routeHasRole) {
            return routeHasRole;
        }
        if (controllerSkipHasRole) {
            return undefined;
        }
        return controllerHasRole;
    }
}