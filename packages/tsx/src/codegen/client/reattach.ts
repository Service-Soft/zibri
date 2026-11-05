/**
 * Name of the second parameter every generated setup function takes: the render-time data for that
 * one instance (`{ handlers, props }`), kept apart from the component's own props.
 */
export const SETUP_RUNTIME_PARAM: string = '__ssr';

/**
 * The client-side bootstrap that reattaches event handlers to server-rendered elements. It joins
 * the build-time `__handlers` table (site id → event + factory) with the handler entries this
 * instance was rendered with (instance id → site id + captured values) and calls `addEventListener`
 * for each stamped element. Emitted verbatim into the generated client script.
 *
 * The entries are per instance, not global: the setup of a component rendered several times runs
 * once per instance and sees the whole document, so a shared registry would make every run attach
 * every element - duplicating listeners and, since site ids are allocated per component, attaching
 * handlers across components whose ids collide.
 */
export const REATTACH_RUNTIME: string = `(function () {
    try {
        var registry = (${SETUP_RUNTIME_PARAM} && ${SETUP_RUNTIME_PARAM}.handlers) || [];
        var byInstance = {};
        for (var i = 0; i < registry.length; i++) { byInstance[registry[i].id] = registry[i]; }
        var elements = document.querySelectorAll('[data-ssr-handlers]');
        for (var e = 0; e < elements.length; e++) {
            var el = elements[e];
            var raw = el.getAttribute('data-ssr-handlers');
            if (!raw) { continue; }
            var items = raw.split('|');
            for (var k = 0; k < items.length; k++) {
                var parts = items[k].split(':');
                var instanceId = parts[0];
                var eventName = parts[1];
                var entry = byInstance[instanceId];
                if (!entry) { continue; }
                var def = __handlers[entry.site];
                if (!def) { continue; }
                el.addEventListener(eventName || def.event, def.make.apply(null, entry.captured || []));
            }
        }
    } catch (error) {
        console.error('ssr handler reattach failed', error);
    }
})();`;