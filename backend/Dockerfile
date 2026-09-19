# The venv is built in its own stage so the runtime image carries no pip
# cache and no build metadata — OR-Tools is most of the weight as it is.
FROM python:3.13-slim AS build

WORKDIR /src
COPY pyproject.toml ./
COPY app ./app

RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir .


FROM python:3.13-slim

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=build /opt/venv /opt/venv

RUN useradd --create-home --uid 10001 api
USER api
WORKDIR /home/api

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request as r; r.urlopen('http://127.0.0.1:8000/api/health').read()"

# One uvicorn worker on purpose: solve handlers are sync, CP-SAT is CPU-bound,
# and a pod is the unit of scaling. Add replicas, not workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
