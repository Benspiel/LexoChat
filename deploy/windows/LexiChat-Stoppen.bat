@echo off
REM Stoppt LexiChat. Die Daten bleiben erhalten.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0LexiChat.ps1" stop
