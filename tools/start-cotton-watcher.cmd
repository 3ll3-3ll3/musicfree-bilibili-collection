@echo off
chcp 65001 >nul
setlocal

echo Cotton Music Normalizer - MusicFree 下载目录监听
echo.
set /p MUSIC_DIR=请输入 MusicFree 下载目录（例如 D:\MusicFreeDownloads）：

if "%MUSIC_DIR%"=="" (
  echo 未输入目录。
  pause
  exit /b 1
)

if not exist "%MUSIC_DIR%" (
  echo 目录不存在：%MUSIC_DIR%
  pause
  exit /b 1
)

echo.
echo 默认安全模式：生成规范化后的 M4A/FLAC，但保留原始文件。
echo 确认结果正常后，可自行在 PowerShell 命令中加入 -DeleteSource。
echo 按 Ctrl+C 停止监听。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cotton-normalizer.ps1" -InputPath "%MUSIC_DIR%" -Watch

pause
