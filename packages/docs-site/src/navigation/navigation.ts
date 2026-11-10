import { DocsNavigationEntry } from 'zibri';

import * as appSettings from '../../../zibri/docs/application/app-settings.md';
import * as applicationLifecycle from '../../../zibri/docs/application/application-lifecycle.md';
import * as configuration from '../../../zibri/docs/application/configuration.md';
import * as di from '../../../zibri/docs/application/di.md';
import * as errorHandling from '../../../zibri/docs/application/error-handling.md';
import * as plugin from '../../../zibri/docs/application/plugin.md';
import * as projectLayout from '../../../zibri/docs/application/project-layout.md';
import * as requestContext from '../../../zibri/docs/application/request-context.md';
import * as architecture from '../../../zibri/docs/architecture.md';
import * as apiKeys from '../../../zibri/docs/auth/api-keys.md';
import * as authRoutes from '../../../zibri/docs/auth/auth-routes.md';
import * as auth from '../../../zibri/docs/auth/auth.md';
import * as authorizationServer from '../../../zibri/docs/auth/authorization-server.md';
import * as clientCertificates from '../../../zibri/docs/auth/client-certificates.md';
import * as dpop from '../../../zibri/docs/auth/dpop.md';
import * as emailVerification from '../../../zibri/docs/auth/email-verification.md';
import * as loginThroughADirectory from '../../../zibri/docs/auth/login-through-a-directory.md';
import * as loginThroughAProvider from '../../../zibri/docs/auth/login-through-a-provider.md';
import * as passkeys from '../../../zibri/docs/auth/passkeys.md';
import * as providerTokens from '../../../zibri/docs/auth/provider-tokens.md';
import * as rolesAndPermissions from '../../../zibri/docs/auth/roles-and-permissions.md';
import * as scim from '../../../zibri/docs/auth/scim.md';
import * as twoFactor from '../../../zibri/docs/auth/two-factor.md';
import * as backgroundWork from '../../../zibri/docs/background-work/background-work.md';
import * as cron from '../../../zibri/docs/background-work/cron.md';
import * as events from '../../../zibri/docs/background-work/events.md';
import * as multithreading from '../../../zibri/docs/background-work/multithreading.md';
import * as troubleshooting from '../../../zibri/docs/background-work/troubleshooting.md';
import * as audit from '../../../zibri/docs/data/audit.md';
import * as backup from '../../../zibri/docs/data/backup.md';
import * as caching from '../../../zibri/docs/data/caching.md';
import * as costs from '../../../zibri/docs/data/costs.md';
import * as dataSource from '../../../zibri/docs/data/data-source.md';
import * as encryptionAndHashing from '../../../zibri/docs/data/encryption-and-hashing.md';
import * as frameworkTables from '../../../zibri/docs/data/framework-tables.md';
import * as leases from '../../../zibri/docs/data/leases.md';
import * as models from '../../../zibri/docs/data/models.md';
import * as replication from '../../../zibri/docs/data/replication.md';
import * as tamperEvidentTables from '../../../zibri/docs/data/tamper-evident-tables.md';
import * as tenancy from '../../../zibri/docs/data/tenancy.md';
import * as assets from '../../../zibri/docs/endpoints/assets.md';
import * as asyncApi from '../../../zibri/docs/endpoints/async-api.md';
import * as creatingEndpoints from '../../../zibri/docs/endpoints/creating-endpoints.md';
import * as excludingProperties from '../../../zibri/docs/endpoints/excluding-properties.md';
import * as httpClient from '../../../zibri/docs/endpoints/http-client.md';
import * as openApi from '../../../zibri/docs/endpoints/open-api.md';
import * as rateLimiting from '../../../zibri/docs/endpoints/rate-limiting.md';
import * as validation from '../../../zibri/docs/endpoints/validation.md';
import * as versioning from '../../../zibri/docs/endpoints/versioning.md';
import * as websocket from '../../../zibri/docs/endpoints/websocket.md';
import * as xml from '../../../zibri/docs/endpoints/xml.md';
import * as faq from '../../../zibri/docs/faq.md';
import * as gettingStarted from '../../../zibri/docs/getting-started.md';
import * as glossary from '../../../zibri/docs/glossary.md';
import * as deployment from '../../../zibri/docs/operations/deployment.md';
import * as logging from '../../../zibri/docs/operations/logging.md';
import * as metrics from '../../../zibri/docs/operations/metrics.md';
import * as tracing from '../../../zibri/docs/operations/tracing.md';
import * as invoicingPlugin from '../../../zibri/docs/plugins/invoicing-plugin.md';
import * as mailingListPlugin from '../../../zibri/docs/plugins/mailing-list-plugin.md';
import * as paymentPlugin from '../../../zibri/docs/plugins/payment-plugin.md';
import * as releases from '../../../zibri/docs/releases.md';
import * as docs from '../../../zibri/docs/templates/docs.md';
import * as document from '../../../zibri/docs/templates/document.md';
import * as email from '../../../zibri/docs/templates/email.md';
import * as localization from '../../../zibri/docs/templates/localization.md';
import * as templating from '../../../zibri/docs/templates/templating.md';
import * as testing from '../../../zibri/docs/testing.md';
import * as upgradingTo3 from '../../../zibri/docs/upgrading-to-3.md';

