$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param([string[]] $GitArguments)

    $output = & git @GitArguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArguments -join ' ') failed (exit code $LASTEXITCODE)."
    }
    return $output
}

function Get-GitHubToken {
    foreach ($token in @($env:GH_TOKEN, $env:GITHUB_TOKEN)) {
        if ($token) { return $token.Trim() }
    }

    if (Get-Command gh -ErrorAction SilentlyContinue) {
        try {
            $token = & gh auth token --hostname github.com 2>$null
            if ($LASTEXITCODE -eq 0 -and $token) { return ($token -join '').Trim() }
        } catch { # An unauthenticated CLI can still fall back to Git credentials.
        }
    }

    $previousPrompt = $env:GIT_TERMINAL_PROMPT
    try {
        $env:GIT_TERMINAL_PROMPT = '0'
        $credential = "protocol=https`nhost=github.com`npath=dommyttdev2/comfyui-batch-studio.git`n`n" |
            & git -c credential.interactive=never credential fill 2>$null
        if ($LASTEXITCODE -eq 0) {
            foreach ($line in $credential) {
                if ($line.StartsWith('password=')) { return $line.Substring(9) }
            }
        }
    } catch { # Public repositories can be read without credentials.
    } finally {
        $env:GIT_TERMINAL_PROMPT = $previousPrompt
    }
    return $null
}

function Invoke-ReleaseFetch {
    param([string] $Tag, [string] $Token)

    # Pass credentials only through transient process configuration, not command
    # arguments or persistent Git configuration. Preserve the caller's settings.
    $previousCount = $env:GIT_CONFIG_COUNT
    $slot = [int] $previousCount
    $keyName = "GIT_CONFIG_KEY_$slot"
    $valueName = "GIT_CONFIG_VALUE_$slot"
    $previousKey = [Environment]::GetEnvironmentVariable($keyName)
    $previousValue = [Environment]::GetEnvironmentVariable($valueName)
    try {
        if ($Token) {
            $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("x-access-token:${Token}"))
            [Environment]::SetEnvironmentVariable($keyName, 'http.https://github.com/.extraHeader')
            [Environment]::SetEnvironmentVariable($valueName, "Authorization: Basic $basic")
            $env:GIT_CONFIG_COUNT = [string] ($slot + 1)
        }
        $null = Invoke-Git @('fetch', '--no-tags', 'https://github.com/dommyttdev2/comfyui-batch-studio.git', "refs/tags/${Tag}:refs/tags/${Tag}")
    } finally {
        $env:GIT_CONFIG_COUNT = $previousCount
        [Environment]::SetEnvironmentVariable($keyName, $previousKey)
        [Environment]::SetEnvironmentVariable($valueName, $previousValue)
    }
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
    $token = Get-GitHubToken
    $headers = @{
        Accept = 'application/vnd.github+json'
        'User-Agent' = 'comfyui-batch-studio-updater'
    }
    if ($token) { $headers.Authorization = "Bearer $token" }
    try {
        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/dommyttdev2/comfyui-batch-studio/releases/latest' -Headers $headers -TimeoutSec 30
    } catch {
        # Do not print request headers or token-bearing exception details.
        throw 'Could not access the latest GitHub release. For a private repository, authenticate with gh auth login, Git credential manager, or GH_TOKEN / GITHUB_TOKEN, and ensure repository access and a published stable release. Also check the network connection.'
    }

    $tag = $release.tag_name
    if ($release.draft -or $release.prerelease -or $tag -cnotmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        throw 'The latest release does not have a valid stable version tag.'
    }

    Write-Host "[INFO] Fetching release $tag..."
    # Fetch from the same official repository as the release API, even if the
    # user's origin points to a fork. Never force-overwrite a published local tag.
    Invoke-ReleaseFetch -Tag $tag -Token $token
    $commit = Invoke-Git @('rev-parse', '--verify', "refs/tags/${tag}^{commit}")
    $null = Invoke-Git @('checkout', '--detach', $commit)

    Write-Host "[OK] Updated to $tag (detached HEAD)."
    Write-Host 'Run run.bat to install dependencies, build, and start the application.'
    exit 0
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    exit 1
}
