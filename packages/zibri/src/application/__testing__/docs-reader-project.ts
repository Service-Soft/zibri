// The files of the reader's project that the pages in docs/ import from without showing them.
// docs-examples.test.ts compiles every such import against this module, so what an example does with
// a reader's `User` or `Roles` is type checked like everything else in it.
//
// The shapes follow what a page that does show the file declares, and what `zi new` generates. What
// the reader writes against a service of their own, such as a client of their mail provider, is only
// declared.
import { AuditServiceInterface, BaseEntity, BaseGoogleAuthenticator, BaseMembershipEntity, BaseRateLimitState, BaseRoleEntity, BaseTenantEntity, BaseUserEntity, Cache, type CacheServiceInterface, type CompanyInfo, Controller, DataSource, DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions, DiProvider, EmailChangedEmailTemplate, EmailVerificationEmailTemplate, EncryptionString, Entity, File, FsPath, HtmlResponse, HttpRequestContext, inject, Inject, Injectable, InjectionToken, InMemoryCacheStore, LocaleCode, Log, type LoggerInterface, type MetricsServiceInterface, Migration, MimeType, Newable, OAuthClientAuthentication, OidcDiscoveryAtBoot, OmitClass, OmitStrict, PartialClass, PostgresDataSource, PostgresOptions, PostgresPooler, Property, RateLimiterInterface, Repository, RepositoryClass, S3Credentials, SchemaManagement, Timezone, TraceSpanContext, TraceSpanInterface, TsxChildren, TsxComponent, ValKeyDataSource, ValKeyOptions, WebsocketRequestContext, WriteThroughReadThroughCache, ZIBRI_DI_TOKENS, ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS, ZibriApplicationOptions } from '../../index';

// src/models: the running example of the docs, a task tracker for teams

export enum Roles {
    USER = 'user',
    ADMIN = 'admin'
}

export enum MemberRoles {
    USER = 'member',
    ACCOUNTANT = 'accountant',
    ADMIN = 'owner'
}

type AppPermissions = readonly [
    ...typeof ZIBRI_PERMISSIONS,
    'invoices.read',
    'invoices.export',
    'documents.read-all',
    'scim.provision'
];

type AppPlatformPermissions = readonly [
    ...typeof ZIBRI_PLATFORM_PERMISSIONS,
    'tenants.manage',
    'service-accounts.manage',
    'tokens.introspect',
    'api-docs.read'
];

const PERMISSIONS: AppPermissions = [
    ...ZIBRI_PERMISSIONS,
    'invoices.read',
    'invoices.export',
    'documents.read-all',
    'scim.provision'
] as const;
const PLATFORM_PERMISSIONS: AppPlatformPermissions = [
    ...ZIBRI_PLATFORM_PERMISSIONS,
    'tenants.manage',
    'service-accounts.manage',
    'tokens.introspect',
    'api-docs.read'
] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
export const PlatformPermissions: DefinedPlatformPermissions<typeof PLATFORM_PERMISSIONS> = definePlatformPermissions(PLATFORM_PERMISSIONS);

@Entity({ tenant: 'shared' })
export class User extends BaseUserEntity() {}

export type UserCreateData = OmitStrict<User, 'id'>;

export class CreateUserData {
    @Property.string({ format: 'email' })
    email!: string;

    @Property.string({ required: false })
    name?: string | null;
}

@Entity()
export class Role extends BaseRoleEntity {
    @Property.string({ required: false })
    description: string | undefined | null;
}

@Entity({ uniques: [['userId']] })
export class Membership extends BaseMembershipEntity() {}

@Entity()
export class Task extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.string()
    status!: string;
}

export class TaskCreateDTO extends OmitClass(Task, ['id', 'tenantId']) {}

export class TaskUpdateDTO extends PartialClass(TaskCreateDTO) {}

export type TaskCreateData = OmitStrict<Task, 'id' | 'tenantId'>;

export type TaskUpdateData = Partial<TaskCreateData>;

@Entity()
export class Comment extends BaseTenantEntity() {
    @Property.string({ format: 'uuid' })
    taskId!: string;

    @Property.string()
    text!: string;
}