// every page of the documentation, in the order of the sidebar: what a reader starts with, then the folders in the
// order an application grows, then what a reader looks things up in. A page leads its folder when it introduces it
export const navigation: DocsNavigationEntry[] = [
    { file: 'getting-started.md', module: gettingStarted },
    { file: 'architecture.md', module: architecture },
    {
        title: 'Application',
        pages: [
            { file: 'application/project-layout.md', module: projectLayout },
            { file: 'application/app-settings.md', module: appSettings },
            { file: 'application/configuration.md', module: configuration },
            { file: 'application/di.md', module: di },
            { file: 'application/application-lifecycle.md', module: applicationLifecycle },
            { file: 'application/request-context.md', module: requestContext },
            { file: 'application/error-handling.md', module: errorHandling },
            { file: 'application/plugin.md', module: plugin }
        ]
    },
    {
        title: 'Endpoints',
        pages: [
            { file: 'endpoints/creating-endpoints.md', module: creatingEndpoints },
            { file: 'endpoints/validation.md', module: validation },
            { file: 'endpoints/excluding-properties.md', module: excludingProperties },
            { file: 'endpoints/versioning.md', module: versioning },
            { file: 'endpoints/rate-limiting.md', module: rateLimiting },
            { file: 'endpoints/open-api.md', module: openApi },
            { file: 'endpoints/async-api.md', module: asyncApi },
            { file: 'endpoints/websocket.md', module: websocket },
            { file: 'endpoints/xml.md', module: xml },
            { file: 'endpoints/assets.md', module: assets },
            { file: 'endpoints/http-client.md', module: httpClient }
        ]
    },
    {
        title: 'Data',
        pages: [
            { file: 'data/data-source.md', module: dataSource },
            { file: 'data/models.md', module: models },
            { file: 'data/tenancy.md', module: tenancy },
            { file: 'data/caching.md', module: caching },
            { file: 'data/leases.md', module: leases },
            { file: 'data/encryption-and-hashing.md', module: encryptionAndHashing },
            { file: 'data/audit.md', module: audit },
            { file: 'data/tamper-evident-tables.md', module: tamperEvidentTables },
            { file: 'data/backup.md', module: backup },
            { file: 'data/replication.md', module: replication },
            { file: 'data/framework-tables.md', module: frameworkTables },
            { file: 'data/costs.md', module: costs }
        ]
    },
    {
        title: 'Auth',
        pages: [
            { file: 'auth/auth.md', module: auth },
            { file: 'auth/auth-routes.md', module: authRoutes },
            { file: 'auth/roles-and-permissions.md', module: rolesAndPermissions },
            { file: 'auth/two-factor.md', module: twoFactor },
            { file: 'auth/passkeys.md', module: passkeys },
            { file: 'auth/email-verification.md', module: emailVerification },
            { file: 'auth/api-keys.md', module: apiKeys },
            { file: 'auth/login-through-a-provider.md', module: loginThroughAProvider },
            { file: 'auth/login-through-a-directory.md', module: loginThroughADirectory },
            { file: 'auth/provider-tokens.md', module: providerTokens },
            { file: 'auth/authorization-server.md', module: authorizationServer },
            { file: 'auth/dpop.md', module: dpop },
            { file: 'auth/client-certificates.md', module: clientCertificates },
            { file: 'auth/scim.md', module: scim }
        ]
    },
    {
        title: 'Background work',
        pages: [
            { file: 'background-work/background-work.md', module: backgroundWork },
            { file: 'background-work/cron.md', module: cron },
            { file: 'background-work/events.md', module: events },
            { file: 'background-work/multithreading.md', module: multithreading },
            { file: 'background-work/troubleshooting.md', module: troubleshooting }
        ]
    },
    {
        title: 'Templates',
        pages: [
            { file: 'templates/templating.md', module: templating },
            { file: 'templates/docs.md', module: docs },
            { file: 'templates/email.md', module: email },
            { file: 'templates/document.md', module: document },
            { file: 'templates/localization.md', module: localization }
        ]
    },
    {
        title: 'Plugins',
        pages: [
            { file: 'plugins/invoicing-plugin.md', module: invoicingPlugin },
            { file: 'plugins/mailing-list-plugin.md', module: mailingListPlugin },
            { file: 'plugins/payment-plugin.md', module: paymentPlugin }
        ]
    },
    {
        title: 'Operations',
        pages: [
            { file: 'operations/deployment.md', module: deployment },
            { file: 'operations/logging.md', module: logging },
            { file: 'operations/metrics.md', module: metrics },
            { file: 'operations/tracing.md', module: tracing }
        ]
    },
    { file: 'testing.md', module: testing },
    { file: 'releases.md', module: releases },
    { file: 'upgrading-to-3.md', module: upgradingTo3 },
    { file: 'faq.md', module: faq },
    { file: 'glossary.md', module: glossary }
];