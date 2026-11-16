import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

import { S3Credentials } from '../../backup/transports/s3/s3-credentials.model';
import { S3SignatureUtilities } from '../../backup/transports/s3/s3-signature.utilities';

/**
 * The S3 compatible service the transports are tested against: the Versity S3 gateway, storing into its own
 * file system. It checks every signature, so a request signed wrongly fails here as it would anywhere.
 *
 * Pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason.
 */
const S3_TEST_IMAGE: string = 'versity/versitygw:v1.8.0';
const S3_PORT: number = 7070;

/**
 * The SFTP server the transports are tested against: OpenSSH's own, configured by the image from its command.
 *
 * The image publishes no version tags, so this is the smallest of the ones it has.
 */
const SFTP_TEST_IMAGE: string = 'atmoz/sftp:alpine';
const SFTP_PORT: number = 22;

/**
 * Who an S3 test server accepts, and the bucket it is started with.
 */
export type S3TestServerOptions = {
    /**
     * The bucket created once the server runs.
     */
    bucket: string,
    /**
     * The region requests are signed for.
     */
    region: string,
    /**
     * The one key the server accepts.
     */
    credentials: S3Credentials
};

/**
 * A running S3 test server.
 */
export type StartedS3TestServer = {
    /**
     * Its container.
     */
    container: StartedTestContainer,
    /**
     * Where it is reached, without a trailing slash.
     */
    endpoint: string
};

/**
 * Who an SFTP test server accepts, and the folder it is started with.
 */
export type SftpTestServerOptions = {
    /**
     * The one user it accepts, locked into its home folder.
     */
    username: string,
    /**
     * The user's password.
     */
    password: string,
    /**
     * A folder created in the user's home.
     */
    folder: string,
    /**
     * A public key the user may also log in with.
     */
    authorizedKey?: string
};

/**
 * A running SFTP test server.
 */
export type StartedSftpTestServer = {
    /**
     * Its container.
     */
    container: StartedTestContainer,
    /**
     * The host it is reached on.
     */
    host: string,
    /**
     * The port it is reached on.
     */
    port: number,
    /**
     * The fingerprint of the key it identifies itself with first, as `ssh-keygen -lf` prints it.
     */
    hostKeyFingerprint: string
};

/**
 * Starts the servers the remote backup transports are tested against.
 */
export abstract class BackupTransportTestServerUtilities {
    /**
     * Starts an S3 test server, and creates its bucket.
     * @param options - Who it accepts, and its bucket.
     * @returns The running server.
     * @throws When the bucket cannot be created.
     */
    static async startS3(options: S3TestServerOptions): Promise<StartedS3TestServer> {
        // arguments go to the gateway as they are. /tmp/vgw is a directory the image creates
        const container: StartedTestContainer = await new GenericContainer(S3_TEST_IMAGE)
            .withCommand([
                '--access',
                options.credentials.accessKeyId,
                '--secret',
                options.credentials.secretAccessKey,
                '--region',
                options.region,
                '--port',
                `:${S3_PORT}`,
                '--health',
                '/health',
                'posix',
                '/tmp/vgw'
            ])
            .withExposedPorts(S3_PORT)
            .withWaitStrategy(Wait.forHttp('/health', S3_PORT))
            .start();
        const endpoint: string = `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`;
        const created: Response = await BackupTransportTestServerUtilities.sendSignedS3(endpoint, options, 'PUT', `/${options.bucket}`);
        if (!created.ok) {
            await container.stop();
            throw new Error(`The bucket "${options.bucket}" could not be created: ${created.status} ${await created.text()}`);
        }
        return { container, endpoint };
    }

    /**
     * Sends a signed request to an S3 test server directly, for what a transport itself never does.
     * @param endpoint - Where the server is reached.
     * @param options - Who it accepts.
     * @param method - The http method.
     * @param path - The path and query, starting with the bucket.
     * @returns The response.
     */
    static async sendSignedS3(endpoint: string, options: S3TestServerOptions, method: string, path: string): Promise<Response> {
        const url: URL = new URL(`${endpoint}${path}`);
        const headers: Record<string, string> = S3SignatureUtilities.resolveHeaders({
            method,
            url,
            headers: {},
            payloadHash: S3SignatureUtilities.hash(''),
            credentials: options.credentials,
            region: options.region,
            date: new Date()
        });
        return await fetch(url, { method, headers });
    }

    /**
     * Starts an SFTP test server.
     * @param options - Who it accepts, and the folder it is started with.
     * @returns The running server.
     * @throws When its host key cannot be read.
     */
    static async startSftp(options: SftpTestServerOptions): Promise<StartedSftpTestServer> {
        // `user:password:uid:gid:folder`. The image adds the keys under .ssh/keys to the user's authorized keys
        const starting: GenericContainer = new GenericContainer(SFTP_TEST_IMAGE)
            .withCommand([`${options.username}:${options.password}:::${options.folder}`])
            .withExposedPorts(SFTP_PORT)
            .withWaitStrategy(Wait.forLogMessage(/Server listening on/));
        const container: StartedTestContainer = await (options.authorizedKey == undefined
            ? starting
            : starting.withCopyContentToContainer([
                {
                    content: options.authorizedKey,
                    target: `/home/${options.username}/.ssh/keys/id_ecdsa.pub`
                }
            ])).start();
        // the key a client is offered first, as `ssh-keygen -lf` prints it: `256 SHA256:... comment (ED25519)`
        const { output } = await container.exec(['ssh-keygen', '-lf', '/etc/ssh/ssh_host_ed25519_key.pub']);
        const hostKeyFingerprint: string = output.split(' ')[1] ?? '';
        if (!hostKeyFingerprint.startsWith('SHA256:')) {
            await container.stop();
            throw new Error(`The host key of the sftp server could not be read: ${output}`);
        }
        return { container, host: container.getHost(), port: container.getMappedPort(SFTP_PORT), hostKeyFingerprint };
    }
}