@Entity({ indexes: [['customerId', 'status']] })
export class Order extends BaseTenantEntity() {
    @Property.string()
    customerId!: string;

    @Property.string()
    status!: string;

    @Property.date({ index: true })
    placedAt!: Date;
}

export enum InvoiceStatus {
    DRAFT = 'draft',
    DUE = 'due',
    PAID = 'paid'
}

@Entity()
export class Invoice extends BaseTenantEntity() {
    @Property.string({ enum: InvoiceStatus })
    status!: InvoiceStatus;
}

@Entity()
export class Report extends BaseTenantEntity() {
    @Property.string()
    title!: string;
}

@Entity()
export class TenantSettings extends BaseTenantEntity() {
    @Property.unknown()
    companyInfo!: CompanyInfo;
}

export class PaymentDetails {
    @Property.string()
    iban!: string;
}

export class AddressChange {
    @Property.string()
    street!: string;

    @Property.string()
    city!: string;
}

export class PasswordChange {
    @Property.string()
    password!: string;
}

export class GalleryDTO {
    @Property.array({ items: { type: 'file', allowedMimeTypes: [MimeType.PNG, MimeType.JPEG] } })
    images!: File[];
}

// src/data-sources

export const entities: Newable<BaseEntity>[] = [User, Role, Membership, Task, Comment, Order, Invoice, Report, TenantSettings];

export const repositories: RepositoryClass[] = [];

@DataSource()
export class DbDataSource extends PostgresDataSource {
    options: PostgresOptions = {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: true
    };

    entities: Newable<BaseEntity>[] = entities;
    repositories: RepositoryClass[] = repositories;
    override migrations: Newable<Migration>[] = [];
    schemaManagement: SchemaManagement = 'synchronize';
    pooler: PostgresPooler = 'none';
}

@DataSource()
export class CacheDbDataSource extends ValKeyDataSource {
    options: ValKeyOptions = {
        host: 'localhost',
        port: 6379,
        useTLS: true,
        keyPrefix: 'my-app'
    };

    entities: Newable<BaseEntity>[] = [];
    repositories: RepositoryClass[] = [];
}

export declare const userRepository: Repository<User>;

// src/auth

export class GoogleAuthenticator extends BaseGoogleAuthenticator<string, User> {
    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';
    readonly clientId: string = 'google-client-id';
    readonly clientAuthentication: OAuthClientAuthentication = {
        method: 'client_secret_basic',
        clientSecret: 'google-client-secret'
    };
}

// src/controllers

@Controller('/auth')
export class AppAuthController {}

@Controller('/')
export class PageController {}

@Controller('/tasks')
export class TaskController {}

@Controller('/projects')
export class ProjectController {}

@Controller('/reports')
export class ReportController {}

// src/caching

@Cache()
export class StaticPagesCache extends WriteThroughReadThroughCache<string, HtmlResponse, 'StaticPagesCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('StaticPagesCache', new InMemoryCacheStore(), []);
    }

    static getPageKey(page: string): string {
        const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(ctx);
        return locale + page;
    }
}

@Cache()
export class FastCache extends WriteThroughReadThroughCache<string, number, 'FastCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('FastCache', new InMemoryCacheStore(), []);
    }
}

@Cache()
export class SlowCache extends WriteThroughReadThroughCache<string, number, 'SlowCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('SlowCache', new InMemoryCacheStore(), []);
    }
}

// src/templates, with the props of the components `zi new` generates

