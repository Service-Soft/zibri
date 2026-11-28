import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { DiContainer } from '../../di/di-container';
import { initDiContainer } from '../../di/init-di-container.function';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { register } from '../../di/register.function';
import { Parser } from '../../parsing/parser';
import { ParserInterface } from '../../parsing/parser.interface';
// the parsers of the bodies a WebDAV client reads, and the share api of Nextcloud answers with, which register
// themselves as they load, as the barrel loads them in an application
// eslint-disable-next-line eslintImport/no-unassigned-import
import '../../parsing/json/json.body-parser';
// eslint-disable-next-line eslintImport/no-unassigned-import
import '../../parsing/stream/stream.body-parser';
// eslint-disable-next-line eslintImport/no-unassigned-import
import '../../parsing/xml/xml.body-parser';
import { WebDavConnection } from '../../web-dav/web-dav-connection.model';
import { WebDavTenantConnectionOptions } from '../../web-dav/web-dav-tenant-connection-options.model';

/**
 * The WebDAV server every suite runs against: Apache's httpd with mod_dav, the official image, configured below. It
 * implements RFC 4918 itself, ETags and conditional requests included, and refuses a listing of infinite depth, as
 * many servers do.
 *
 * Pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason.
 */
const APACHE_TEST_IMAGE: string = 'httpd:2.4.70-alpine';

/**
 * The Nextcloud the suite of its own behaviour runs against, with SQLite and nothing else.
 */
const NEXTCLOUD_TEST_IMAGE: string = 'nextcloud:35.0.2-apache';

const HTTP_PORT: number = 80;

/**
 * How long Nextcloud may take to install itself on its first start.
 */
const NEXTCLOUD_STARTUP_TIMEOUT_IN_MS: number = 300_000;

/**
 * What httpd runs with: WebDAV on the folder `/dav`, behind basic auth.
 *
 * With ETags of the content of a file. The default ones are of its size and time, and weak while the file is less
 * than a second old, which no If-Match matches: a case taking the ETag of a file it just wrote would be refused,
 * as a client of such a server is.
 */
const APACHE_CONFIG: string = `ServerRoot "/usr/local/apache2"
Listen ${HTTP_PORT}
LoadModule mpm_event_module modules/mod_mpm_event.so
LoadModule unixd_module modules/mod_unixd.so
LoadModule authn_core_module modules/mod_authn_core.so
LoadModule authn_file_module modules/mod_authn_file.so
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_user_module modules/mod_authz_user.so
LoadModule auth_basic_module modules/mod_auth_basic.so
LoadModule mime_module modules/mod_mime.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule dav_module modules/mod_dav.so
LoadModule dav_fs_module modules/mod_dav_fs.so
User daemon
Group daemon
ServerName localhost:${HTTP_PORT}
ErrorLog /proc/self/fd/2
LogFormat "%h %u \\"%r\\" %>s %b" common
CustomLog /proc/self/fd/1 common
TypesConfig conf/mime.types
DavLockDB "/usr/local/apache2/var/dav-lock"
FileETag Digest
DocumentRoot "/usr/local/apache2/dav"
<Directory "/usr/local/apache2/dav">
    Dav On
    AuthType Basic
    AuthName "WebDAV"
    AuthUserFile "/usr/local/apache2/conf/dav.htpasswd"
    Require valid-user
    Options None
    AllowOverride None
</Directory>
`;

/**
 * Who a WebDAV test server accepts.
 */
export type WebDavTestServerOptions = {
    /**
     * The one user it accepts.
     */
    username: string,
    /**
     * The user's password.
     */
    password: string
};

/**
 * A running WebDAV test server.
 */
export type StartedWebDavTestServer = {
    /**
     * Its container.
     */
    container: StartedTestContainer,
    /**
     * Where it is reached, without a trailing slash, such as `http://localhost:32768`.
     */
    origin: string,
    /**
     * The folder of the user, who logs in with the password the server was started with.
     */
    connection: WebDavConnection
};

/**
 * Starts the WebDAV servers the WebDAV client is tested against, and sets up what a client of them needs.
 */
