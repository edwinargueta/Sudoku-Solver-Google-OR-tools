#!/usr/bin/env bash
# Runs both images the way the cluster does (read-only root, the same
# writable mounts, no capabilities) and checks what only a running container
# can show: that nginx accepts the config its entrypoint renders, the SPA
# fallback, the cache and security headers, and both proxied paths.
#
#   .github/scripts/smoke.sh <api image> <web image>
#
# The containers are published on 127.0.0.1 only, on SMOKE_API_PORT and
# SMOKE_WEB_PORT (18000 and 18080 unless set), and removed afterwards.
set -euo pipefail

api_image=${1:?usage: smoke.sh <api image> <web image>}
web_image=${2:?usage: smoke.sh <api image> <web image>}
api_port=${SMOKE_API_PORT:-18000}
web_port=${SMOKE_WEB_PORT:-18080}

run=sudoku-smoke-$$
work=$(mktemp -d)

cleanup() {
    docker rm -f "$run-api" "$run-web" >/dev/null 2>&1 || true
    docker network rm "$run" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT

failed=0
pass() { echo "ok   $*"; }
fail() { echo "FAIL $*"; failed=1; }

# GET a URL into $work/body and $work/headers; prints the status code.
fetch() {
    curl -sS -o "$work/body" -D "$work/headers" -w '%{http_code}' "$@"
}

expect_status() { # <want> <what> <curl args...>
    local want=$1 what=$2 got
    shift 2
    got=$(fetch "$@") || got=000
    if [ "$got" = "$want" ]; then pass "$what: $got"; else fail "$what: $got, wanted $want"; fi
}

expect_header() { # <regex> <what>
    if grep -Eiq "$1" "$work/headers"; then pass "$2"; else fail "$2 (no header matching $1)"; fi
}

refuse_header() { # <regex> <what>
    if grep -Eiq "$1" "$work/headers"; then fail "$2 (sent $1)"; else pass "$2"; fi
}

expect_body() { # <fixed string> <what>
    if grep -Fq "$1" "$work/body"; then pass "$2"; else fail "$2 (body lacks $1)"; fi
}

wait_for() { # <url>
    for _ in $(seq 60); do
        curl -fsS -o /dev/null "$1" 2>/dev/null && return 0
        sleep 1
    done
    echo "gave up waiting for $1" >&2
    return 1
}

show_logs() {
    docker logs "$run-api" 2>&1 | tail -20 || true
    docker logs "$run-web" 2>&1 | tail -20 || true
}

docker network create "$run" >/dev/null

# Each tmpfs is world-writable, as an emptyDir is: Docker's default, 755 and
# owned by root, is no use to either image's user. The API trusts forwarded
# headers from anyone here since, as in compose, only the web container and
# this script can reach it.
docker run -d --name "$run-api" --network "$run" --network-alias api \
    --read-only --tmpfs /tmp:mode=1777 --cap-drop ALL --security-opt no-new-privileges \
    -e FORWARDED_ALLOW_IPS='*' \
    -p "127.0.0.1:$api_port:8000" "$api_image" >/dev/null

docker run -d --name "$run-web" --network "$run" \
    --read-only --tmpfs /etc/nginx/conf.d:mode=1777 --tmpfs /var/cache/nginx:mode=1777 \
    --tmpfs /run:mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges \
    -e BACKEND_ORIGIN=http://api:8000 \
    -p "127.0.0.1:$web_port:8080" "$web_image" >/dev/null

api=http://127.0.0.1:$api_port
web=http://127.0.0.1:$web_port
wait_for "$api/api/health" || { show_logs; exit 1; }
wait_for "$web/" || { show_logs; exit 1; }

echo "== images"
for pair in api:10001 web:101; do
    uid=$(docker exec "$run-${pair%%:*}" id -u)
    if [ "$uid" = "${pair#*:}" ]; then
        pass "${pair%%:*} runs as uid $uid"
    else
        fail "${pair%%:*} runs as uid $uid, wanted ${pair#*:}"
    fi
done
case $(docker image inspect -f '{{.Config.User}}' "$api_image") in
    [0-9]*) pass "api image USER is numeric" ;;
    *) fail "api image USER is not numeric" ;;
esac
# The app is copied in as source, outside the venv, so a code change leaves
# the venv's layer, most of the image, as it was.
where=$(docker exec "$run-api" python -c 'import app; print(app.__file__)' 2>&1) || true
if [ "$where" = /home/api/app/__init__.py ]; then
    pass "api runs the app from its working directory, not the venv"
else
    fail "api runs the app from $where, wanted /home/api/app"
