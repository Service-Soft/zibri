import { inject, ZIBRI_DI_TOKENS } from '../di';
import { register } from '../di/register.function';
import { BaseEntity } from '../entity';
import { UnauthorizedError } from '../error-handling';
import { HttpRequest } from '../http';
import { LoggerInterface } from '../logging';
import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';
import { WebsocketRequest } from '../websocket';
import { AuthServiceInterface } from './auth-service.interface';
import { AuthStrategyInterface } from './auth-strategy.interface';
import { AuthStrategies, BaseUser, BelongsToMetadata, HasRoleMetadata, IsLoggedInMetadata, IsNotLoggedInMetadata, SkipAuthMetadata, SkipBelongsToMetadata, SkipHasRoleMetadata, SkipIsLoggedInMetadata, SkipIsNotLoggedInMetadata } from './models';

/**
 * Default auth service implementation of Zibri.
 */
export class AuthService implements AuthServiceInterface {
    /**
     * A logger.
     */
    protected readonly logger: LoggerInterface;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly strategies: AuthStrategies = [];

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(authStrategies: AuthStrategies): Promise<void> {
        for (const strategy of authStrategies) {
            register({ token: strategy, useClass: strategy });
            this.strategies.push(strategy);
        }
        if (authStrategies.length) {
            await this.logger.info(
                `initializes ${authStrategies.length} ${authStrategies.length > 1 ? 'auth strategies' : 'auth strategy'}`
            );
            for (const strategy of authStrategies) {
                await this.logger.info(`  - ${strategy.name}`);
                inject(strategy).init();
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async login<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        credentials: CredentialsType
    ): Promise<AuthDataType> {
        return await inject(strategy).login(credentials);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refreshLogin<
        Role extends string,
        UserType extends BaseUser<Role>,
        RefreshLoginDataType,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: RefreshLoginDataType
    ): Promise<AuthDataType> {
        return await inject(strategy).refreshLogin(data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getCurrentUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        B extends boolean = true
    >(
        request: HttpRequest | WebsocketRequest,
        allowedStrategies: AuthStrategies,
        required: B
    ): Promise<B extends false ? UserType | undefined : UserType> {
        // eslint-disable-next-line stylistic/max-len
        const strategies: AuthStrategyInterface<Role, UserType, unknown, unknown, unknown, unknown, unknown, unknown>[] = allowedStrategies.map(
            s => inject(s)
        ) as unknown as AuthStrategyInterface<Role, UserType, unknown, unknown, unknown, unknown, unknown, unknown>[];
        const res: PromiseSettledResult<UserType | undefined>[] = await Promise.allSettled(strategies.map(s => s.resolveUser(request)));
        const currentUser: UserType | undefined = (
            res.find(r => r.status === 'fulfilled' && r.value !== undefined) as PromiseFulfilledResult<UserType> | undefined
        )?.value;
        if (currentUser === undefined && required) {
            throw new UnauthorizedError('Could not resolve the currently logged in user.');
        }
        return currentUser as B extends false ? UserType | undefined : UserType;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: RequestPasswordResetDataType
    ): Promise<void> {
        await inject(strategy).requestPasswordReset(data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPasswordReset<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: ConfirmPasswordResetDataType
    ): Promise<void> {
        await inject(strategy).confirmPasswordReset(data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async checkAccess(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        request: HttpRequest | WebsocketRequest
    ): Promise<void> {
        const isLoggedInMetadata: IsLoggedInMetadata | undefined = await this.resolveIsLoggedInMetadata(controllerClass, controllerMethod);
        const isNotLoggedInMetadata: IsNotLoggedInMetadata | undefined = await this.resolveIsNotLoggedInMetadata(
            controllerClass,
            controllerMethod
        );
        const hasRoleMetadata: HasRoleMetadata | undefined = await this.resolveHasRoleMetadata(controllerClass, controllerMethod);
        const belongsToMetadata: BelongsToMetadata<Newable<BaseEntity>> | undefined = await this.resolveBelongsToMetadata(
            controllerClass,
            controllerMethod
        );
        const skip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(controllerClass, controllerMethod);

        if (
            skip
            && !MetadataUtilities.getControllerIsLoggedIn(controllerClass)
            && !MetadataUtilities.getControllerIsNotLoggedIn(controllerClass)
            && !MetadataUtilities.getControllerHasRole(controllerClass)
            && !MetadataUtilities.getControllerBelongsTo(controllerClass)
        ) {
            await this.logger.warn(`Useless @Auth.skip on route ${controllerClass.name}.${controllerMethod}`);
        }

        // isLoggedIn
        if (
            (isLoggedInMetadata || hasRoleMetadata || belongsToMetadata)
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
        // belongsTo
        if (
            belongsToMetadata
            && !await this.belongsTo(
                request,
                belongsToMetadata.allowedStrategies ?? this.strategies,
                belongsToMetadata.targetEntity,
                belongsToMetadata.targetUserIdKey,
                belongsToMetadata.targetIdParamKey
            )
        ) {
            const targetId: string | undefined = request.params?.[belongsToMetadata.targetIdParamKey];
            throw new UnauthorizedError(
                // eslint-disable-next-line stylistic/max-len
                `You need to to have access to the ${belongsToMetadata.targetEntity.name} entity with the id ${String(targetId)} to access this route.`
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isLoggedIn(
        request: HttpRequest | WebsocketRequest,
        allowedStrategies: AuthStrategies
    ): Promise<boolean> {
        // eslint-disable-next-line stylistic/max-len
        const strategies: AuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown, unknown>[] = allowedStrategies.map(s => inject(s));
        try {
            return await Promise.any(strategies.map(s => s.isLoggedIn(request)));
        }
        catch {
            return false;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hasRole(
        request: HttpRequest | WebsocketRequest,
        allowedStrategies: AuthStrategies,
        allowedRoles: string[]
    ): Promise<boolean> {
        // eslint-disable-next-line stylistic/max-len
        const strategies: AuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown, unknown>[] = allowedStrategies.map(s => inject(s));
        try {
            return await Promise.any(strategies.map(s => s.hasRole(request, allowedRoles)));
        }
        catch {
            return false;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async belongsTo<TargetEntity extends Newable<BaseEntity>>(
        request: HttpRequest | WebsocketRequest,
        allowedStrategies: AuthStrategies,
        targetEntity: TargetEntity,
        targetUserIdKey: keyof InstanceType<TargetEntity>,
        targetIdParamKey: string
    ): Promise<boolean> {
        // eslint-disable-next-line stylistic/max-len
        const strategies: AuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown, unknown>[] = allowedStrategies.map(s => inject(s));
        try {
            return await Promise.any(strategies.map(s => s.belongsTo(request, targetEntity, targetUserIdKey, targetIdParamKey)));
        }
        catch {
            return false;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveIsLoggedInMetadata(controllerClass: Newable<unknown>, controllerMethod: string): Promise<IsLoggedInMetadata | undefined> {
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
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeIsLoggedIn && routeSkip) {
            throw new Error(
                `The route ${controllerClass.name}.${controllerMethod} was decorated with both @Auth.isLoggedIn and @Auth.skip`
            );
        }
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
            await this.logger.warn(`Useless @Auth.isLoggedIn.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerIsLoggedIn && controllerSkipIsLoggedIn) {
            await this.logger.warn(`Useless @Auth.isLoggedIn.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipIsLoggedIn || routeSkip) {
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveIsNotLoggedInMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): Promise<IsNotLoggedInMetadata | undefined> {
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
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeIsNotLoggedIn && routeSkip) {
            throw new Error(
                `The route ${controllerClass.name}.${controllerMethod} was decorated with both @Auth.isNotLoggedIn and @Auth.skip`
            );
        }
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
            await this.logger.warn(`Useless @Auth.isNotLoggedIn.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerIsNotLoggedIn && controllerSkipIsNotLoggedIn) {
            await this.logger.warn(`Useless @Auth.isNotLoggedIn.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipIsNotLoggedIn || routeSkip) {
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveHasRoleMetadata(controllerClass: Newable<unknown>, controllerMethod: string): Promise<HasRoleMetadata | undefined> {
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
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeHasRole && routeSkip) {
            throw new Error(
                `The route ${controllerClass.name}.${controllerMethod} was decorated with both @Auth.hasRole and @Auth.skip`
            );
        }

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
            await this.logger.warn(`Useless @Auth.hasRole.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerHasRole && controllerSkipHasRole) {
            await this.logger.warn(`Useless @Auth.hasRole.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipHasRole || routeSkip) {
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveBelongsToMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): Promise<BelongsToMetadata<Newable<BaseEntity>> | undefined> {
        const controllerBelongsTo: BelongsToMetadata<Newable<BaseEntity>> | undefined = MetadataUtilities.getControllerBelongsTo(
            controllerClass
        );
        const routeBelongsTo: BelongsToMetadata<Newable<BaseEntity>> | undefined = MetadataUtilities.getRouteBelongsTo(
            controllerClass,
            controllerMethod
        );
        const controllerSkipBelongsTo: SkipBelongsToMetadata | undefined = MetadataUtilities.getControllerSkipBelongsTo(controllerClass);
        const routeSkipBelongsTo: SkipBelongsToMetadata | undefined = MetadataUtilities.getRouteSkipBelongsTo(
            controllerClass,
            controllerMethod
        );
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeBelongsTo && routeSkip) {
            throw new Error(
                `The route ${controllerClass.name}.${controllerMethod} was decorated with both @Auth.belongsTo and @Auth.skip`
            );
        }
        if (routeBelongsTo && routeSkipBelongsTo) {
            throw new Error(
                `The route ${controllerClass.name}.${controllerMethod} was decorated with both @Auth.belongsTo and @Auth.belongsTo.skip`
            );
        }
        if (controllerBelongsTo && controllerSkipBelongsTo) {
            throw new Error(
                `The controller ${controllerClass.name} was decorated with both @Auth.belongsTo and @Auth.belongsTo.skip`
            );
        }

        if (!routeBelongsTo && !controllerBelongsTo && routeSkipBelongsTo) {
            await this.logger.warn(`Useless @Auth.belongsTo.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerBelongsTo && controllerSkipBelongsTo) {
            await this.logger.warn(`Useless @Auth.belongsTo.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipBelongsTo || routeSkip) {
            return undefined;
        }
        if (routeBelongsTo) {
            return routeBelongsTo;
        }
        if (controllerSkipBelongsTo) {
            return undefined;
        }
        return controllerBelongsTo;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout<
        Role extends string,
        UserType extends BaseUser<Role>,
        RefreshLoginDataType,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: LogoutDataType
    ): Promise<void> {

        try {
            await inject(strategy).logout(data);
            return;
        }
        catch {
            // do nothing
        }
    }
}