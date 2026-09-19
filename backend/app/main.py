"""FastAPI application factory.

Run it with:  uvicorn app.main:app --reload
Interactive docs:  http://localhost:8000/docs
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app; taking settings as an argument keeps tests hermetic."""
    settings = settings or get_settings()

    app = FastAPI(
        title=settings.app_name,
        description="A Sudoku solver built on Google OR-Tools CP-SAT.",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    app.include_router(router, prefix=settings.api_prefix)

    @app.get("/", tags=["meta"])
    def root() -> dict[str, str]:
        """Point a bare browser hit at the docs."""
        return {"name": settings.app_name, "docs": "/docs", "api": settings.api_prefix}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
