import { beforeAll, describe, expect, it } from '@jest/globals';

import { Parser } from './parser';
import { initDiContainer } from '../di/init-di-container.function';
import { HeaderParamMetadata, QueryParamMetadata } from '../routing/decorators/param.decorator';
import { createHeaderParamMetadata, createQueryParamMetadata } from '../routing/param-metdata.helpers';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';

describe('parsing an array parameter', () => {
    let parser: Parser;

    beforeAll(() => {
        initDiContainer();
        parser = new Parser();
    });

    it('restores every item of an array query parameter as the item it declares', () => {
        // handed the array metadata rather than its items, every item was read as a list of its own
        // and came back as the text it arrived as
        const metadata: QueryParamMetadata = createQueryParamMetadata('days', { type: 'array', items: { type: 'date' } });
        const request: WebsocketRequest = new WebsocketRequest();
        request.query = { days: '["2026-03-01T10:00:00.000Z"]' };

        expect(parser.parseQueryParam(request, metadata)).toEqual([new Date('2026-03-01T10:00:00.000Z')]);
    });

    it('restores every item of an array header parameter as the item it declares', () => {
        const metadata: HeaderParamMetadata = createHeaderParamMetadata('x-days', { type: 'array', items: { type: 'date' } });
        const request: WebsocketRequest = new WebsocketRequest();
        request.headers = { 'x-days': '["2026-03-01T10:00:00.000Z"]' };

        expect(parser.parseHeaderParam(request, metadata)).toEqual([new Date('2026-03-01T10:00:00.000Z')]);
    });
});