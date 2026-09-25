# The build needs the dev dependencies, the sources and the toolchain. What runs needs none
# of them, so they stay in a stage that is thrown away and only the second one is shipped.
FROM node:24-slim AS build
WORKDIR /app

# the manifests first, so that the install layer is reused for every build that does not
# change a dependency
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# what running needs, out of what building needed. Pruning here rather than installing a
# second time in the stage below keeps one resolution of the dependency tree, so what the
# application runs against is what its bundle was built against.
RUN npm prune --omit=dev

FROM node:24-slim AS runtime
WORKDIR /app

# read by the framework and by anything it depends on. It is what turns off the machinery a
# development machine wants and a deployment pays for
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules

# the bundle carries everything read from inside it: the assets, the compiled templates and
# the translations. "versions" is the one thing read from beside it, because the application
# writes to it and the next release is checked against what this one recorded. An image
# without it does not start, which is the point: an application that quietly treated the
# version it is on as the first one that ever existed would drop every guarantee it gives.
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node versions ./versions

# the two paths written while the application runs, owned by the user that runs it. Nothing
# else under /app is, so the rest of the image stays read only to the process using it.
RUN mkdir -p /app/.zibri && chown -R node:node /app/.zibri

USER node

# what the application listens on by default. It reads PORT, so a deployment that publishes
# a different one sets that too
EXPOSE 3000

# the liveness half of the health controller: whether the process is up, which is what a
# restart should depend on. Readiness is the orchestrator's to poll, at /health/ready.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD \
    node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# the exec form rather than a shell, so that the signal a stop sends arrives at node itself
# and the application shuts down in the orderly way it knows how to
CMD ["node", "dist/bundle.js"]