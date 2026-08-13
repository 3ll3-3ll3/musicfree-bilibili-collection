param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [string]$OutputPath = "",

    [switch]$Watch,

    [switch]$DeleteSource,

    [switch]$ReportOnly,

    [int]$StableSeconds = 3
)

$ErrorActionPreference = "Stop"

function Get-ToolPath([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$ffmpeg = Get-ToolPath "ffmpeg"
$ffprobe = Get-ToolPath "ffprobe"

if (-not $ffprobe) {
    throw "找不到 ffprobe。请先安装 FFmpeg，并确保 ffmpeg.exe / ffprobe.exe 已加入 PATH。"
}
if (-not $ReportOnly -and -not $ffmpeg) {
    throw "找不到 ffmpeg。请先安装 FFmpeg，并确保 ffmpeg.exe / ffprobe.exe 已加入 PATH。"
}

$sourceRoot = (Resolve-Path $InputPath).Path
if (-not $OutputPath) {
    $targetRoot = $sourceRoot
} else {
    if (-not (Test-Path $OutputPath)) {
        New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    }
    $targetRoot = (Resolve-Path $OutputPath).Path
}

$processed = New-Object 'System.Collections.Generic.HashSet[string]'

function Get-ProbeInfo([string]$Path) {
    $json = & $ffprobe -v error -select_streams a:0 `
        -show_entries stream=codec_name,codec_long_name,bit_rate,sample_rate,channels `
        -show_entries format=format_name,duration,bit_rate `
        -of json -- $Path 2>$null

    if ($LASTEXITCODE -ne 0 -or -not $json) {
        throw "ffprobe 无法识别文件"
    }

    $probe = $json | ConvertFrom-Json
    $stream = $probe.streams | Select-Object -First 1
    if (-not $stream) { throw "文件中没有音频流" }

    [PSCustomObject]@{
        Codec      = [string]$stream.codec_name
        CodecLong  = [string]$stream.codec_long_name
        BitRate    = if ($stream.bit_rate) { [int64]$stream.bit_rate } elseif ($probe.format.bit_rate) { [int64]$probe.format.bit_rate } else { 0 }
        SampleRate = if ($stream.sample_rate) { [int]$stream.sample_rate } else { 0 }
        Channels   = if ($stream.channels) { [int]$stream.channels } else { 0 }
        Format     = [string]$probe.format.format_name
        Duration   = if ($probe.format.duration) { [double]$probe.format.duration } else { 0 }
    }
}

function Get-TargetExtension([string]$Codec) {
    switch ($Codec.ToLowerInvariant()) {
        "aac"  { return ".m4a" }
        "alac" { return ".m4a" }
        "flac" { return ".flac" }
        "mp3"  { return ".mp3" }
        "opus" { return ".opus" }
        default { return $null }
    }
}

function Wait-FileStable([string]$Path) {
    if ($StableSeconds -le 0) { return }
    $last = -1L
    $stable = 0
    while ($stable -lt $StableSeconds) {
        if (-not (Test-Path $Path)) { throw "文件已消失" }
        $size = (Get-Item $Path).Length
        if ($size -eq $last -and $size -gt 0) {
            $stable++
        } else {
            $stable = 0
            $last = $size
        }
        Start-Sleep -Seconds 1
    }
}

function Show-Probe([System.IO.FileInfo]$File, $Info) {
    $kbps = if ($Info.BitRate -gt 0) { [math]::Round($Info.BitRate / 1000, 0) } else { "?" }
    $khz = if ($Info.SampleRate -gt 0) { [math]::Round($Info.SampleRate / 1000, 1) } else { "?" }
    Write-Host ("{0} | codec={1} | bitrate={2} kbps | {3} kHz | ch={4} | container={5}" -f `
        $File.Name, $Info.Codec, $kbps, $khz, $Info.Channels, $Info.Format)
}

function Normalize-One([System.IO.FileInfo]$File) {
    $key = $File.FullName.ToLowerInvariant()
    if ($processed.Contains($key)) { return }

    try {
        if ($Watch) { Wait-FileStable $File.FullName }
        $info = Get-ProbeInfo $File.FullName
        Show-Probe $File $info

        if ($ReportOnly) {
            [void]$processed.Add($key)
            return
        }

        $targetExt = Get-TargetExtension $info.Codec
        if (-not $targetExt) {
            Write-Warning "跳过 $($File.Name)：暂未为 codec=$($info.Codec) 定义 Cotton 输出格式。"
            [void]$processed.Add($key)
            return
        }

        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($File.Name)
        $dest = Join-Path $targetRoot ($baseName + $targetExt)
        $temp = Join-Path $targetRoot ($baseName + ".cotton-normalizing" + $targetExt)

        if (Test-Path $temp) { Remove-Item $temp -Force }

        $args = @("-y", "-v", "error", "-i", $File.FullName, "-map", "0:a:0", "-c:a", "copy")
        if ($targetExt -eq ".m4a") {
            $args += @("-movflags", "+faststart")
        }
        $args += @($temp)

        & $ffmpeg @args
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $temp)) {
            throw "FFmpeg 无损封装失败"
        }

        # 用 ffprobe 再验证一次输出，不以扩展名冒充格式。
        $verified = Get-ProbeInfo $temp
        if (-not $verified.Codec) {
            throw "输出文件验证失败"
        }

        if ((Resolve-Path $targetRoot).Path -eq (Resolve-Path $sourceRoot).Path -and `
            $dest.ToLowerInvariant() -eq $File.FullName.ToLowerInvariant()) {
            Remove-Item $File.FullName -Force
            Move-Item $temp $dest -Force
        } else {
            if (Test-Path $dest) { Remove-Item $dest -Force }
            Move-Item $temp $dest -Force
            if ($DeleteSource -and $File.FullName.ToLowerInvariant() -ne $dest.ToLowerInvariant()) {
                Remove-Item $File.FullName -Force
            }
        }

        $out = Get-Item $dest
        $outInfo = Get-ProbeInfo $out.FullName
        Write-Host "  -> OK: $($out.Name) [$($outInfo.Codec)]" -ForegroundColor Green
        [void]$processed.Add($key)
        [void]$processed.Add($out.FullName.ToLowerInvariant())
    }
    catch {
        Write-Warning "处理失败 $($File.Name)：$($_.Exception.Message)"
        [void]$processed.Add($key)
    }
}

function Get-CandidateFiles {
    # MusicFree/B站常见下载结果。正常 .m4a 也可在 ReportOnly 时检查。
    $patterns = if ($ReportOnly) {
        @("*.m4s", "*.m4a", "*.mp4", "*.aac", "*.flac", "*.mp3", "*.opus")
    } else {
        @("*.m4s", "*.mp4", "*.aac")
    }

    foreach ($pattern in $patterns) {
        Get-ChildItem -Path $sourceRoot -File -Filter $pattern -ErrorAction SilentlyContinue
    }
}

Write-Host "Input : $sourceRoot"
Write-Host "Output: $targetRoot"
Write-Host "Mode  : $(if ($ReportOnly) { 'report' } elseif ($Watch) { 'watch' } else { 'one-shot' })"

if ($Watch) {
    Write-Host "正在监听 MusicFree 下载目录。按 Ctrl+C 停止。"
    while ($true) {
        foreach ($file in (Get-CandidateFiles)) {
            Normalize-One $file
        }
        Start-Sleep -Seconds 2
    }
} else {
    foreach ($file in (Get-CandidateFiles)) {
        Normalize-One $file
    }
}
