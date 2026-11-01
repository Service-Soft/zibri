/* eslint-disable stylistic/max-len */
// What the other zibri packages, and an application building its own data source, driver, parser or
// router, use from zibri beyond the public api in `index.ts`. Released with zibri but outside its
// semver promise: anything here can change in any release (see docs/releases.md).
//
// A name belongs here when it is only needed to build a custom version of something zibri ships.
// Every other name is public, and the docs-style test asks for a Key exports row for each of them.

// eslint-disable-next-line eslintImport/no-unassigned-import
import 'reflect-metadata';

// auth
export { type CurrentUserMetadata } from './auth/decorators/current-user.decorator';
export { hasPermissionDecorator } from './auth/decorators/has-permission.decorator';
export { isLoggedInDecorator } from './auth/decorators/is-logged-in.decorator';
export { isNotLoggedInDecorator } from './auth/decorators/is-not-logged-in.decorator';
export { require2faDecorator } from './auth/decorators/require-2fa.decorator';
export { type SkipIsLoggedInMetadata } from './auth/models/is-logged-in-metadata.model';
export { type SkipHasPermissionMetadata } from './auth/models/has-permission-metadata.model';
export { type SkipIsNotLoggedInMetadata } from './auth/models/is-not-logged-in-metadata.model';
export { type SkipMetadata } from './auth/models/skip-auth-metadata.model';
export { PasswordResetTokenCreateData } from './auth/models/password-reset-token.model';
export { type SkipRequire2faMetadata } from './auth/models/require-2fa-metadata.model';
export { LoginTicketCreateData } from './auth/models/login-ticket.model';
export * from './auth/strategies/jwt/jwt.utilities';
export * from './auth/strategies/jwt/encoded-jwt.model';
export * from './auth/strategies/jwt/jwt-refresh-token-payload.model';
export { JwtRefreshTokenCreateDto } from './auth/strategies/jwt/jwt-refresh-token.model';
export * from './auth/strategies/jwt/jwt-assertion-verify-options.model';
export * from './auth/strategies/jwt/jwt-client-access-token-payload.model';
export * from './auth/strategies/jwt/verified-dpop-proof.model';
export * from './auth/strategies/jwt/jwt-remote-key-set.type';
export { JwtRevokedAccessTokenCreateData } from './auth/strategies/jwt/jwt-revoked-access-token.model';
export * from './auth/strategies/jwt/jwt-provider-token-verify-options.model';
export * from './auth/strategies/jwt/jwt-logout-token-verify-options.model';
export { CookieAuthRefreshSessionCreateData } from './auth/strategies/cookie/cookie-auth-refresh-session.model';
export { CookieAuthSessionCreateData } from './auth/strategies/cookie/cookie-auth-session.model';
export { ApiKeyCreateDto } from './auth/strategies/api-key/api-key.model';
export { DEFAULT_API_KEY_PREFIX } from './auth/strategies/api-key/api-key.service';
export * from './auth/scim/scim-bulk.utilities';
export * from './auth/scim/scim-filter.model';
export * from './auth/scim/scim-filter-match.model';
export * from './auth/scim/scim-filter.utilities';
export * from './auth/scim/scim-indexed-filter.model';
export * from './auth/scim/scim-paging.utilities';
export * from './auth/scim/scim-patch-operation.model';
export * from './auth/scim/scim-patch.utilities';
export * from './auth/scim/scim-schema.enum';
export * from './auth/scim/scim-schema.utilities';
export * from './auth/scim/scim-user-pages.model';
export * from './auth/scim/scim-user-value.utilities';
export * from './auth/scim/scim-value-sort.model';
export * from './auth/scim/scim-where.utilities';
export { type PasswordFailureStreakCreateData } from './auth/authenticators/password/password-failure-streak.model';
export * from './auth/authenticators/passkey/simple-web-authn.type';
export * from './auth/authenticators/passkey/simple-web-authn-helpers.type';
export { PasskeyChallengeCreateData } from './auth/authenticators/passkey/passkey-challenge.model';
export { PasskeyRegistrationTicketCreateData } from './auth/authenticators/passkey/passkey-registration-ticket.model';
export { PasskeyCreateData } from './auth/authenticators/passkey/passkey.model';
export { type ResolvedFederationOptions } from './auth/authenticators/federated/base-federated.authenticator';
export { FederatedLoginAttemptCreateData } from './auth/authenticators/federated/federated-login-attempt.model';
export { FederatedIdentityCreateData } from './auth/authenticators/federated/federated-identity.model';
export { FederatedHandoverCodeCreateData } from './auth/authenticators/federated/federated-handover-code.model';
export { FederatedRegistrationTicketCreateData } from './auth/authenticators/federated/federated-registration-ticket.model';
export { FederatedConnectionCodeCreateData } from './auth/authenticators/federated/federated-connection-code.model';
export * from './auth/authenticators/saml/saml-identity-provider-settings.model';
export * from './auth/authenticators/saml/metadata/saml-metadata-endpoint.model';
export * from './auth/authenticators/saml/metadata/saml-metadata-entity-descriptor.model';
export * from './auth/authenticators/saml/metadata/saml-metadata-idp-sso-descriptor.model';
export * from './auth/authenticators/saml/metadata/saml-metadata-key-descriptor.model';
export * from './auth/authenticators/saml/metadata/saml-metadata-key-info.model';
export * from './auth/authenticators/saml/metadata/saml-metadata-x509-data.model';
export { LdapIdentityCreateData } from './auth/authenticators/ldap/ldap-identity.model';
export { OAuthProviderTokensCreateData } from './auth/authenticators/oauth/oauth-provider-tokens.model';
export { type CreateTwoFactorFailureStreakData } from './auth/2fa/two-factor-failure-streak.model';
export { TwoFactorRecoveryCodeCreateData } from './auth/2fa/methods/recovery-code/two-factor-recovery-code.model';
export { TwoFactorCodeCredentialsCreateData } from './auth/2fa/methods/code/two-factor-code-credentials.model';
export { TwoFactorCodeCreateData } from './auth/2fa/methods/code/two-factor-code.model';
export { OtpCredentialsCreateData } from './auth/2fa/methods/otp/otp-credentials.model';
export { OTP_PERIOD_IN_SECONDS, OtpUtilities } from './auth/2fa/methods/otp/otp.utilities';
export { EncryptionRotationFailureCreateData } from './auth/encryption/encryption-rotation-failure.model';
export { EncryptionRotationProgressCreateData } from './auth/encryption/encryption-rotation-progress.model';
export { type EncryptionStrategyEntityCreateData } from './auth/encryption/strategies/encryption-strategy-entity.model';
export { type HashStrategyEntityCreateData } from './auth/hash/strategies/hash-strategy-entity.model';