export abstract class WebDavTestServerUtilities {
    /**
     * Starts Apache's httpd serving WebDAV.
     * @param options - Who it accepts.
     * @returns The running server, its connection the folder it serves.
     */
    static async startApache(options: WebDavTestServerOptions): Promise<StartedWebDavTestServer> {
        // the folders httpd writes to, and the user, whose name and password reach the shell as arguments
        const script: string = 'mkdir -p /usr/local/apache2/dav /usr/local/apache2/var'
            + ' && chown daemon:daemon /usr/local/apache2/dav /usr/local/apache2/var'
            + ' && htpasswd -bc /usr/local/apache2/conf/dav.htpasswd "$1" "$2"'
            + ' && exec httpd-foreground';
        const container: StartedTestContainer = await new GenericContainer(APACHE_TEST_IMAGE)
            .withCopyContentToContainer([{ content: APACHE_CONFIG, target: '/usr/local/apache2/conf/httpd.conf' }])
            .withCommand(['sh', '-c', script, 'sh', options.username, options.password])
            .withExposedPorts(HTTP_PORT)
            .withWaitStrategy(Wait.forLogMessage(/resuming normal operations/))
            .start();
        const origin: string = `http://${container.getHost()}:${container.getMappedPort(HTTP_PORT)}`;
        return { container, origin, connection: { url: `${origin}/`, username: options.username, password: options.password } };
    }

    /**
     * Starts Nextcloud, installed with SQLite, and creates an app password for its admin.
     * @param options - The admin, who logs in to WebDAV with an app password rather than this password.
     * @returns The running server, its connection the files of the admin, logged in with the app password.
     * @throws When the app password cannot be created.
     */
    static async startNextcloud(options: WebDavTestServerOptions): Promise<StartedWebDavTestServer> {
        const container: StartedTestContainer = await new GenericContainer(NEXTCLOUD_TEST_IMAGE)
            .withEnvironment({
                SQLITE_DATABASE: 'nextcloud',
                NEXTCLOUD_ADMIN_USER: options.username,
                NEXTCLOUD_ADMIN_PASSWORD: options.password,
                // whatever host the tests reach it by
                NEXTCLOUD_TRUSTED_DOMAINS: '*'
            })
            .withExposedPorts(HTTP_PORT)
            .withWaitStrategy(Wait.forHttp('/status.php', HTTP_PORT).forResponsePredicate(body => body.includes('"installed":true')))
            .withStartupTimeout(NEXTCLOUD_STARTUP_TIMEOUT_IN_MS)
            .start();
        const origin: string = `http://${container.getHost()}:${container.getMappedPort(HTTP_PORT)}`;
        try {
            const appPassword: string = await WebDavTestServerUtilities.createNextcloudAppPassword(origin, options);
            return {
                container,
                origin,
                connection: {
                    url: `${origin}/remote.php/dav/files/${encodeURIComponent(options.username)}/`,
                    username: options.username,
                    password: appPassword
                }
            };
        }
        catch (error) {
            await container.stop();
            throw error;
        }
    }

    /**
     * Initializes the container of the process, with the body parsers an application registers as it starts.
     * @param tenantOptions - What tenants' connections may reach, if not the defaults.
     * @throws When the parser of the container is not the framework's.
     */
    static initContainer(tenantOptions?: WebDavTenantConnectionOptions): void {
        DiContainer.reset();
        initDiContainer();
        if (tenantOptions != undefined) {
            register(defineProvider({ token: ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS, useValue: tenantOptions }));
        }
        const parser: ParserInterface = inject(ZIBRI_DI_TOKENS.PARSER);
        if (!(parser instanceof Parser)) {
            throw new TypeError('The parser of the container is no Parser.');
        }
        parser.onAppInit();
    }

