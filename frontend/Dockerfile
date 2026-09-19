# Node builds the bundle and then stays behind: the runtime image is nginx
# and static files, nothing else.
FROM node:20-alpine AS build

WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time, so these are build args rather than
# runtime environment: the API path is baked into the bundle.
ARG VITE_API_BASE_URL=/api
ARG VITE_API_DOCS_URL=/docs
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_DOCS_URL=$VITE_API_DOCS_URL

RUN npm run build


FROM nginx:1.27-alpine

# Substituted into the config by the base image's entrypoint on start, so the
# same image serves compose and every cluster.
ENV BACKEND_ORIGIN=http://api:8000

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html

# Port 8080 and the nginx uid: serving static files needs no root. The
# entrypoint renders the template into conf.d, and nginx writes its pid to
# /run — which is what /var/run points at, so chown the real path.
RUN chown -R 101:101 /var/cache/nginx /run /etc/nginx/conf.d
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
