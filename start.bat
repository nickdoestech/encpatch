@echo off
REM Quick dev launcher (Windows) — runs the bare Node server.
REM For the full app, build with `npm run dist:win` (when available) and
REM install the resulting .exe, or use `npm run dev:electron` for windowed
REM dev. Windows packaging is not currently configured.
cd /d "%~dp0"
node server\server.js %*
