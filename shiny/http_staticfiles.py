"""
We can't use starlette's StaticFiles when running in wasm mode, because it launches a
thread. Instead, use our own crappy version. Fortunately, this is all we need.

When running in native Python mode, use the starlette StaticFiles impl; it's battle
tested, whereas ours is not. Under wasm, it's OK if ours has bugs, even security holes:
everything is running in the browser sandbox including the filesystem, so there's
nothing we could disclose that an attacker wouldn't already have access to. The same is
not true when running in native Python, we want to be as safe as possible.
"""

import sys

from starlette.background import BackgroundTask

if "pyodide" not in sys.modules:
    # Running in native mode; use starlette StaticFiles

    import starlette.staticfiles
    import starlette.responses

    StaticFiles = starlette.staticfiles.StaticFiles  # type: ignore
    FileResponse = starlette.responses.FileResponse  # type: ignore

else:
    # Running in wasm mode; must use our own simple StaticFiles

    from typing import Optional, Tuple, MutableMapping, Iterable
    from starlette.types import Scope, Receive, Send
    from starlette.responses import PlainTextResponse
    import os
    import os.path
    import mimetypes
    import pathlib
    import urllib.parse

    class StaticFiles:
        dir: pathlib.Path
        root_path: str

        def __init__(self, directory: str):
            self.dir = pathlib.Path(os.path.realpath(os.path.normpath(directory)))

        async def __call__(self, scope: Scope, receive: Receive, send: Send):
            if scope["type"] != "http":
                raise AssertionError("StaticFiles can't handle non-http request")
            path = scope["path"]
            path_segments = path.split("/")
            final_path, trailing_slash = traverse_url_path(self.dir, path_segments)
            if final_path is None:
                return await Error404()(scope, receive, send)

            if not final_path.exists():
                return await Error404()(scope, receive, send)

            # Sanity check that final path is under self.dir, and if not, 404
            if not final_path.is_relative_to(self.dir):
                return await Error404()(scope, receive, send)

            # Serve up the path

            if final_path.is_dir():
                if trailing_slash:
                    # We could serve up index.html or directory listing if we wanted
                    return await Error404()(scope, receive, send)
                else:
                    # We could redirect with an added "/" if we wanted
                    return await Error404()(scope, receive, send)
            else:
                return await FileResponse(final_path)(scope, receive, send)

    def traverse_url_path(
        dir: pathlib.Path[str], path_segments: list[str]
    ) -> Tuple[Optional[pathlib.Path[str]], bool]:
        assert len(path_segments) > 0

        new_dir = dir
        path_segment = urllib.parse.unquote(path_segments.pop(0))
        # Gratuitous whitespace is not allowed
        if path_segment != path_segment.strip():
            return None, False

        # Check for illegal paths
        if "/" in path_segment:
            return None, False
        elif path_segment == ".." or path_segment == ".":
            return None, False

        if path_segment != "":
            new_dir = dir / path_segment

        if len(path_segments) == 0:
            return new_dir, path_segment == ""
        else:
            return traverse_url_path(new_dir, path_segments)

    class Error404(PlainTextResponse):
        def __init__(self):
            super().__init__("404", status_code=404)  # type: ignore

    class FileResponse:
        file: os.PathLike[str]
        headers: Optional[MutableMapping[str, str]]
        media_type: str

        def __init__(
            self,
            file: os.PathLike[str],
            headers: Optional[MutableMapping[str, str]] = None,
            media_type: Optional[str] = None,
            background: Optional[BackgroundTask] = None,
        ) -> None:
            self.headers = headers
            self.file = file
            self.background = background

            if media_type is None:
                media_type, _ = mimetypes.guess_type(file, strict=False)
                if media_type is None:
                    media_type = "application/octet-stream"
            self.media_type = media_type

        async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
            with open(self.file, "rb") as f:
                await send(
                    {
                        "type": "http.response.start",
                        "status": 200,
                        "headers": convert_headers(self.headers, self.media_type),
                    }
                )

                while True:
                    # In pyodide mode (the only mode in which we use this codepath) the
                    # `send()` callback has quite a bit of per-call overhead, so use a
                    # very large chunk size to keep performance adequate.
                    data = f.read(262144)
                    if len(data) == 0:
                        break
                    await send(
                        {
                            "type": "http.response.body",
                            "body": data,
                            "more_body": True,
                        }
                    )

                await send(
                    {"type": "http.response.body", "body": b"", "more_body": False}
                )
            if self.background:
                await self.background()

    def convert_headers(
        headers: Optional[MutableMapping[str, str]], media_type: Optional[str] = None
    ) -> Iterable[Tuple[bytes, bytes]]:
        if headers is None:
            headers = {}

        header_list = [
            (k.encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()
        ]
        if media_type is not None:
            header_list += [
                (
                    b"Content-Type",
                    media_type.encode("latin-1"),
                )
            ]
        return header_list