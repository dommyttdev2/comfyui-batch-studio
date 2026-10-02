$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param([string[]] $GitArguments)

    $output = & git @GitArguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArguments -join ' ') failed (exit code $LASTEXITCODE)."
    }
    return $output
}

try {
    Set-Location (Split-Path -Parent $PSScriptRoot)
    $null = Get-Command git -ErrorAction Stop
    $null = Invoke-Git @('rev-parse', '--show-toplevel')

    # Never discard tracked edits or staged files. Git checkout also protects
    # untracked files that would be overwritten by the release.
    $changes = Invoke-Git @('status', '--porcelain', '--untracked-files=no')
    if ($changes) {
        throw 'Uncommitted changes found. Commit or stash them before updating.'
    }

    Write-Host '[INFO] Looking up the latest stable GitHub release...'
    # Windows PowerShell 5.1 can otherwise default to obsolete TLS versions.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/dommyttdev2/comfyui-batch-studio/releases/latest' -Headers @{
        Accept = 'application/vnd.github+json'
        'User-Agent' = 'comfyui-batch-studio-updater'
    } -TimeoutSec 30

    $tag = $release.tag_name
    if ($release.draft -or $release.prerelease -or $tag -cnotmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        throw 'The latest release does not have a valid stable version tag.'
    }

    Write-Host "[INFO] Fetching release $tag..."
    # Fetch from the same official repository as the release API, even if the
    # user's origin points to a fork. Never force-overwrite a published local tag.
    $null = Invoke-Git @('fetch', '--no-tags', 'https://github.com/dommyttdev2/comfyui-batch-studio.git', "refs/tags/${tag}:refs/tags/${tag}")
    $commit = Invoke-Git @('rev-parse', '--verify', "refs/tags/${tag}^{commit}")
    $null = Invoke-Git @('checkout', '--detach', $commit)

    Write-Host "[OK] Updated to $tag (detached HEAD)."
    Write-Host 'Run run.bat to install dependencies, build, and start the application.'
    exit 0
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    exit 1
}
