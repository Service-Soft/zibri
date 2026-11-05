// Opens swagger-ui on the documents the page names, the latest version first.
window.onload = function() {
    const config = JSON.parse(document.getElementById('zibri-explorer-config').textContent);
    window.ui = SwaggerUIBundle({
        urls: config.urls,
        'urls.primaryName': config.primaryName,
        dom_id: '#swagger-ui',
        presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
        ],
        layout: 'StandaloneLayout',
        requestInterceptor: (req) => {
            req.headers.Accept = 'application/json';
            req.headers['content-type'] = 'application/json';
            return req;
        },
        defaultModelRendering: 'model',
        persistAuthorization: true
    });
};
