import { describe, expect, it } from '@jest/globals';

import { NetworkAddressUtilities } from './network-address.utilities';

describe('NetworkAddressUtilities', () => {
    it('tells a public address from one of this machine, a private network or what translates to one', () => {
        for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
            expect(NetworkAddressUtilities.isPublic(address)).toBe(true);
        }
        for (const address of [
            '127.0.0.1',
            '10.1.2.3',
            '172.16.0.1',
            '192.168.1.1',
            '169.254.169.254',
            '100.64.0.1',
            '0.0.0.0',
            '224.0.0.1',
            '::1',
            '::',
            'fe80::1',
            'fd00::1',
            '::ffff:127.0.0.1',
            '::FFFF:10.0.0.1',
            '64:ff9b::a00:1',
            'not an address',
            // ipv4-compatible, which names the ipv4 address inside it, and site-local, both deprecated
            '::10.0.0.5',
            '::a00:5',
            '::8.8.8.8',
            'fec0::1',
            // eslint-disable-next-line cspell/spellchecker
            'feff::1'
        ]) {
            expect(NetworkAddressUtilities.isPublic(address)).toBe(false);
        }
    });

    // 6to4 passed unchecked, which a host with a 6to4 interface sends to the ipv4 address inside it, a private one
    // included. NAT64 was refused whole, which on a deployment reaching ipv4 only through it refused every
    // endpoint of a tenant
    it('takes an ipv6 address carrying an ipv4 one for as public as the ipv4 one, and refuses teredo', () => {
        for (const address of [
            '2002:808:808::1',
            '2002:0808:0808:1::',
            '64:ff9b::808:808',
            '64:ff9b::8.8.8.8',
            '::ffff:8.8.8.8',
            '::ffff:808:808',
            '0:0:0:0:0:ffff:808:808'
        ]) {
            expect([address, NetworkAddressUtilities.isPublic(address)]).toEqual([address, true]);
        }
        for (const address of [
            '2002:a00:5::',
            '2002:7f00:1::1',
            '2002:a9fe:a9fe::',
            '2002:c0a8:101:1::1',
            '64:ff9b::127.0.0.1',
            '64:ff9b::a9fe:a9fe',
            '::ffff:a00:5',
            '0:0:0:0:0:ffff:7f00:1',
            '2002:a00:5::%eth0',
            // teredo, and translation for local use, where each network chooses where the ipv4 address goes
            '2001:0:4136:e378:8000:63bf:3fff:fdd2',
            '64:ff9b:1::808:808'
        ]) {
            expect([address, NetworkAddressUtilities.isPublic(address)]).toEqual([address, false]);
        }
    });

    it('refuses a host that leads inside, or that is not among the allowed ones', async () => {
        await expect(NetworkAddressUtilities.resolvePublicAddress('169.254.169.254', undefined)).rejects.toThrow('public addresses only');
        await expect(NetworkAddressUtilities.resolvePublicAddress('[::1]', undefined)).rejects.toThrow('public addresses only');
        // resolved without a lookup over the network: localhost is answered by the machine itself
        await expect(NetworkAddressUtilities.resolvePublicAddress('localhost', undefined)).rejects.toThrow('public addresses only');
        await expect(NetworkAddressUtilities.resolvePublicAddress('8.8.8.8', ['backups.example.com'])).rejects.toThrow('needs to be one of');
        await expect(NetworkAddressUtilities.resolvePublicAddress('8.8.8.8', undefined)).resolves.toBe('8.8.8.8');
    });
});