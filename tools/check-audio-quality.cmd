@echo off
chcp 65001 >nul
setlocal

echo ================================================
echo   Bilibili / MusicFree 音频真实质量检查
echo ================================================
echo.
echo 本工具不会修改或删除任何音乐文件。
echo 它会显示真实 codec、bitrate、sample rate、channels 和 container。
echo.

where ffprobe >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 ffprobe。
  echo 请先安装 FFmpeg，并确保 ffprobe.exe 已加入 PATH。
  echo.
  pause
  exit /b 1
)

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
echo 正在检查：%MUSIC_DIR%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cotton-normalizer.ps1" -InputPath "%MUSIC_DIR%" -ReportOnly -StableSeconds 0

echo.
echo ================================================
echo 判断参考：
echo AAC 约 64-96 kbps   : 偏低
echo AAC 约 120-140 kbps : B站常见标准音轨
echo AAC 约 180-200 kbps : B站常见较高音质音轨
echo FLAC                : 原生无损（是否可用取决于视频和账号权限）
echo ================================================
echo.
pause