export declare const BasePage: TsxComponent<{
    title: string,
    children: TsxChildren,
    activeRoute: string,
    className?: string,
    scripts?: string[]
}>;
export declare const Card: TsxComponent<{ className?: string, children: TsxChildren }>;
export declare const Heading: TsxComponent<{ tag?: 'h1' | 'h2' | 'h3', id?: string, children: TsxChildren, className?: string }>;
export declare const Checkbox: TsxComponent<{ label: string, className?: string, onChange?: () => void, checked?: boolean, id?: string }>;
export declare const Link: TsxComponent<{
    href: string,
    children: TsxChildren,
    activeRoute?: string,
    className?: string,
    icon?: string,
    iconClassName?: string
}>;
export declare const HomePage: TsxComponent<{ appName: string }>;
export declare const MetricsPage: TsxComponent<{
    version: string,
    primary: string,
    secondary: string,
    cacheNames: string[],
    rateLimiterNames: string[]
}>;
export declare const MetricsStatus: TsxComponent<{ version: string, id: string, className?: string }>;
export declare const RequestDurationChart: TsxComponent<{ className?: string, secondary: string }>;
export declare const RequestsPerSecondChart: TsxComponent<{ secondary: string, className?: string }>;
export declare const ResourceUsageChart: TsxComponent<{ primary: string, secondary: string, className?: string }>;
export declare const NetworkChart: TsxComponent<{ primary: string, secondary: string, className?: string }>;
export declare const VerifyEmailEmail: EmailVerificationEmailTemplate;
export declare const EmailChangedEmail: EmailChangedEmailTemplate;

// src: configuration

export declare const version: string;
export declare const providers: DiProvider<unknown>[];
export declare const sharedProviders: DiProvider<unknown>[];
export declare const applicationOptions: ZibriApplicationOptions;
export declare function requireEnv(key: string): string;
export declare const environment: {
    jwtAccessSecret: string,
    jwtRefreshSecret: string,
    clientCertificateAuthority: string,
    ldapPassword: string,
    domainPassword: string,
    domainCaCertificate: string
};
export declare const secrets: {
    accessTokenKey: string,
    refreshTokenSecret: string,
    s3AccessKeyId: string,
    s3SecretAccessKey: string,
    sftpPrivateKey: string
};
export declare const clientCert: string;
export declare const clientKey: string;

// src/services: the reader's own, and their clients of outside services

@Injectable()
export class PdfService {}

export type ReportStorage = {
    save: (name: string, content: Buffer) => Promise<void>
};
export declare const REPORT_STORAGE: InjectionToken<ReportStorage>;

export declare const SiemAuditService: Newable<AuditServiceInterface>;
export declare const SharedAuthRateLimiter: Newable<RateLimiterInterface<BaseRateLimitState>>;
export declare const SharedEmailRateLimiter: Newable<RateLimiterInterface<BaseRateLimitState>>;
export declare const QuietSpan: new (name: string, context: TraceSpanContext) => TraceSpanInterface;

export declare class AnalyticsClient {
    static connect(appName: string): Promise<AnalyticsClient>;
    flush(): Promise<void>;
    disconnect(): Promise<void>;
}

export type DatabaseConnection = {
    query: (sql: string) => Promise<unknown[]>
};
export declare const databaseConnection: InjectionToken<DatabaseConnection>;
export declare function connect(url: string): Promise<DatabaseConnection>;
export declare const vault: { read: (path: string) => Promise<string> };

export declare function resolveWorkloadCredentials(): Promise<S3Credentials>;
export declare function callKms(operation: 'encrypt', key: { arn: string }, value: string): Promise<EncryptionString>;
export declare function callKms(operation: 'decrypt', key: { arn: string }, value: EncryptionString): Promise<string>;
export declare function createKeyInKms(): Promise<string>;
export declare const mailApi: {
    messages: {
        create: (message: { from: string, to: string[], subject: string, html: string }) => Promise<{ rejected: string[] }>
    }
};
export declare const smsGatewayClient: { messages: { create: (message: { to: string, body: string }) => Promise<void> } };
export declare const messenger: { send: (handle: string, text: string) => Promise<void> };
export declare const logAggregator: { send: (logs: Log[]) => Promise<void> };
export declare function announceTask(taskId: string): Promise<void>;
export declare function sendWelcomeMail(userId: string): Promise<void>;
export declare function postToChat(taskId: string, userId: string, options: { idempotencyKey: string, signal: AbortSignal }): Promise<void>;
export declare const workloads: { forget: (userId: string) => void };
export declare const user: { firstName: string, lastName: string };
export declare const customer: { timezone: Timezone };
export declare const order: Order;

// src/__testing__/fixtures

export declare const seededVersionsFolder: FsPath;
export declare function currentTick(): string;
export declare const writersByTag: Map<string, string[]>;