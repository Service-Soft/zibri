/**
 * How a proxy writes the client certificate into the header it forwards.
 *
 * - `rfc9440`: the certificate as an RFC 9440 byte sequence, `:<base64 DER>:` (HAProxy, Caddy, or any
 * proxy that follows the standard).
 * - `url-encoded-pem`: the certificate as URL encoded PEM (`$ssl_client_escaped_cert` of nginx,
 * `X-Amzn-Mtls-Clientcert` of the AWS Application Load Balancer).
 * - `xfcc`: Envoy's `x-forwarded-client-cert`, which Istio forwards too. The certificate of the last
 * element, which the nearest proxy wrote, and which carries one only when Envoy is set to forward it.
 * - `traefik`: Traefik's `X-Forwarded-Tls-Client-Cert`, URL encoded base64 DER, the client's
 * certificate first.
 */
export type ClientCertificateHeaderFormat = 'rfc9440' | 'url-encoded-pem' | 'xfcc' | 'traefik';