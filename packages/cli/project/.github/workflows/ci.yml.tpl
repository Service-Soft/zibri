# Installs, builds and tests this project on every pull request and every push to main.
name: CI
on:
    push:
        branches: [main]
    pull_request:

jobs:
    test:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v7
            - uses: actions/setup-node@v7
              with:
{{! the runtime the Dockerfile ships, so what is tested here is what is deployed }}
                node-version: '24'
                cache: npm
            - run: npm ci
            # ".env" is git ignored, so a checkout has none. This does what ".env.example" asks of
            # anyone on a new machine: copy it and fill each blank secret, here with values made for
            # this run alone
            - name: write the environment the tests run on
              run: |
                cp .env.example .env
                for key in {{secrets}}; do
                  sed -i "s/^$key=$/$key=$(openssl rand -hex 32)/" .env
                done
                sed -i "s/^ENVIRONMENT=$/ENVIRONMENT=development/" .env
            - run: npm run build
            - run: npm test
