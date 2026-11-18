{
    "name": "{{name}}",
    "version": "1.0.0",
    "main": "./dist/bundle.js",
    "scripts": {
        "start": "webpack --watch",
        "build": "webpack",
        "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js",
        "migrate:list": "node dist/bundle.js migrate list",
        "migrate:down": "node dist/bundle.js migrate down",
        "reset-admin": "node dist/bundle.js reset-admin",
        "end-every-login": "node dist/bundle.js end-every-login"
    },
{{! the rest of what "npm init" writes, in the order it writes it. npm warns about every one of these
    a package.json leaves out, and "description" is read by anything that lists the project - so they
    belong in the file even while they are still empty }}
    "keywords": ["zibri"],
    "author": {{author}},
    "license": "MIT",
    "description": "",
{{! jest's coverage asks, through every babel-plugin-istanbul 8, for test-exclude 7, whose glob npm
    calls deprecated on every install. test-exclude 8 is the same code on a glob without the warning.
    TODO: remove once a babel-plugin-istanbul depends on test-exclude 8 }}
{{! jest asks for glob 13, and test-exclude for minimatch 10, which have an advisory each npm audit reports on every
    install: GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249. glob 14.0.2, which brings minimatch 11 itself, and
    minimatch 11.0.1 are the releases that fixed them. Only there: minimatch 11 dropped makeRe, which other packages,
    such as eslint's plugins, call.
    TODO: remove once a jest depends on glob 14.0.2, and a test-exclude on minimatch 11.0.1 }}
    "overrides": {
        "glob@^13.0.0": "^14.0.2",
        "test-exclude": {
            ".": "^8.0.0",
            "minimatch": "^11.0.1"
        }
    },
{{! what npm may run of the install scripts of the dependencies, as it warns about every one it was not told of.
    The script of @parcel/watcher, which jest watches files through, builds only when told to build from source, and
    its prebuilt module is installed. By name, so that an update does not need a new entry }}
    "allowScripts": {
        "@parcel/watcher": false
    }
}