// di
export { getAmbiguousRepositoryDataSources, setAmbiguousRepositoryTokens } from './di/decorators/inject-repository.decorator';
export { tokenName } from './di/models/di-token.model';
export { DiContainer } from './di/di-container';
export * from './di/init-di-container.function';
export * from './di/get-all-registered-tokens.function';
export * from './di/get-all-instantiated-values.function';
export * from './di/get-registered-providers-of-variant.function';
export * from './di/errors/get-dependency-stack-trace.function';

// event
export { ALL_EVENTS_TYPE, type EventSubscriberRegistrationCreateData } from './event/event-subscriber-registration.model';
export { type EventSubscriberRunCreateData } from './event/event-subscriber-run.model';
export { EventCreateData } from './event/event.model';

// routing
export { type ControllerRouteConfiguration } from './routing/controller-route-configuration.model';
export { type HeaderMetaInputObjectToMetaObject, type HeaderMetaObjectToParamsObject } from './routing/route-configuration.model';
export { type ControllerData } from './routing/decorators/controller.decorator';
export { resolveMaxBodySize } from './routing/decorators/body.decorator';
export { type BodyMetadataForType, type BodyShapeMetadata, type FormDataBodyMetadata, type FormUrlEncodedBodyMetadata, type JsonBodyMetadata, type ShapedBodyMetadata, type StreamBodyMetadata, type XmlBodyMetadata } from './routing/decorators/body-metadata.model';
export { type StringParamMetadata } from './routing/models/string-param-metadata.model';
export { type NumberParamMetadata } from './routing/models/number-param-metadata.model';
export { type BooleanParamMetadata } from './routing/models/boolean-param-metadata.model';
export { type DateParamMetadata } from './routing/models/date-param-metadata.model';
export { type ObjectParamMetadata } from './routing/models/object-param-metadata.model';
export { type ArrayParamItemMetadata, type ArrayParamMetadata } from './routing/models/array-param-metadata.model';
export { type OneOfParamMetadata } from './routing/models/one-of-param-metadata.model';

