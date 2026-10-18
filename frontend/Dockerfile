# Node builds the bundle and then stays behind: the runtime image is nginx
# and static files, nothing else.
#
# $BUILDPLATFORM pins this stage to the machine doing the building. The output
# is JavaScript and CSS — no architecture in it — so cross-building for arm64
# emulates only the nginx stage instead of the whole npm install.
#
# Both bases are pinned by digest as well as tag, so a rebuild of the same
# commit gets the same image. Dependabot moves the digests.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time, so these are build args rather than
# runtime environment: the API path is baked into the bundle. The page's CSP
# (nginx.conf.template) allows calls to its own origin only, so an API on
# another one needs a connect-src there as well.
ARG VITE_API_BASE_URL=/api
ARG VITE_API_DOCS_URL=/docs
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_DOCS_URL=$VITE_API_DOCS_URL

RUN npm run build


# A branch upstream still maintains, and so still rebuilds. The tag of one
# that has ended, like the 1.27 this used to be, is never patched again.
FROM nginx:1.30-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94

# Substituted into the config by the base image's entrypoint on start, so the
# same image serves compose and every cluster. The filter keeps envsubst to
# that one variable, so nothing else in the environment can land in the
# config.
ENV BACKEND_ORIGIN=http://api:8000 \
    NGINX_ENVSUBST_FILTER=^BACKEND_ORIGIN$

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html

# Port 8080 and the nginx uid: serving static files needs no root. The
# entrypoint renders the template into conf.d, and nginx writes its pid to
# /run — which is what /var/run points at, so chown the real path.
#
# COPY keeps the template's mode from the build machine, where a checkout
# under umask 077 makes it 600, root's alone, and the entrypoint runs as
# nginx. Not COPY --chmod: BuildKit gives that mode to the directory it
# creates as well, and a 644 directory cannot be entered. The bundle needs
# neither, since Vite writes it afresh.
RUN chmod 644 /etc/nginx/templates/default.conf.template \
 && chown -R 101:101 /var/cache/nginx /run /etc/nginx/conf.d
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
