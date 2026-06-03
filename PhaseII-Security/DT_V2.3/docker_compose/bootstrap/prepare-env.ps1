param(
    [switch]$RotateSecrets
)

$composeRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envFile = Join-Path $composeRoot ".env"
$envExampleFile = Join-Path $composeRoot ".env.example"
$mysqlSecretFile = Join-Path $composeRoot "secrets.txt"
$generatedEnvFile = Join-Path $composeRoot "bootstrap/.env.generated"
$generatedEnvExampleFile = Join-Path $composeRoot "bootstrap/.env.generated.example"
$runtimeConfigFile = Join-Path $composeRoot "../web/digital-twin-portal/js/runtime-config.js"
$runtimeConfigTemplateFile = Join-Path $composeRoot "../web/digital-twin-portal/js/runtime-config.template.js"

function New-RandomSecret {
    param([int]$Length = 40)
    $alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $chars = for ($i = 0; $i -lt $Length; $i++) {
        $alphabet[(Get-Random -Minimum 0 -Maximum $alphabet.Length)]
    }
    -join $chars
}

function Get-EnvValue {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path $Path)) {
        return ""
    }

    $pattern = "^{0}=(.*)$" -f [Regex]::Escape($Key)
    foreach ($line in Get-Content $Path) {
        if ($line -match $pattern) {
            return $Matches[1]
        }
    }

    return ""
}

function Set-EnvValue {
    param([string]$Path, [string]$Key, [string]$Value)

    $lines = @()
    if (Test-Path $Path) {
        $lines = @(Get-Content $Path)
    }

    $pattern = "^{0}=.*$" -f [Regex]::Escape($Key)
    $updated = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $lines[$i] = "{0}={1}" -f $Key, $Value
            $updated = $true
            break
        }
    }

    if (-not $updated) {
        $lines += "{0}={1}" -f $Key, $Value
    }

    Set-Content -Path $Path -Value $lines
}

if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $envExampleFile)) {
        throw "Missing template: $envExampleFile"
    }
    Copy-Item $envExampleFile $envFile
    Write-Host "Created $envFile from .env.example"
}

if (Test-Path $envExampleFile) {
    foreach ($line in Get-Content $envExampleFile) {
        if ($line -match '^\s*#' -or [string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        if ($line -match '^([A-Za-z0-9_]+)=(.*)$') {
            $key = $Matches[1]
            $templateValue = $Matches[2]
            $current = Get-EnvValue -Path $envFile -Key $key
            if ([string]::IsNullOrWhiteSpace($current)) {
                Set-EnvValue -Path $envFile -Key $key -Value $templateValue
            }
        }
    }

}

$secretKeys = @(
    "KEYROCK_DB_PASS",
    "KEYROCK_ADMIN_PASS",
    "KEYROCK_VIEWER_PASS",
    "BFF_SESSION_SECRET",
    "MONGO_ROOT_PASSWORD"
)

foreach ($key in $secretKeys) {
    $current = Get-EnvValue -Path $envFile -Key $key
    if ($RotateSecrets -or [string]::IsNullOrWhiteSpace($current)) {
        $newValue = New-RandomSecret
        Set-EnvValue -Path $envFile -Key $key -Value $newValue
        Write-Host "Generated $key in .env"
    }
}

$secretNeedsWrite = $RotateSecrets -or -not (Test-Path $mysqlSecretFile)
if (-not $secretNeedsWrite) {
    $rawSecret = (Get-Content -Raw $mysqlSecretFile).Trim()
    if ([string]::IsNullOrWhiteSpace($rawSecret)) {
        $secretNeedsWrite = $true
    }
}

if ($secretNeedsWrite) {
    Set-Content -Path $mysqlSecretFile -NoNewline -Value (New-RandomSecret)
    Write-Host "Generated MySQL root secret file"
}

if (Test-Path $generatedEnvExampleFile) {
    Copy-Item $generatedEnvExampleFile $generatedEnvFile -Force
} else {
    Set-Content -Path $generatedEnvFile -Value @(
        "PEP_PROXY_APP_ID=",
        "PEP_PROXY_USERNAME=",
        "PEP_PROXY_PASSWORD=",
        "KEYROCK_CLIENT_ID=",
        "KEYROCK_CLIENT_SECRET="
    )
}

if (Test-Path $runtimeConfigTemplateFile) {
    Copy-Item $runtimeConfigTemplateFile $runtimeConfigFile -Force
} else {
    Set-Content -Path $runtimeConfigFile -Value @(
        'window.__DT_RUNTIME_CONFIG__ = {',
        '  KEYROCK_CLIENT_ID: ""',
        '};'
    )
}

Write-Host "Prepared local environment files."
Write-Host "Next step: cd docker_compose; docker compose up -d --build"
