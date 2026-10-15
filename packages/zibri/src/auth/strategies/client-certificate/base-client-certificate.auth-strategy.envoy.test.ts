import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

import { ClientCertificateProxyStartOptions, describeBehindProxy, StartedClientCertificateProxy } from './client-certificate-proxy.cases';
import { JsonUtilities } from '../../../utilities/json.utilities';

/**
 * The proxy that ends TLS in front of the application: the Envoy project's official image.
 *
 * Pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason.
 */
const ENVOY_TEST_IMAGE: string = 'envoyproxy/envoy:v1.35.0';
const VERIFYING_PORT: number = 8443;
const ANY_CERTIFICATE_PORT: number = 8444;
const CERTIFICATES: string = '/etc/envoy/certs';

/**
 * A listener ending TLS and forwarding the client certificate to the application in
 * `x-forwarded-client-cert`.
 * @param name - The name of the listener.
 * @param port - The port it listens on.
 * @param trustChainVerification - `VERIFY_TRUST_CHAIN` to take only a certificate the authority
 * issued, `ACCEPT_UNTRUSTED` to take any.
 * @returns The listener.
 */
function envoyListener(name: string, port: number, trustChainVerification: 'VERIFY_TRUST_CHAIN' | 'ACCEPT_UNTRUSTED'): Record<string, unknown> {
    const tls: Record<string, unknown> = {
        name: 'envoy.transport_sockets.tls',
        typed_config: {
            '@type': 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext',
            // asked for, not required, so the users that log in get through without one
            require_client_certificate: false,
            common_tls_context: {
                tls_certificates: [
                    {
                        certificate_chain: { filename: `${CERTIFICATES}/proxy.crt` },
                        private_key: { filename: `${CERTIFICATES}/proxy.key` }
                    }
                ],
                validation_context: {
                    trusted_ca: { filename: `${CERTIFICATES}/clients.crt` },
                    trust_chain_verification: trustChainVerification
                }
            }
        }
    };
    const http: Record<string, unknown> = {
        name: 'envoy.filters.network.http_connection_manager',
        typed_config: {
            '@type': 'type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager',
            stat_prefix: name,
            // the header the client sent is dropped, and set anew when it showed a certificate. The
            // subject comes after the certificate in the element and holds a comma
            forward_client_cert_details: 'SANITIZE_SET',
            set_current_client_cert_details: { cert: true, subject: true, uri: true },
            route_config: {
                virtual_hosts: [{ name: 'application', domains: ['*'], routes: [{ match: { prefix: '/' }, route: { cluster: 'application' } }] }]
            },
            http_filters: [
                {
                    name: 'envoy.filters.http.router',
                    typed_config: { '@type': 'type.googleapis.com/envoy.extensions.filters.http.router.v3.Router' }
                }
            ]
        }
    };
    return {
        name,
        address: { socket_address: { address: '0.0.0.0', port_value: port } },
        filter_chains: [{ transport_socket: tls, filters: [http] }]
    };
}

/**
 * The configuration of Envoy: both ports end TLS and forward the client certificate to the
 * application, one checking who issued it and one not.
 * @param applicationPort - The port the application listens on, on this machine.
 * @returns The configuration, as JSON, which Envoy reads as the YAML it is too.
 */
function envoyConfiguration(applicationPort: number): string {
    const address: Record<string, unknown> = { socket_address: { address: 'host.testcontainers.internal', port_value: applicationPort } };
    const application: Record<string, unknown> = {
        name: 'application',
        type: 'LOGICAL_DNS',
        dns_lookup_family: 'V4_ONLY',
        // the system's resolver, which reads /etc/hosts, where testcontainers names this machine
        typed_dns_resolver_config: {
            name: 'envoy.network.dns_resolver.getaddrinfo',
            typed_config: {
                '@type': 'type.googleapis.com/envoy.extensions.network.dns_resolver.getaddrinfo.v3.GetAddrInfoDnsResolverConfig'
            }
        },
        load_assignment: {
            cluster_name: 'application',
            endpoints: [{ lb_endpoints: [{ endpoint: { address } }] }]
        }
    };
    return JsonUtilities.stringify({
        static_resources: {
            listeners: [
                envoyListener('verifying', VERIFYING_PORT, 'VERIFY_TRUST_CHAIN'),
                envoyListener('any-certificate', ANY_CERTIFICATE_PORT, 'ACCEPT_UNTRUSTED')
            ],
            clusters: [application]
        }
    });
}

describeBehindProxy('Envoy', {
    header: 'x-forwarded-client-cert',
    headerFormat: 'xfcc',
    forgeHeaderValue: certificate => `By=spiffe://forged/api;Cert="${encodeURIComponent(certificate)}"`,
    start: async ({ applicationPort, proxyKeyPair, authority }: ClientCertificateProxyStartOptions): Promise<StartedClientCertificateProxy> => {
        const envoy: StartedTestContainer = await new GenericContainer(ENVOY_TEST_IMAGE)
            .withCopyContentToContainer([
                { content: envoyConfiguration(applicationPort), target: '/etc/envoy/envoy.yaml' },
                { content: proxyKeyPair.certificate, target: `${CERTIFICATES}/proxy.crt` },
                { content: proxyKeyPair.privateKey, target: `${CERTIFICATES}/proxy.key` },
                { content: authority.certificate, target: `${CERTIFICATES}/clients.crt` }
            ])
            .withExposedPorts(VERIFYING_PORT, ANY_CERTIFICATE_PORT)
            // once the clusters are resolved and the listeners take connections
            .withWaitStrategy(Wait.forLogMessage(/starting main dispatch loop/))
            .start();
        return {
            host: envoy.getHost(),
            verifyingPort: envoy.getMappedPort(VERIFYING_PORT),
            anyCertificatePort: envoy.getMappedPort(ANY_CERTIFICATE_PORT),
            stop: async () => {
                await envoy.stop();
            }
        };
    }
});