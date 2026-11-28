import { resolveTxt } from 'node:dns/promises';

import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ServiceUnavailableError } from '../../../error-handling/errors/service-unavailable.error';
import { $ts } from '../../../localization/translate.function';
import { AnalyticsDnsServiceInterface } from './analytics-dns-service.interface';

/**
 * The answers of the resolver that mean the domain has no TXT record: none of that type, or no such domain.
 */
const NO_RECORDS_CODES: ReadonlySet<string> = new Set(['ENODATA', 'ENOTFOUND']);

/**
 * Default DNS service of the analytics plugin, asking the resolver of the system. It sends no request to the site.
 */
@Injectable({ register: 'onUse' })
export class AnalyticsDnsService implements AnalyticsDnsServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveTxtRecords(domain: string): Promise<string[]> {
        try {
            // a TXT record holds its value in strings of 255 characters at most, which together are the value
            return (await resolveTxt(domain)).map(strings => strings.join(''));
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && typeof error.code === 'string' && NO_RECORDS_CODES.has(error.code)) {
                return [];
            }
            // a resolver that failed says nothing about the record, which may well be there
            throw new ServiceUnavailableError($ts`The DNS records of '${domain}' could not be read. Try again later.`, { cause: error });
        }
    }
}