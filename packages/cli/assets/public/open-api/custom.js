// Adds the logo and the name of the application to the explorer, and the permission each route
// requires to its summary.
(function() {
    const config = JSON.parse(document.getElementById('zibri-explorer-config').textContent);

    function injectLogo(topbar) {
        if (topbar.querySelector('#zibri-openapi-logo')) {
            return;
        }
        const a = document.createElement('a');
        a.id = 'zibri-openapi-logo';
        a.href = '/';

        const img = document.createElement('img');
        img.src = config.logoSrc;
        img.height = 100;
        img.width = 100;

        a.appendChild(img);
        a.append(config.appName);
        topbar.insertBefore(a, topbar.firstChild);
    }

    function observe() {
        const topbar = document.querySelector('.information-container');
        if (!topbar) {
            setTimeout(observe, 50);
            return;
        }
        injectLogo(topbar);
        new MutationObserver(() => {
            const t = document.querySelector('.information-container');
            if (t) {
                injectLogo(t);
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    observe();
})();

(function() {
    let isInjecting = false;

    function injectPermissions() {
        if (isInjecting) return;
        if (!window.ui || typeof window.ui.specSelectors !== 'object') return;

        const spec = window.ui.specSelectors.specJson().toJS
            ? window.ui.specSelectors.specJson().toJS()
            : window.ui.specSelectors.specJson();

        if (!spec || !spec.paths) return;

        isInjecting = true;
        try {
            const normalizeMethod = (m) => String(m).toLowerCase();

            const opBlocks = document.querySelectorAll('.opblock');
            opBlocks.forEach((op) => {
                try {
                    const methodEl = op.querySelector('.opblock-summary-method');
                    const pathEl = op.querySelector('.opblock-summary-path');
                    if (!methodEl || !pathEl) return;

                    const method = normalizeMethod(methodEl.textContent.trim());
                    const path = pathEl.textContent.trim();

                    const pathObj = spec.paths[path];
                    if (!pathObj) return;

                    const operationObj = pathObj[method];
                    if (!operationObj) return;

                    const permissions = [
                        operationObj['x-permission'],
                        operationObj['x-platform-permission']
                    ].filter((p) => typeof p === 'string');
                    if (permissions.length === 0) return;

                    if (op.querySelector('.zibri-permissions-container')) return;

                    const container = document.createElement('div');
                    container.className = 'zibri-permissions-container';
                    container.setAttribute('aria-hidden', 'true');

                    permissions.forEach((r) => {
                        const badge = document.createElement('span');
                        badge.className = 'zibri-permission-badge';
                        badge.textContent = String(r);
                        container.appendChild(badge);
                    });

                    const summary = op.querySelector('.opblock-summary-path-description-wrapper');
                    if (summary) summary.appendChild(container);
                } catch (e) {
                    console.warn('zibri openapi permission injection failed', e);
                }
            });
        } finally {
            isInjecting = false;
        }
    }

    function waitForSwaggerAndObserve() {
        if (!window.ui || typeof window.ui.specSelectors !== 'object') {
            return setTimeout(waitForSwaggerAndObserve, 50);
        }

        const spec = window.ui.specSelectors.specJson().toJS
            ? window.ui.specSelectors.specJson().toJS()
            : window.ui.specSelectors.specJson();

        if (!spec || !spec.paths) {
            return setTimeout(waitForSwaggerAndObserve, 50);
        }

        // Initial injection
        injectPermissions();

        // Watch for version switches / re-renders
        const swaggerContainer = document.getElementById('swagger-ui');
        if (!swaggerContainer) return;

        let debounceTimer;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                injectPermissions();
            }, 200);
        });

        observer.observe(swaggerContainer, { childList: true, subtree: true });
    }

    waitForSwaggerAndObserve();
})();
