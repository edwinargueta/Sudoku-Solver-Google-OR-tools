# The venv is built in its own stage so the runtime image carries no pip
# cache and no build metadata — OR-Tools is most of the weight as it is.
#
# The base is pinned by digest as well as tag, so two builds of one commit
# get the same OS and Python patch level. Dependabot moves the digest.
FROM python:3.13-slim@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b AS build

WORKDIR /src

# Only the dependencies, from the lock CI tested against, and only as wheels:
# nothing is built, so nothing unpinned (a build backend) is fetched to do
# it. The app stays out of the venv, so its layer, most of the image, is the
# same from one code change to the next, and a deploy does not pull it again.
COPY requirements.lock ./
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --only-binary :all: -r requirements.lock


# COPY keeps the modes files have on the build machine, and a checkout made
# under umask 077 is readable by its owner alone: root, in the image, while
# the app runs as uid 10001. So the source is set to 644 and 755 here, as
# pip install used to leave it. In a stage of its own, so the venv's stage,
# and the layer the runtime takes from it, do not change with the code. A
# plain chmod, as older BuildKit rejects a symbolic COPY --chmod.
FROM python:3.13-slim@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b AS source

WORKDIR /src
COPY app ./app
RUN chmod -R u=rwX,go=rX app


FROM python:3.13-slim@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b

# FORWARDED_ALLOW_IPS is read by uvicorn itself: the proxies whose
# X-Forwarded-For and -Proto it believes. Loopback by default, which inside a
# container means nobody, so a client can never pick its own address or
# scheme. Each deployment names its proxy (compose.yaml,
# deploy/k8s/base/kustomization.yaml), since only it knows who can reach
# the port.
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    FORWARDED_ALLOW_IPS=127.0.0.1

# A numeric USER, so a runAsNonRoot pod can check it without a runAsUser.
RUN useradd --create-home --uid 10001 --user-group api

COPY --from=build /opt/venv /opt/venv

# The source as it is, not installed: uvicorn imports `app` from the working
# directory. Last, so a code change rebuilds only this small layer.
WORKDIR /home/api
COPY --from=source /src/app ./app
USER 10001:10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request as r; r.urlopen('http://127.0.0.1:8000/api/health').read()"

# One uvicorn worker on purpose: solve handlers are sync, CP-SAT is CPU-bound,
# and a pod is the unit of scaling. Add replicas, not workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