// context
export * from './context/operation-limit.utilities';

// error handling
export * from './error-handling/error-handler';

// audit
export { type AuditEntryCreateData } from './audit/audit-entry.model';
export { type ChainedAuditEntryCreateData } from './audit/chained-audit-entry.model';
export { type AuditCheckpointCreateData } from './audit/audit-checkpoint.model';
export { type RecordedAuditEntry } from './audit/base-audit-entry.model';

// global
export * from './global/model-registry/model.registry';
export * from './global/model-registry/remove-exclude-properties.function';
export * from './global/model-registry/restore-exclude-properties.function';
export * from './global/model-registry/set-default-values.function';

// logging
export * from './logging/audit.utilities';
export { createLogToEmail } from './logging/transport/log-to-email.function';

// openapi
export { type OpenApiContentObject, type OpenApiOperation, type OpenApiParameter, type OpenApiParameterLocation, type OpenApiPaths, type OpenApiRequestBodyObject, type OpenApiResponseObject, type OpenApiResponsesObject, type OpenApiSchemaObject, type OpenApiSchemaObjectType, type OpenApiSchemas, type OpenApiSecurityRequirementObject, type OpenApiTagObject, type OpenApiXmlObject } from './open-api/open-api.model';
export { KeysetPageClass, PaginationResultClass } from './data-source/models/pagination-result.model';

// entity
export { type EntityMetadata } from './entity/decorators/entity.decorator';
export { createAnyOfShapesMetadata, createArrayItemPropertyMetadata, createArrayPropertyMetadata, createOneOfPropertyMetadata, type PropertyMetadata, type RelationMetadata } from './entity/decorators/property.decorator';
export * from './entity/models/entity-order.utilities';
export { type RelationTreeByRowId } from './entity/models/entity-relations.model';
export * from './entity/models/entity-relations.utilities';
export { EntitySelectionUtilities } from './entity/models/entity-selection.utilities';
export { coversEveryRow, declaresUnique, type UniqueGroup, uniqueWhereOf } from './entity/models/unique-declaration.model';
export { type AnyStrategyStringPropertyMetadata, type AnyStrategyStringPropertyMetadataInput, type StoredEncryptionPropertyValue, type StoredHashPropertyValue, type StoredStringPropertyMetadata, type StringPropertyMetadata } from './entity/models/string-property-metadata.model';
export { type NumberPropertyMetadata } from './entity/models/number-property-metadata.model';
export { type ObjectPropertyMetadata } from './entity/models/object-property-metadata.model';
export { type AnyOfShapesMetadata, type OneOfPropertyMetadata, type OneOfShapeMetadata } from './entity/models/one-of-property-metadata.model';
export { type ArrayPropertyItemMetadata, type ArrayPropertyMetadata } from './entity/models/array-property-metadata.model';
export { type DatePropertyMetadata } from './entity/models/date-property-metadata.model';
export { type BooleanPropertyMetadata } from './entity/models/boolean-property-metadata.model';
export { type ManyToOnePropertyMetadata } from './entity/models/many-to-one-property-metadata.model';
export { type OneToManyPropertyMetadata } from './entity/models/one-to-many-property-metadata.model';
export { type BelongsToOnePropertyMetadata } from './entity/models/belongs-to-one-property-metadata.model';
export { type HasOnePropertyMetadata } from './entity/models/has-one-property-metadata.model';
export { type ManyToManyPropertyMetadata } from './entity/models/many-to-many-property-metadata.model';
export * from './entity/models/relation.enum';
export { type UnknownPropertyMetadata } from './entity/models/unknown-property-metadata.model';
export { type FilePropertyMetadata } from './entity/models/file-property-metadata.model';
export * from './entity/generation/generate-entity-files.function';

