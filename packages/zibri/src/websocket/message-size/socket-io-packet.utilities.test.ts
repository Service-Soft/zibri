import { describe, expect, it } from '@jest/globals';

import { SocketIoPacketPrefix, SocketIoPacketUtilities } from './socket-io-packet.utilities';

describe('SocketIoPacketUtilities.resolvePrefix', () => {

    it.each<[string, string, SocketIoPacketPrefix]>([
        ['an event', '42["chat:send",{"body":1}]', { complete: true, event: 'chat:send', attachments: 0 }],
        ['an event with an ack id', '4212["chat:send",{}]', { complete: true, event: 'chat:send', attachments: 0 }],
        ['an event in a namespace', '42/admin,["chat:send",{}]', { complete: true, event: 'chat:send', attachments: 0 }],
        ['an event in a namespace with an ack id', '42/admin,7["chat:send",{}]', { complete: true, event: 'chat:send', attachments: 0 }],
        ['a binary event', '452-["upload",{}]', { complete: true, event: 'upload', attachments: 2 }],
        ['an event name with an escaped quote', '42["say \\"hi\\"",{}]', { complete: true, event: 'say "hi"', attachments: 0 }],
        ['an event name with a unicode escape', '42["caf\\u00e9",{}]', { complete: true, event: 'café', attachments: 0 }],
        ['the event name alone', '42["chat:send"', { complete: true, event: 'chat:send', attachments: 0 }],
        ['a connect', '40', { complete: true, event: undefined, attachments: 0 }],
        ['an acknowledgement', '433["ok"]', { complete: true, event: undefined, attachments: 0 }],
        ['a binary acknowledgement', '461-3[{}]', { complete: true, event: undefined, attachments: 1 }],
        ['a ping', '2', { complete: true, event: undefined, attachments: 0 }],
        ['an event whose json is no array of a string', '42{"not":"an array"}', { complete: true, event: undefined, attachments: 0 }],
        ['a number where the event name should be', '42[42,{}]', { complete: true, event: undefined, attachments: 0 }]
    ])('reads %s', (_, prefix, expected) => {
        expect(SocketIoPacketUtilities.resolvePrefix(prefix)).toEqual(expected);
    });

    it.each<[string, string]>([
        ['nothing', ''],
        ['the engine type alone', '4'],
        ['the packet type alone', '42'],
        ['an unfinished attachment count', '45'],
        ['an unfinished namespace', '42/admin'],
        ['an opening bracket alone', '42['],
        ['an unfinished event name', '42["chat:se'],
        ['an event name ending in an escape', '42["chat\\']
    ])('waits for more when it has %s', (_, prefix) => {
        expect(SocketIoPacketUtilities.resolvePrefix(prefix)).toEqual({ complete: false });
    });
});