    /**
     * Creates a calendar of the user of a Nextcloud, as its calendar app does, with an MKCALENDAR (RFC 4791).
     * @param server - The running Nextcloud, logged in to as its admin.
     * @param name - The name of the calendar in the url, such as `projects`.
     * @returns The path of the calendar below `remote.php/dav/`, such as `calendars/ada/projects`.
     * @throws When Nextcloud does not create it.
     */
    static async createNextcloudCalendar(server: StartedWebDavTestServer, name: string): Promise<string> {
        const path: string = `calendars/${encodeURIComponent(server.connection.username)}/${encodeURIComponent(name)}`;
        const credentials: string = Buffer.from(`${server.connection.username}:${server.connection.password}`).toString('base64');
        // MKCALENDAR is no method of the http client, which knows those of WebDAV alone
        const response: Response = await fetch(`${server.origin}/remote.php/dav/${path}/`, {
            method: 'MKCALENDAR',
            headers: { 'authorization': `Basic ${credentials}`, 'content-type': 'application/xml; charset=utf-8' },
            body: '<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
                + `<d:set><d:prop><d:displayname>${name}</d:displayname>`
                + '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>'
                + '</d:prop></d:set></c:mkcalendar>'
        });
        if (response.status !== 201) {
            throw new Error(`Nextcloud created no calendar: ${response.status} ${await response.text()}`);
        }
        return path;
    }

    /**
     * Creates a user of a Nextcloud, as an admin does in the users settings, and an app password of it.
     * @param server - The running Nextcloud, logged in to as its admin.
     * @param user - The id of the user, and their own password.
     * @param groups - The groups the user is a member of, none of which exists yet.
     * @returns The connection to the files of the user, logged in with the app password.
     * @throws When Nextcloud does not create the user, a group, or the app password.
     */
    static async createNextcloudUser(server: StartedWebDavTestServer, user: WebDavTestServerOptions, groups: string[]): Promise<WebDavConnection> {
        for (const group of groups) {
            const created: Response = await WebDavTestServerUtilities.sendAsAdmin(server, 'cloud/groups', { groupid: group });
            if (!created.ok) {
                throw new Error(`Nextcloud created no group: ${created.status} ${await created.text()}`);
            }
        }
        const response: Response = await WebDavTestServerUtilities.sendAsAdmin(server, 'cloud/users', { userid: user.username, password: user.password, groups });
        if (!response.ok) {
            throw new Error(`Nextcloud created no user: ${response.status} ${await response.text()}`);
        }
        const appPassword: string = await WebDavTestServerUtilities.createNextcloudAppPassword(server.origin, user);
        return {
            url: `${server.origin}/remote.php/dav/files/${encodeURIComponent(user.username)}/`,
            username: user.username,
            password: appPassword
        };
    }

    /**
     * Sends a request to the OCS api of a Nextcloud as its admin.
     * @param server - The running Nextcloud, logged in to as its admin.
     * @param path - The path below `/ocs/v2.php/`.
     * @param body - What is posted, as json.
     * @returns The answer.
     */
    private static async sendAsAdmin(server: StartedWebDavTestServer, path: string, body: object): Promise<Response> {
        return await fetch(`${server.origin}/ocs/v2.php/${path}?format=json`, {
            method: 'POST',
            headers: {
                'authorization': `Basic ${Buffer.from(`${server.connection.username}:${server.connection.password}`).toString('base64')}`,
                'ocs-apirequest': 'true',
                'content-type': 'application/json'
            },
            body: JSON.stringify(body)
        });
    }

    /**
     * Creates an app password of a user of Nextcloud, as a user does in the security settings.
     * @param origin - Where Nextcloud is reached.
     * @param options - The user, and their own password.
     * @returns The app password.
     * @throws When Nextcloud does not create one.
     */
    private static async createNextcloudAppPassword(origin: string, options: WebDavTestServerOptions): Promise<string> {
        const response: Response = await fetch(`${origin}/ocs/v2.php/core/getapppassword?format=json`, {
            headers: {
                'authorization': `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`,
                'ocs-apirequest': 'true'
            }
        });
        const text: string = await response.text();
        const appPassword: string | undefined = /"apppassword":"([^"]+)"/.exec(text)?.[1];
        if (!response.ok || appPassword == undefined) {
            throw new Error(`Nextcloud created no app password: ${response.status} ${text}`);
        }
        return appPassword;
    }
}
