import { GenericContainer, StartedTestContainer } from 'testcontainers';

import { ClientCertificateProxyStartOptions, describeBehindProxy, StartedClientCertificateProxy } from './client-certificate-proxy.cases';

/**
 * The proxy that ends TLS in front of the application: nginx's official image.
 *
 * Pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason.
 */
const NGINX_TEST_IMAGE: string = 'nginx:1.28.0-alpine';
const VERIFYING_PORT: number = 8443;
const ANY_CERTIFICATE_PORT: number = 8444;
const HEADER: string = 'X-Client-Cert';

/**
 * The configuration of nginx: both ports end TLS and forward the client certificate to the
 * application, one checking who issued it and one not.
 * @param applicationPort - The port the application listens on, on this machine.
 * @returns The configuration.
 */
function nginxConfiguration(applicationPort: number): string {
    const forward: string = [
        'location / {',
        `    proxy_pass http://host.testcontainers.internal:${applicationPort};`,
        // set on every request, so a header of the same name the client sent never reaches the
        // application, and left out when the client showed no certificate
        `    proxy_set_header ${HEADER} $ssl_client_escaped_cert;`,
        '}'
    ].join('\n');
    return `
        server {
            listen ${VERIFYING_PORT} ssl;
            ssl_certificate /etc/nginx/certs/proxy.crt;
            ssl_certificate_key /etc/nginx/certs/proxy.key;
            ssl_client_certificate /etc/nginx/certs/clients.crt;
            ssl_verify_client optional;
            ${forward}
        }
        server {
            listen ${ANY_CERTIFICATE_PORT} ssl;
            ssl_certificate /etc/nginx/certs/proxy.crt;
            ssl_certificate_key /etc/nginx/certs/proxy.key;
            ssl_verify_client optional_no_ca;
            ${forward}
        }
    `;
}

describeBehindProxy('nginx', {
    header: HEADER,
    headerFormat: 'url-encoded-pem',
    forgeHeaderValue: certificate => encodeURIComponent(certificate),
    start: async ({ applicationPort, proxyKeyPair, authority }: ClientCertificateProxyStartOptions): Promise<StartedClientCertificateProxy> => {
        const nginx: StartedTestContainer = await new GenericContainer(NGINX_TEST_IMAGE)
            .withCopyContentToContainer([
                { content: nginxConfiguration(applicationPort), target: '/etc/nginx/conf.d/default.conf' },
                { content: proxyKeyPair.certificate, target: '/etc/nginx/certs/proxy.crt' },
                { content: proxyKeyPair.privateKey, target: '/etc/nginx/certs/proxy.key' },
                { content: authority.certificate, target: '/etc/nginx/certs/clients.crt' }
            ])
            .withExposedPorts(VERIFYING_PORT, ANY_CERTIFICATE_PORT)
            .start();
        return {
            host: nginx.getHost(),
            verifyingPort: nginx.getMappedPort(VERIFYING_PORT),
            anyCertificatePort: nginx.getMappedPort(ANY_CERTIFICATE_PORT),
            stop: async () => {
                await nginx.stop();
            }
        };
    }
});