import { InternalError } from '../error-handling/internal-error.model';
import { Ms } from '../utilities/ms';
import { ICalendarEvent } from './i-calendar-event.model';

/**
 * Who wrote a file, as its `PRODID` names it.
 */
const PRODUCT_ID: string = '-//Zibri//Zibri//EN';

/**
 * The most octets a line holds, its line break left out (RFC 5545, section 3.1).
 */
const MAX_LINE_OCTETS: number = 75;

/**
 * The characters a text value cannot hold, the control characters but the tab (RFC 5545, section 3.3.11).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS: RegExp = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * Writes iCalendar files (RFC 5545), such as an event a CalDAV server stores, or a file to download into a
 * calendar app.
 */
export abstract class ICalendarUtilities {
    /**
     * Writes a calendar holding one event: its text escaped, its lines folded at 75 octets and ended by CRLF, its
     * times in UTC. An event of a whole day ends on the next day, and one at a moment takes no time. The event is
     * transparent, so that it leaves the free and busy times of the calendar as they are.
     * @param event - The event.
     * @returns The file, as text.
     * @throws {InternalError} When the url of the event is no absolute url.
     */
    static writeEvent(event: ICalendarEvent): string {
        const lines: string[] = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            `PRODID:${PRODUCT_ID}`,
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:${this.escapeText(event.uid)}`,
            `DTSTAMP:${this.formatDateTime(event.stampedAt)}`,
            ...event.allDay
                ? [
                    `DTSTART;VALUE=DATE:${this.formatDate(event.start)}`,
                    // the end of a day is the start of the next, as an end is not part of the event
                    `DTEND;VALUE=DATE:${this.formatDate(new Date(event.start.getTime() + Ms.DAY))}`
                ]
                // without an end: the event ends where it starts (RFC 5545, section 3.6.1)
                : [`DTSTART:${this.formatDateTime(event.start)}`],
            `SUMMARY:${this.escapeText(event.summary)}`,
            ...event.description == undefined ? [] : [`DESCRIPTION:${this.escapeText(event.description)}`],
            ...event.url == undefined ? [] : [`URL:${this.resolveUri(event.url)}`],
            // a deadline takes no time of whoever it is in the calendar of
            'TRANSP:TRANSPARENT',
            'END:VEVENT',
            'END:VCALENDAR'
        ];
        return lines.map(line => `${this.foldLine(line)}\r\n`).join('');
    }

    /**
     * Escapes a text value of a property: a backslash, a semicolon and a comma behind a backslash, a line break as
     * `\n`, and without the control characters but the tab, which a text value cannot hold.
     * @param text - The text.
     * @returns It, as a value of a property.
     */
    static escapeText(text: string): string {
        // the line breaks first, as a carriage return is one of the control characters
        return text
            .replaceAll(/\r\n|\r/g, '\n')
            .replaceAll(CONTROL_CHARACTERS, '')
            .replaceAll('\\', '\\\\')
            .replaceAll(';', '\\;')
            .replaceAll(',', '\\,')
            .replaceAll('\n', '\\n');
    }

    /**
     * Folds a line into lines of at most 75 octets, each after the first starting with a space, without splitting
     * the octets of a character.
     * @param line - The line, without its line break.
     * @returns The folded line, its lines separated by CRLF.
     */
    static foldLine(line: string): string {
        const lines: string[] = [];
        let current: string = '';
        let octets: number = 0;
        // by code point, so that neither a character of several octets nor a surrogate pair is split
        for (const character of line) {
            const size: number = Buffer.byteLength(character, 'utf8');
            if (octets + size > MAX_LINE_OCTETS) {
                lines.push(current);
                // the space a line after the first starts with counts towards its octets
                current = ' ';
                octets = 1;
            }
            current += character;
            octets += size;
        }
        lines.push(current);
        return lines.join('\r\n');
    }

    /**
     * Formats a moment as a date with a time in UTC, such as `20260731T090000Z`.
     * @param date - The moment.
     * @returns It, to the second.
     */
    private static formatDateTime(date: Date): string {
        return date.toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }

    /**
     * Formats the day of a moment in UTC, such as `20260731`.
     * @param date - The moment.
     * @returns Its day.
     */
    private static formatDate(date: Date): string {
        return date.toISOString().slice(0, 10).replaceAll('-', '');
    }

    /**
     * Resolves a url as the value of a property of the type URI, which is written as it is.
     * @param url - The url.
     * @returns It, encoded where a url needs it, so that it holds no line break.
     * @throws {InternalError} When it is no absolute url.
     */
    private static resolveUri(url: string): string {
        try {
            return new URL(url).href;
        }
        catch (error) {
            throw new InternalError(`The url of a calendar event needs to be an absolute url, and is "${url}".`, { cause: error });
        }
    }
}
