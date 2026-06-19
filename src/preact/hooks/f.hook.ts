/**
 * The js string content for a $f variant that works standalone and inside tsx components.
 */
export const $fHookCode: string = `const $f = (function() {
    var __opts = 'LOCALE_FORMAT_OPTIONS_PLACEHOLDER';
    function __fmt(d, fmt) {
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var h = d.getHours(), h12 = h % 12 || 12;
        return fmt.replace(/YYYY|YY|MM|DD|HH|hh|h|mm|ss|A|a/g, function(t) {
            return ({
                YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(-2),
                MM: pad(d.getMonth() + 1), DD: pad(d.getDate()),
                HH: pad(h), hh: pad(h12), h: h12,
                mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
                A: h < 12 ? 'AM' : 'PM', a: h < 12 ? 'am' : 'pm'
            })[t] ?? t;
        });
    }
    return {
        date: function(d) { return __fmt(new Date(d), __opts.dateFormat); },
        time: function(d) { return __fmt(new Date(d), __opts.timeFormat); },
        dateTime: function(d) { return __fmt(new Date(d), __opts.dateTimeFormat); },
        price: function(amount, currency) {
            return Number(amount).toLocaleString(__opts.locale, { style: 'currency', currency: currency || __opts.currencyCode });
        },
        percent: function(value) {
            return value.toLocaleString(__opts.locale, { style: 'percent' });
        }
    };
})();`;