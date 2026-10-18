"""FastAPI application factory.

Run it with:  uvicorn app.main:app --reload
Interactive docs:  http://localhost:8000/docs
"""

from __future__ import annotations

from threading import BoundedSemaphore

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.routes import router
from app.config import Settings, get_settings

API_PREFIX = "/api"

#: The largest request body accepted. A 9x9 grid is about 200 bytes.
MAX_BODY_BYTES = 16 * 1024


class BodySizeLimit:
    """Answer a request body over `limit` bytes with a 413, before it is parsed.

    A Content-Length over the limit is refused without reading a byte. A
    chunked body has none, so it is counted as it arrives; one that fits is
    buffered and replayed to the app, which at this size costs nothing.
    """

    def __init__(self, app: ASGIApp, limit: int) -> None:
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length", "")
        if declared.isdigit() and int(declared) > self.limit:
            await self._refuse(scope, receive, send)
            return

        messages: list[Message] = []
        size = 0
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                break
            size += len(message.get("body", b""))
            if size > self.limit:
                await self._refuse(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        async def replay() -> Message:
            return messages.pop(0) if messages else await receive()

        await self.app(scope, replay, send)

    @staticmethod
    async def _refuse(scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse({"detail": "Request body too large."}, status_code=413)
        await response(scope, receive, send)


async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """A 422 that says what was wrong without repeating the request back.

    FastAPI's own handler echoes each error's `input`, so an oversized body
    comes back just as large, and a NaN in it cannot be written as JSON at all
    and turns into a 500. Only each error's type, loc and msg are kept.
    """
    errors = [
        {
            "type": error["type"],
            "loc": error["loc"],
            # A ValueError from a validator arrives as "Value error, <message>".
            "msg": error["msg"].removeprefix("Value error, "),
        }
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app; every route reads the settings passed here, so tests are hermetic."""
    settings = settings or get_settings()

    app = FastAPI(
        title=settings.app_name,
        description="A Sudoku solver built on Google OR-Tools CP-SAT.",
        version="0.1.0",
    )
    app.state.settings = settings
    app.state.solve_slots = BoundedSemaphore(settings.solver_concurrency)

    app.add_exception_handler(RequestValidationError, validation_error)

    # Added first so it sits inside CORS, and a 413 still carries its headers.
    app.add_middleware(BodySizeLimit, limit=MAX_BODY_BYTES)
    # Nothing here uses cookies or custom headers, so neither is allowed:
    # a wildcard origin can then never mean credentialed access.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    app.include_router(router, prefix=API_PREFIX)

    @app.get("/", tags=["meta"])
    def root() -> dict[str, str]:
        """Point a bare browser hit at the docs."""
        return {"name": settings.app_name, "docs": "/docs", "api": API_PREFIX}

    return app


def __getattr__(name: str) -> FastAPI:
    # `app` is built the first time something asks for it (uvicorn, via
    # app.main:app), not at import, so importing create_app reads nothing
    # from the environment.
    if name == "app":
        app = globals()["app"] = create_app()
        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
