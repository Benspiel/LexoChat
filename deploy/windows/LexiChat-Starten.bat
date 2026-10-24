@echo off
REM Startet LexiChat (beim ersten Mal mit Einrichtung). Voraussetzung: Docker Desktop laeuft.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0LexiChat.ps1" start