// parsing
export * from './parsing/functions/parse-array.function';
export * from './parsing/functions/parse-number.function';
export * from './parsing/functions/parse-object.function';
export * from './parsing/functions/parse-one-of.function';
export * from './parsing/functions/parse-form-field.function';
export * from './parsing/xml/xml-property-metadata.model';
export { type XmlRootMetadata } from './parsing/xml/xml-root-metadata.model';
export { CLEANUP_AT_FILE_NAME, type FormDataValue } from './parsing/form-data/form-data.model';

// http
export { compressionMiddleware } from './http/compression.middleware';
export { resolveContentDisposition } from './http/content-disposition.function';
export { corsMiddleware } from './http/cors.middleware';
export { httpMethodKey } from './http/http-method.enum';
export * from './http/cookie-options.model';
export * from './http/request-deadline.utilities';
export * from './http/route-label.utilities';
export * from './http/trace-context.middleware';

// tracing
export { type OpenTelemetryApi, type OpenTelemetryApiTracer, type OpenTelemetryContext, type OpenTelemetryHrTime, type OpenTelemetryNodeSdk, type OpenTelemetryOtlpExporter, type OpenTelemetryOtlpExporterConfig, type OpenTelemetryReadableSpan, type OpenTelemetryResource, type OpenTelemetryResources, type OpenTelemetrySpan, type OpenTelemetrySpanContext, type OpenTelemetrySpanOptions, type OpenTelemetrySpanProcessor, type OpenTelemetrySpanStatus, type OpenTelemetryTracerProvider, type OpenTelemetryTracerProviderConfig, type OpenTelemetryTraceState } from './tracing/open-telemetry/open-telemetry-api.model';
export * from './tracing/open-telemetry/open-telemetry.span';
export * from './tracing/open-telemetry/open-telemetry.utilities';
export * from './tracing/open-telemetry/trace-buffer.span-processor';

// validation
export { IsRequiredValidationProblem, MaxFileSizeValidationProblem, MimeTypeMismatchValidationProblem, NoShapeFitsValidationProblem, RelationsNotAllowedValidationProblem, TypeMismatchValidationProblem, UnknownKeyValidationProblem, UnknownShapeValidationProblem } from './validation/validation-problem.model';

// data source
export * from './data-source/entity-ownership.function';
export * from './data-source/upsert-identity.utilities';
// needed to add or drop the constraint from a migration, which has to name it exactly as the schema did
export * from './data-source/index-name.function';
export * from './data-source/unique-constraint-name.function';
export * from './data-source/check-constraint-name.function';
export { type BulkUpdate, UNBOUNDED_FIND_ALL_LIMIT, type WrittenUpdate } from './data-source/repository/repository';
export { type RepositoryClassFor } from './data-source/repository/repository-for.decorator';
export * from './data-source/repository/repository-for-metadata.model';
export * from './data-source/repository/repository-for.utilities';
export { REPOSITORY_KINDS, type RepositoryKind } from './data-source/repository/repository-kind.model';
export { type DataSourceMetadata } from './data-source/decorators/data-source.decorator';
export { DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS, SCHEMA_LOCK_KEY } from './data-source/data-sources/data-source.interface';
export * from './data-source/data-sources/postgres/postgres-schema.model';
export * from './data-source/data-sources/postgres/postgres-table.model';
export * from './data-source/data-sources/postgres/postgres-where-filter.converter';
export * from './data-source/data-sources/where-converter/where-filter.evaluator';
export * from './data-source/driver/postgres.repository-driver';
export * from './data-source/driver/val-key.repository-driver';
export * from './data-source/keyset/after-cursor-where.function';
export * from './data-source/keyset/keyset-order.model';
export * from './data-source/transaction/open-transactions.model';
export * from './data-source/transaction/postgres-transaction.model';
export * from './data-source/transaction/spanning-transaction-participants.model';
export * from './data-source/transaction/val-key-transaction.model';
export * from './data-source/models/column-type.model';
export * from './data-source/models/entity-migration-input.model';
export * from './data-source/models/migration-property-value.model';
export * from './data-source/migration/migrated-entity.utilities';
export * from './data-source/models/castable-property-type.type';
// for the in memory data source, which converts values the way the valkey one does
export * from './data-source/value-conversion.utilities';
export * from './data-source/models/resolved-property-conversion.model';
export * from './data-source/models/converted-value.model';
export * from './data-source/models/refused-value.model';
export * from './data-source/models/conversion-refusal.enum';
export { type AtomicUpdateValue } from './data-source/models/atomic-update.model';
export { type IncrementAmounts, type IncrementFor } from './data-source/models/update-all-data.model';
export * from './data-source/data-source-time.utilities';
export * from './data-source/chain/chain.utilities';
export { type ChainAnchorCreateData } from './data-source/chain/chain-anchor.model';
export { type SigningKeyCreateData } from './auth/encryption/signing-key.model';
export * from './data-source/repository/append-only.utilities';
export * from './data-source/models/keyset-cursor.model';
export { type IsOneOf, type NamedShapeValue } from './data-source/models/where/one-of-where-filter.model';
export * from './data-source/models/where/one-of-where-filter.utilities';
export { type BoundedFuzzyLikeFilter, DEFAULT_MIN_SIMILARITY, type ParsedFuzzyLikeFilter, parseFuzzyLikeFilter, type SimilarityBound } from './data-source/models/where/fuzzy-like.model';
export * from './data-source/models/where/where-filter-keys.model';
export * from './data-source/scopes/related-narrowing.utilities';
export * from './data-source/scopes/scope-where.utilities';
export * from './data-source/migration/run-migrations.function';
export * from './data-source/migration/migration-command.utilities';

