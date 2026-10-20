import { ClientCertificateHeaderFormat } from './client-certificate-header-format.type.ts';

/**
 * Reads the client certificate out of the header a proxy forwards it in.
 */
export abstract class ClientCertificateHeaderUtilities {
    /**
     * Finds the client certificate in the value of the header a proxy forwards it in.
     * @param value - The value of the header.
     * @param format - How the proxy writes the certificate.
     * @returns The certificate as PEM or DER, which `X509Certificate` reads either way, or undefined
     * when the value carries none. Whether it is a certificate at all is only known once it is read.
     */
    static findEncodedCertificate(value: string, format: ClientCertificateHeaderFormat): Buffer | undefined {
        switch (format) {
            case 'rfc9440': {
                // a byte sequence of structured field values (RFC 8941, 3.3.5)
                const base64: string | undefined = /^:([\d+/=A-Za-z]+):$/.exec(value.trim())?.[1];
                return base64 == undefined ? undefined : Buffer.from(base64, 'base64');
            }
            case 'url-encoded-pem': {
                const pem: string | undefined = this.findUrlDecoded(value.trim());
                return pem ? Buffer.from(pem) : undefined;
            }
            case 'xfcc': {
                const pem: string | undefined = this.findXfccCertificate(value);
                return pem ? Buffer.from(pem) : undefined;
            }
            case 'traefik': {
                // the client's certificate first, then the rest of the chain it sent
                const base64: string | undefined = this.findUrlDecoded(value.trim())?.split(',')[0]?.trim();
                return base64 ? Buffer.from(base64, 'base64') : undefined;
            }
        }
    }

    /**
     * Finds the certificate in an `x-forwarded-client-cert` header: the one of the last element, which
     * the nearest proxy wrote. Every proxy before it appends an element of its own, so an earlier one
     * describes a hop further away.
     * @param value - The value of the header.
     * @returns The certificate as PEM, or undefined when the last element carries none.
     */
    private static findXfccCertificate(value: string): string | undefined {
        const element: string | undefined = this.splitOutsideQuotes(value, ',').at(-1);
        if (element == undefined) {
            return undefined;
        }
        for (const pair of this.splitOutsideQuotes(element, ';')) {
            const separator: number = pair.indexOf('=');
            const key: string = pair.slice(0, separator).trim();
            if (separator === -1 || key.toLowerCase() !== 'cert') {
                continue;
            }
            const quoted: string = pair.slice(separator + 1).trim();
            const unquoted: string = quoted.startsWith('"') && quoted.endsWith('"') && quoted.length > 1
                ? quoted.slice(1, -1).replaceAll(String.raw`\"`, '"')
                : quoted;
            return this.findUrlDecoded(unquoted);
        }
        return undefined;
    }

    /**
     * Splits a value at a separator that is not inside double quotes, where a backslash escapes the
     * next character.
     * @param value - The value to split.
     * @param separator - The character to split at.
     * @returns The parts, quotes and escapes left as they are.
     */
    private static splitOutsideQuotes(value: string, separator: string): string[] {
        const parts: string[] = [];
        let current: string = '';
        let quoted: boolean = false;
        for (let i: number = 0; i < value.length; i++) {
            const char: string = value.charAt(i);
            if (quoted && char === '\\') {
                current += char + value.charAt(i + 1);
                i++;
                continue;
            }
            if (char === '"') {
                quoted = !quoted;
            }
            if (!quoted && char === separator) {
                parts.push(current);
                current = '';
                continue;
            }
            current += char;
        }
        parts.push(current);
        return parts;
    }

    /**
     * Decodes a URL encoded value.
     * @param value - The value to decode.
     * @returns The decoded value, or undefined when it is not URL encoded.
     */
    private static findUrlDecoded(value: string): string | undefined {
        try {
            return decodeURIComponent(value);
        }
        catch {
            return undefined;
        }
    }
}