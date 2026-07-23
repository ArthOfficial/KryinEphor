param(
    [string]$ScriptFile = (Join-Path $PSScriptRoot '..\SCRIPT.md'),
    [string]$OutputFile = (Join-Path $PSScriptRoot '..\audio\narration.wav')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$scriptText = Get-Content -Raw -LiteralPath $ScriptFile
$scriptText = $scriptText -replace '(?s)\A---.*?---\s*', ''
$scriptText = $scriptText -replace '\s+', ' '
$scriptText = $scriptText.Trim()

$outputDirectory = Split-Path -Parent $OutputFile
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speaker.SelectVoice('Microsoft Zira Desktop')
    $speaker.Rate = -3
    $speaker.Volume = 100
    $speaker.SetOutputToWaveFile($OutputFile)
    $speaker.Speak($scriptText)
}
finally {
    $speaker.Dispose()
}

$duration = [Math]::Round(((Get-Item -LiteralPath $OutputFile).Length - 44) / 88200.0, 2)
Write-Output "Narration written to $OutputFile ($duration seconds)"
