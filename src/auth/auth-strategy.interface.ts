import { BaseEntity } from '../entity';
import { HttpRequest } from '../http';
import { OpenApiSecuritySchemeObject } from '../open-api';
import { Newable } from '../types';
import { BaseUser } from './models/base-user.model';

export interface AuthStrategyInterface<RoleType extends string, UserType extends BaseUser<RoleType>, AuthDataType, CredentialType> {
    init: () => void,
    resolveUser: (request: HttpRequest) => Promise<UserType | undefined>,
    login: (credentials: CredentialType) => Promise<AuthDataType>,
    isLoggedIn: (request: HttpRequest) => Promise<boolean>,
    hasRole: (request: HttpRequest, allowedRoles: RoleType[]) => Promise<boolean>,
    belongsTo: <TargetEntity extends Newable<BaseEntity>>(
        request: HttpRequest,
        targetEntity: TargetEntity,
        targetUserIdKey: keyof InstanceType<TargetEntity>,
        targetIdParamKey: string
    ) => Promise<boolean>,
    securityScheme: OpenApiSecuritySchemeObject,
    name: string
}