import { BaseEntity } from '../entity';
import { HttpRequest } from '../http';
import { Newable } from '../types';
import { AuthStrategyInterface } from './auth-strategy.interface';
import { AuthStrategies, BaseUser, BelongsToMetadata, HasRoleMetadata, IsLoggedInMetadata, IsNotLoggedInMetadata } from './models';

export interface AuthServiceInterface {
    readonly strategies: AuthStrategies,
    init: (strategies: AuthStrategies) => void,
    checkAccess: (controllerClass: Newable<Object>, controllerMethod: string, req: HttpRequest) => Promise<void>,
    isLoggedIn: (request: HttpRequest, allowedStrategies: AuthStrategies) => Promise<boolean>,
    hasRole: (request: HttpRequest, allowedStrategies: AuthStrategies, allowedRoles: string[]) => Promise<boolean>,
    belongsTo: <TargetEntity extends Newable<BaseEntity>>(
        request: HttpRequest,
        allowedStrategies: AuthStrategies,
        targetEntity: TargetEntity,
        targetUserIdKey: keyof InstanceType<TargetEntity>,
        targetIdParamKey: string
    ) => Promise<boolean>,
    resolveIsLoggedInMetadata: (controllerClass: Newable<Object>, controllerMethod: string) => IsLoggedInMetadata | undefined,
    resolveIsNotLoggedInMetadata: (controllerClass: Newable<Object>, controllerMethod: string) => IsNotLoggedInMetadata | undefined,
    resolveHasRoleMetadata: (controllerClass: Newable<Object>, controllerMethod: string) => HasRoleMetadata | undefined,
    resolveBelongsToMetadata: (
        controllerClass: Newable<Object>,
        controllerMethod: string
    ) => BelongsToMetadata<Newable<BaseEntity>> | undefined,
    login: <Role extends string, UserType extends BaseUser<Role>, AuthDataType, CredentialsType>(
        strategy: Newable<AuthStrategyInterface<Role, UserType, AuthDataType, CredentialsType>>,
        credentials: CredentialsType
    ) => Promise<AuthDataType>,
    getCurrentUser: <Role extends string, UserType extends BaseUser<Role>, B extends boolean = true>(
        request: HttpRequest,
        strategies: AuthStrategies,
        required: B
    ) => Promise<B extends false ? UserType | undefined : UserType>
}