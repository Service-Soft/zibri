import { Header } from './header.type';

/**
 * Finds a header of a request by its name, however the name is spelled.
 *
 * Node hands every header name over lowercased, and socket.io's handshake the same, so a name looked
 * up as it is usually written, such as `User-Agent` or `X-Version`, was never found.
 * @param headers - The headers of the request.
 * @param name - The name of the header, in any spelling.
 * @returns Its value, or undefined when the request carries none.
 */
export function findHeader<V>(headers: Partial<Record<Header, V>> | undefined, name: Header): V | undefined {
    return headers?.[name.toLowerCase()];
}