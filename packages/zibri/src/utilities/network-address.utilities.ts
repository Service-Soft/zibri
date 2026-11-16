import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { InternalError } from '../error-handling/internal-error.model';

/**
 * Where an address leads that a request on behalf of somebody else may not reach: this machine, the
 * networks it sits in, and what they translate to.
 */
const NOT_PUBLIC: BlockList = new BlockList();

// this network, private, shared address space of carriers, loopback, link-local, protocol assignments,
// documentation, benchmarking, multicast and reserved
const NOT_PUBLIC_IPV4: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
];

// unspecified, loopback and ipv4-compatible (::/96 holds all three), translated to ipv4 for local use, discard,
// teredo, documentation, unique local, link-local, site-local, multicast. Compatible and site-local are
// deprecated, with no public use left, and a compatible one names an ipv4 address inside it, such as ::10.0.0.5.
// Teredo carries the address it leads to obfuscated, and has no use left either. Local use translation puts
// the ipv4 address where each network chooses, so it cannot be read out
const NOT_PUBLIC_IPV6: [string, number][] = [
    ['::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 32],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8]
];

for (const [network, prefix] of NOT_PUBLIC_IPV4) {
    NOT_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of NOT_PUBLIC_IPV6) {
    NOT_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

/**
 * How many 16 bit groups an ipv6 address has.
 */
const IPV6_GROUP_COUNT: number = 8;

/**
 * Checks the hosts a request goes to on somebody else's behalf, such as an endpoint a tenant configured, so
 * that it never reaches this machine or the networks behind it.
 */
export abstract class NetworkAddressUtilities {
    /**
     * Resolves a host to an address a request may go to on somebody else's behalf: one that every address
     * of the host is public, so that the next lookup of a name leading partly inside cannot pick the inside.
     * @param host - The host name or address.
     * @param allowedHosts - The hosts it has to be, or be below, or undefined for any public one.
     * @returns The first address of the host.
     * @throws When the host is not allowed, resolves to nothing, or to an address that is not public.
     */
    static async resolvePublicAddress(host: string, allowedHosts: string[] | undefined): Promise<string> {
        this.validateAllowedHost(host, allowedHosts);
        const name: string = host.replace(/^\[(.*)]$/, '$1');
        const addresses: string[] = isIP(name) ? [name] : (await lookup(name, { all: true, verbatim: true })).map(a => a.address);
        const inside: string | undefined = addresses.find(address => !this.isPublic(address));
        if (inside != undefined || !addresses.length) {
            throw new InternalError(
                `The host "${host}" needs to lead to public addresses only, and leads to ${inside ?? 'none'}.`
            );
        }
        return addresses[0] ?? name;
    }

    /**
     * Whether an address is public: none of this machine, of a private or link-local network, of multicast,
     * reserved, or translated into one of those. An ipv6 address carrying an ipv4 one, mapped, translated or
     * tunnelled through 6to4, is as public as the ipv4 address it carries.
     * @param address - The address, ipv4 or ipv6.
     * @returns Whether it is.
     */
    static isPublic(address: string): boolean {
        const lowered: string = address.toLowerCase();
        const family: number = isIP(lowered);
        if (family === 0) {
            return false;
        }
        if (family === 6) {
            const carried: string | undefined = this.findCarriedIpv4(lowered);
            if (carried != undefined) {
                return this.isPublic(carried);
            }
        }
        return !NOT_PUBLIC.check(lowered, family === 4 ? 'ipv4' : 'ipv6');
    }

    /**
     * The ipv4 address an ipv6 one leads to: mapped (`::ffff:0:0/96`), translated by NAT64 at its well-known
     * prefix (`64:ff9b::/96`), or tunnelled through 6to4 (`2002::/16`).
     * @param address - The ipv6 address.
     * @returns The ipv4 address, or undefined when it carries none.
     */
    private static findCarriedIpv4(address: string): string | undefined {
        const groups: number[] = this.resolveIpv6Groups(address);
        // 6to4 carries it right after its prefix, and a host with a 6to4 interface sends the packet there
        // wrapped in ipv4, whatever network that address is in
        if (groups[0] === 0x2002) {
            return this.resolveIpv4(groups[1] ?? 0, groups[2] ?? 0);
        }
        const prefix: string = groups.slice(0, 6)
            .map(group => group.toString(16))
            .join(':');
        return prefix === '0:0:0:0:0:ffff' || prefix === '64:ff9b:0:0:0:0'
            ? this.resolveIpv4(groups[6] ?? 0, groups[7] ?? 0)
            : undefined;
    }

    /**
     * The eight 16 bit groups of an ipv6 address, with `::` filled in and a dotted ipv4 tail as two groups.
     * @param address - The address, which isIP took for ipv6.
     * @returns The groups.
     */
    private static resolveIpv6Groups(address: string): number[] {
        // a zone names the interface, which says nothing about where the address leads
        let text: string = address.replace(/%.*$/, '');
        const tail: string | undefined = /\d+\.\d+\.\d+\.\d+$/.exec(text)?.[0];
        const tailGroups: number[] = [];
        if (tail != undefined) {
            const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
            tailGroups.push((a << 8) | b, (c << 8) | d);
            text = text.slice(0, -tail.length);
            text = text.endsWith('::') ? text : text.slice(0, -1);
        }
        const parse: (part: string | undefined) => number[] = part => part ? part.split(':').map(group => Number.parseInt(group, 16)) : [];
        const [head, rest] = text.split('::');
        const headGroups: number[] = parse(head);
        const restGroups: number[] = parse(rest);
        const filled: number[] = rest == undefined
            ? []
            : Array.from({ length: IPV6_GROUP_COUNT - headGroups.length - restGroups.length - tailGroups.length }, () => 0);
        return [...headGroups, ...filled, ...restGroups, ...tailGroups];
    }

    private static resolveIpv4(high: number, low: number): string {
        return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    }

    /**
     * Validates that a host is one of the allowed ones, or below one of them.
     * @param host - The host.
     * @param allowedHosts - The hosts, or undefined to allow any.
     * @throws When it is not.
     */
    static validateAllowedHost(host: string, allowedHosts: string[] | undefined): void {
        if (allowedHosts == undefined) {
            return;
        }
        const lowered: string = host.toLowerCase();
        if (!allowedHosts.some(allowed => lowered === allowed.toLowerCase() || lowered.endsWith(`.${allowed.toLowerCase()}`))) {
            throw new InternalError(`The host "${host}" needs to be one of ${allowedHosts.join(', ')}, or below one of them.`);
        }
    }
}