// cron
export { type CreateCronJobEntityData } from './cron/cron-job-entity.model';

// leases
export { type CreateLeaseData } from './leases/lease.model';

// queue: what the framework's own queues are built from
export * from './queue/queue-definition.model';
export * from './queue/queue-poll.cron-job';
export * from './queue/queue.utilities';
export * from './queue/queued-work-item.model';
export * from './queue/queued-work-outcome.model';

// email
export { CreateEmailData } from './email/models/create-email-data.model';

// rate limiting
export * from './rate-limiting/rate-limiter-metrics.model';

// handlebars
export { type PathTree } from './handlebars/generate-handlebar-type-files.function';

// tsx
export * from './tsx/tsx-locale-data.model';

// change sets
export { type CreateChangeSetData } from './data-source/change-sets/models/change-set.model';
export { type NewChange } from './data-source/change-sets/models/change.model';

// document
export * from './document/xml-element-node.model';
export * from './document/pdf-font-fallback.utilities';

// mailing list
export { MailingListSubscriptionConfirmationTokenCreateData } from './plugin/mailing-list/models/mailing-list-subscription-confirmation-token.model';

// localization
export * from './localization/translation.registry';
export * from './localization/xlf/extract-translation-strings.function';
export * from './localization/xlf/get-framework-translation-origin.function';
export * from './localization/xlf/models/extracted-translation-string.model';

// multithreading
export * from './multithreading/models/thread-job-message.model';
export * from './multithreading/services/thread-job';
export * from './multithreading/services/thread-job-worker';

// websocket
export * from './websocket/models/websocket-controller-route-configuration.model';
export { CreateWebsocketMessageData } from './websocket/models/websocket-message.model';
export { type WebsocketMessageSequenceCreateData, WEBSOCKET_MESSAGE_SEQUENCE_NAME } from './websocket/models/websocket-message-sequence.model';
export * from './websocket/data-source.websocket-adapter';
export { type WebsocketControllerData } from './websocket/decorators/websocket-controller.decorator';
export { type CurrentWebsocketConnectionMetadata } from './websocket/decorators/current-websocket-connection.decorator';

// backup
export { type BackupEntityCreateData } from './backup/backup-entity.model';
export { type BackupResourceEntityCreateData } from './backup/backup-resource-entity.model';
export { type BackupResourceMetadata } from './backup/decorators/backup-resource-metadata.model';

// caching
export * from './caching/cache-metrics.model';
export { type CreateCacheInvalidationData } from './caching/cache-invalidation.model';
export * from './caching/cache/base-cache.model';
export * from './caching/cache/read-aside/read-aside.cache';
export * from './caching/cache/read-through/read-through.cache';
export { type DeclaringClass } from './caching/store/cache-model.model';

// versioning
export * from './versioning/route-with-version-data.model';

// utilities
export * from './utilities/read-number.function';
export * from './utilities/metadata.utilities';