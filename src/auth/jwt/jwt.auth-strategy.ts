import { SecuritySchemeObject } from 'openapi3-ts/dist/oas31';
import { v4 } from 'uuid';

import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../../di';
import { HttpRequest } from '../../http';
import { AuthStrategyInterface } from '../auth-strategy.interface';
import { BaseUser } from '../models';
import { UserServiceInterface } from '../user-service.interface';
import { EncodedAccessToken } from './encoded-access-token.model';
import { JwtAuthData } from './jwt-auth-data.model';
import { JwtCredentials, JwtCredentialsDto } from './jwt-credentials.model';
import { JwtUtilities } from './jwt.utilities';
import { UnauthorizedError } from '../../error-handling';
import { HashUtilities } from '../hash.utilities';
import { AccessTokenPayload } from './access-token-payload.model';
import { RefreshTokenPayload } from './refresh-token-payload.model';
import { RefreshToken, RefreshTokenCreateDto } from './refresh-token.model';
import { BaseDataSource, Repository } from '../../data-source';
import { BaseEntity } from '../../entity';
import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE } from '../user.service';

export class JwtAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
>
implements AuthStrategyInterface<RoleType, UserType, JwtAuthData<RoleType>, JwtCredentialsDto> {
    readonly name: string = 'jwt';

    readonly securityScheme: SecuritySchemeObject = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token in the format `Bearer <token>`'
    };

    private readonly accessTokenSecret: string;
    private readonly accessTokenExpiresInMs: number;
    private readonly refreshTokenSecret: string;
    private readonly refreshTokenExpiresInMs: number;
    private readonly userService: UserServiceInterface;

    constructor() {
        this.accessTokenSecret = inject(ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET);
        this.accessTokenExpiresInMs = inject(ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_EXPIRES_IN_MS);
        this.refreshTokenSecret = inject(ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET);
        this.refreshTokenExpiresInMs = inject(ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_EXPIRES_IN_MS);
        this.userService = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    init(): void {
        if (!this.accessTokenSecret) {
            throw new Error(`No value provided for ${ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET}`);
        }
        if (!this.refreshTokenSecret) {
            throw new Error(`No value provided for ${ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET}`);
        }
        if (!GlobalRegistry.userRepositories.length) {
            throw new Error(NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE);
        }

        this.checkForEntities();
    }

    private checkForEntities(): void {
        const entitiesInDataSources: Newable<BaseEntity>[] = [];
        for (const dataSourceClass of GlobalRegistry.dataSourceClasses) {
            const dataSource: BaseDataSource = inject(dataSourceClass);
            entitiesInDataSources.push(...dataSource.entities);
        }
        if (!entitiesInDataSources.includes(RefreshToken)) {
            const message: string[] = ['Error initializing JwtAuthStrategy.', 'Could not find data source for the RefreshToken entity:'];
            message.push('Did you forget to add it to your data source entities array?');
            throw new Error(message.join('\n'));
        }
        if (!entitiesInDataSources.includes(JwtCredentials)) {
            const message: string[] = ['Error initializing JwtAuthStrategy.', 'Could not find data source for the JwtCredentials entity:'];
            message.push('Did you forget to add it to your data source entities array?');
            throw new Error(message.join('\n'));
        }
    }

    async login(credentials: JwtCredentialsDto): Promise<JwtAuthData<RoleType>> {
        try {
            const foundUser: UserType = await this.userService.findByEmail(credentials.username);
            const credentialsFound: JwtCredentials = await this.userService.resolveCredentialsFor(foundUser);
            const passwordMatched: boolean = await HashUtilities.equal(credentials.password, credentialsFound.password);
            if (!passwordMatched) {
                throw new UnauthorizedError('Invalid email or password.');
            }
            const accessToken: string = await this.generateAccessToken(foundUser);
            const refreshToken: string = await this.generateRefreshToken(foundUser);

            const refreshTokenRepository: Repository<RefreshToken> = inject(repositoryTokenFor(RefreshToken));
            const data: RefreshTokenCreateDto = {
                userId: foundUser.id,
                value: refreshToken,
                familyId: v4(),
                blacklisted: false,
                expirationDate: new Date(Date.now() + this.refreshTokenExpiresInMs)
            };
            await refreshTokenRepository.create(data);

            return {
                accessToken: {
                    value: accessToken,
                    expirationDate: new Date(Date.now() + this.accessTokenExpiresInMs)
                },
                refreshToken: {
                    value: refreshToken,
                    expirationDate: new Date(Date.now() + this.refreshTokenExpiresInMs)
                },
                userId: foundUser.id,
                roles: foundUser.roles
            };
        }
        catch {
            throw new UnauthorizedError('Invalid email or password.');
        }
    }

    async resolveUser(request: HttpRequest): Promise<UserType | undefined> {
        const jwt: string | undefined = this.extractTokenFromRequest(request);
        if (!jwt) {
            return undefined;
        }
        const data: EncodedAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        if (!data) {
            return undefined;
        }

        return await this.userService.findById<RoleType, UserType>(data.payload.id);
    }

    async isLoggedIn(request: HttpRequest): Promise<boolean> {
        const jwt: string | undefined = this.extractTokenFromRequest(request);
        if (!jwt) {
            return false;
        }
        const data: EncodedAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        return !!data;
    }

    async hasRole(request: HttpRequest, allowedRoles: RoleType[]): Promise<boolean> {
        const jwt: string | undefined = this.extractTokenFromRequest(request);
        if (!jwt) {
            return false;
        }
        const data: EncodedAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        if (!data) {
            return false;
        }
        return !!allowedRoles.find(r => data.payload.roles.includes(r));
    }

    private extractTokenFromRequest(request: HttpRequest): string | undefined {
        const authHeader: string | string[] | undefined = request.headers.authorization;
        if (authHeader == undefined || typeof authHeader !== 'string') {
            return undefined;
        }
        const parts: string[] = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return undefined;
        }
        return parts[1];
    }

    private async generateAccessToken(user: UserType): Promise<string> {
        const payload: AccessTokenPayload<RoleType, UserType> = {
            id: user.id,
            roles: user.roles,
            email: user.email
        };

        try {
            return await JwtUtilities.sign(
                payload,
                this.accessTokenSecret,
                { expiresIn: this.accessTokenExpiresInMs / 1000 }
            );
        }
        catch (error) {
            throw new UnauthorizedError('Error generating token', { cause: error });
        }
    }

    private async generateRefreshToken(user: UserType): Promise<string> {
        const payload: RefreshTokenPayload<RoleType, UserType> = {
            userId: user.id
        };

        return await JwtUtilities.sign(payload, this.refreshTokenSecret, {
            expiresIn: this.refreshTokenExpiresInMs / 1000,
            issuer: GlobalRegistry.getAppData('name')
        });
    }
}