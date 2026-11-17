/**
 * Name of the second parameter every generated setup function takes: the render-time data for that
 * one instance (`{ handlers, props, refs, states, bindings }`), kept apart from the component's own props.
 */
export const SETUP_RUNTIME_PARAM: string = '__ssr';

/**
 * The client-side bootstrap that reattaches event handlers to server-rendered elements. It joins
 * the build-time `__handlers` table (site id → event + factory) with the handler entries this
 * instance was rendered with (instance id → site id + captured values) and calls `addEventListener`
 * for each element stamped with the entry. The stamped elements come from the one pass over the
 * document the page makes before any setup runs (`__zibriStamps`). Emitted verbatim into the generated
 * client script.
 *
 * The entries are per instance, not global: the setup of a component rendered several times runs
 * once per instance, so a shared registry would make every run attach every element - duplicating
 * listeners and, since site ids are allocated per component, attaching handlers across components whose
 * ids collide. A throw is reported by the setup's own wrapper, like any other throw in a setup.
 */
export const REATTACH_RUNTIME: string = `(function () {
    var registry = (${SETUP_RUNTIME_PARAM} && ${SETUP_RUNTIME_PARAM}.handlers) || [];
    for (var i = 0; i < registry.length; i++) {
        var entry = registry[i];
        var def = __handlers[entry.site];
        var stamped = __zibriCurrent.stamps.get(entry.id) || [];
        if (!def) { continue; }
        for (var s = 0; s < stamped.length; s++) {
            stamped[s].element.addEventListener(stamped[s].event || def.event, def.make.apply(null, entry.captured || []));
        }
    }
})();`;

/**
 * The client-side bootstrap that hands the page the bindings of this instance: for each binding entry it was
 * rendered with, the kind of its site, the attribute it writes and the function computing it, made with the values
 * the entry captured. The page runs them again whenever a state changes (`__zibriBind`). Emitted verbatim into the
 * generated client script, per instance like {@link REATTACH_RUNTIME}. A value handed to a component writes where the
 * component forwards it, which the entry says. A state itself on the `value` or `checked` of a control is written back
 * when the user changes it.
 */
export const BIND_RUNTIME: string = `(function () {
    var entries = (${SETUP_RUNTIME_PARAM} && ${SETUP_RUNTIME_PARAM}.bindings) || [];
    for (var i = 0; i < entries.length; i++) {
        var def = __bindingSites[entries[i].site];
        if (!def) { continue; }
        var attribute = entries[i].attribute || def.attribute;
        __zibriBind(entries[i].id, entries[i].kind || def.kind, attribute, def.make.apply(null, entries[i].captured || []));
        if (def.write && (attribute === 'value' || attribute === 'checked')) {
            __zibriWriteBack(entries[i].id, attribute, def.write.apply(null, entries[i].captured || []));
        }
    }
})();`;