fi
stray=$(docker exec "$run-api" find /home/api/app -name '*.py[cod]' -o -name .DS_Store 2>&1 | head -3) || true
if [ -z "$stray" ]; then
    pass "api image has no bytecode or Finder files from the build machine"
else
    fail "api image has $stray"
fi
# COPY keeps the build machine's modes, root owns what it copies, and neither
# image runs as root: all of it has to be readable by anyone and writable by
# root alone. CI builds from a checkout with group and other access removed.
for pair in api:/home/api/app web:/etc/nginx/templates web:/usr/share/nginx/html; do
    name=${pair%%:*} dir=${pair#*:}
    odd=$(docker exec "$run-$name" find "$dir" \
        \( ! -perm -004 -o -type d ! -perm -001 -o -perm /022 \) 2>&1 | head -3) || true
    if [ -z "$odd" ]; then
        pass "$name: $dir is readable by all, writable by root only"
    else
        fail "$name: unreadable or writable by others: $odd"
    fi
done
if docker exec "$run-web" nginx -t >"$work/nginx-t" 2>&1; then
    pass "nginx -t"
else
    fail "nginx -t"
    cat "$work/nginx-t"
fi

echo "== api"
expect_status 200 "/api/health" "$api/api/health"
expect_body '"ortools_version"' "/api/health reports OR-Tools"
# --proxy-headers with FORWARDED_ALLOW_IPS: a trusted proxy's scheme is used.
expect_status 307 "/api/health/ redirects" -H 'X-Forwarded-Proto: https' "$api/api/health/"
expect_header '^location: https://127\.0\.0\.1:'"$api_port"'/api/health' "redirect believes X-Forwarded-Proto"

echo "== web: the SPA"
expect_status 200 "/" "$web/"
expect_body '<div id="root">' "/ is index.html"
expect_header '^cache-control: no-cache' "/ is revalidated"
expect_header "^content-security-policy: default-src 'self'" "/ has a CSP"
expect_header "^content-security-policy: .*img-src 'self' data:" "the CSP allows the inline favicon"
expect_header '^x-content-type-options: nosniff' "/ has nosniff"
expect_header '^strict-transport-security: max-age=' "/ has HSTS"
expect_header '^referrer-policy: ' "/ has a referrer policy"
expect_header '^server: nginx.?$' "Server header has no version"
asset=$(grep -Eo '/assets/[^"]+\.js' "$work/body" | head -1 || true)

expect_status 200 "a client-side route" "$web/some/client/route"
expect_body '<div id="root">' "the fallback serves index.html"
expect_header '^cache-control: no-cache' "the fallback is revalidated"

expect_status 200 "/docsfoo stays with the SPA" "$web/docsfoo"
expect_body '<div id="root">' "/docsfoo is index.html"

[ -n "$asset" ] || { fail "index.html names no script under /assets/"; asset=/assets/missing.js; }
expect_status 200 "$asset" -H 'Accept-Encoding: gzip' "$web$asset"
expect_header '^cache-control: public, max-age=31536000, immutable' "assets are immutable"
expect_header '^content-encoding: gzip' "assets are gzipped"
expect_header '^x-content-type-options: nosniff' "assets keep the shared headers"
expect_status 404 "a missing asset" "$web/assets/missing.js"
expect_header '^x-content-type-options: nosniff' "error pages keep the shared headers"
expect_status 404 "/favicon.ico" "$web/favicon.ico"

echo "== web: proxied to the API"
expect_status 200 "/api/health via nginx" "$web/api/health"
expect_status 200 "/api/solve via nginx" -H 'Content-Type: application/json' \
    --data '{"puzzle": "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79", "max_solutions": 1}' \
    "$web/api/solve"
expect_status 200 "/docs via nginx" "$web/docs"
refuse_header '^content-security-policy:' "/docs has no CSP (Swagger UI loads from a CDN)"
expect_status 200 "/openapi.json via nginx" "$web/openapi.json"
expect_status 200 "/redoc via nginx" "$web/redoc"
# Host keeps its port, so the API's redirect points back at nginx.
expect_status 307 "/api/health/ via nginx redirects" "$web/api/health/"
expect_header '^location: http://127\.0\.0\.1:'"$web_port"'/api/health' "redirect keeps host and port"
# In the cluster Traefik sends the docs paths here over plain HTTP; the
# scheme it saw is what the API has to be told.
expect_status 307 "/api/health/ via nginx, behind a proxy" -H 'X-Forwarded-Proto: https' "$web/api/health/"
expect_header '^location: https://127\.0\.0\.1:'"$web_port"'/api/health' "nginx passes on the scheme from a proxy in front"

if [ "$failed" != 0 ]; then
    show_logs
    exit 1
fi
echo "all checks passed"
