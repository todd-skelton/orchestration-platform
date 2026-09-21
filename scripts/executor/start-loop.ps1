# Starts the loop on the WSL Ubuntu executor from Windows and stays attached to
# it (ISS-164). Ensures the pool bridge is listening on the WSL-facing host
# address first, so workers on the executor can reach the local subscription
# pool. The supervisor's stdout is the private request stream: status lines are
# echoed to this console, native-db requests are answered on its stdin, and its
# stderr is drained concurrently. The parent exits when the supervisor exits
# (idle, terminal stop or cancel) or fails to start; it never signals Linux.
# Requires PowerShell 7 (ProcessStartInfo.ArgumentList).
param(
  [string]$Config = "/root/orchestration-m1/loop.json",
  # Clean Windows worktree contained in the incumbent ROOT container. Absent
  # means every native-db request is refused as unsupported.
  [string]$VerifierWorktree = ""
)

$ErrorActionPreference = "Stop"
$NativeDbRequestSchema = "dogfood-native-db-request/v1"
$NativeDbReplySchema = "dogfood-native-db-reply/v1"
$NativeDbProfile = "reconciliation-pg16/v1"
$NativeDbRequestKeys = @(
  "schemaVersion", "correlation", "profile", "run", "issue", "attempt",
  "executorHead", "product", "declaration", "patchDigests", "stagedInputDirectory"
)
$NativeDbReplyKeys = @("schemaVersion", "correlation", "status", "owner", "evidencePath", "diagnostic")
$Utf8 = [System.Text.UTF8Encoding]::new($false)

function Start-PoolBridges {
  param([Parameter(Mandatory)][string]$Bridge)
  # 8317 carries inference; 8318 the read-only pool status the loop reads before each launch.
  $ports = @(8317, 8318)
  $adapter = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -like "vEthernet (WSL*" } |
    Select-Object -First 1
  if (-not $adapter) { throw "WSL host adapter not found; is WSL running?" }
  $address = $adapter.IPAddress
  foreach ($port in $ports) {
    $listening = Get-NetTCPConnection -State Listen -LocalAddress $address -LocalPort $port -ErrorAction SilentlyContinue
    if (-not $listening) {
      Start-Process -FilePath "node" -ArgumentList @($Bridge, $address, $port) -WindowStyle Hidden
      Start-Sleep -Seconds 1
      Write-Host "pool bridge started on ${address}:$port"
    } else {
      Write-Host "pool bridge already listening on ${address}:$port"
    }
  }
}

function Invoke-Git {
  param([string]$Worktree, [string[]]$Arguments)
  $output = & git -C $Worktree @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed in $Worktree" }
  return ($output | Out-String).Trim()
}

# The anchor is read at request time: a clean worktree on a live branch, its
# exact head, the ROOT container's canonical wrapper and an ignored artifact
# directory. Returns $null when unsupported; that is a typed refusal, never authority.
function Resolve-NativeDbAnchor {
  param([string]$VerifierWorktree)
  if (-not $VerifierWorktree) { return $null }
  if (-not (Test-Path -LiteralPath $VerifierWorktree -PathType Container)) { return $null }
  try {
    $worktree = (Resolve-Path -LiteralPath $VerifierWorktree).ProviderPath
    $branch = Invoke-Git -Worktree $worktree -Arguments @("rev-parse", "--abbrev-ref", "HEAD")
    if (-not $branch -or $branch -eq "HEAD") { return $null }
    $head = Invoke-Git -Worktree $worktree -Arguments @("rev-parse", "HEAD")
    if ($head -notmatch '^[0-9a-f]{40}$') { return $null }
    if (Invoke-Git -Worktree $worktree -Arguments @("status", "--porcelain")) { return $null }
    $common = Invoke-Git -Worktree $worktree -Arguments @("rev-parse", "--path-format=absolute", "--git-common-dir")
    $root = Split-Path -Parent $common
    $artifacts = Join-Path $worktree ".orchestrator" "native-db"
    & git -C $worktree check-ignore -q -- $artifacts 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { return $null }
    return [pscustomobject]@{
      Worktree = $worktree
      Branch = $branch
      Head = $head
      Root = $root
      Wrapper = Join-Path $root ".orchestrator" "invoke-heavy-verifier.ps1"
      Artifacts = $artifacts
    }
  } catch {
    return $null
  }
}

function Test-Integer {
  param($Value, [long]$Minimum, [long]$Maximum)
  if ($Value -isnot [int] -and $Value -isnot [long]) { return $false }
  return ([long]$Value -ge $Minimum -and [long]$Value -le $Maximum)
}

# Bound run, correlation order and the closed top-level shape. The supervisor
# validated the full closed request before sending it; the incumbent validates
# its own input again. Returns $null when accepted, otherwise the diagnostic.
function Test-NativeDbRequest {
  param($Message, [string]$BoundRun, [long]$LastCorrelation)
  $names = @($Message.PSObject.Properties.Name)
  foreach ($key in $NativeDbRequestKeys) {
    if ($names -notcontains $key) { return "native-db-request-invalid: request.$key is required" }
  }
  foreach ($name in $names) {
    if ($NativeDbRequestKeys -notcontains $name) { return "native-db-request-invalid: request.$name is not a v1 key" }
  }
  if ($Message.profile -ne $NativeDbProfile) { return "native-db-request-invalid: request.profile" }
  if (-not (Test-Integer -Value $Message.correlation -Minimum 1 -Maximum 9007199254740991)) {
    return "native-db-request-invalid: request.correlation"
  }
  if ([long]$Message.correlation -le $LastCorrelation) { return "native-db-request-invalid: request.correlation is not increasing" }
  if ($Message.run -isnot [string] -or $Message.run -notmatch '^[A-Za-z0-9._:-]{1,128}$') {
    return "native-db-request-invalid: request.run"
  }
  if ($BoundRun -and $Message.run -ne $BoundRun) { return "native-db-request-invalid: request.run is not the bound run" }
  foreach ($key in @("issue", "attempt")) {
    if (-not (Test-Integer -Value $Message.$key -Minimum 1 -Maximum 2147483647)) {
      return "native-db-request-invalid: request.$key"
    }
  }
  if ($Message.executorHead -isnot [string] -or $Message.executorHead -notmatch '^[0-9a-f]{40}$') {
    return "native-db-request-invalid: request.executorHead"
  }
  foreach ($key in @("product", "declaration")) {
    if ($Message.$key -isnot [System.Management.Automation.PSCustomObject]) {
      return "native-db-request-invalid: request.$key must be an object"
    }
  }
  if ($Message.patchDigests -isnot [array]) { return "native-db-request-invalid: request.patchDigests must be a list" }
  if ($Message.stagedInputDirectory -isnot [string] -or -not [System.IO.Path]::IsPathRooted($Message.stagedInputDirectory)) {
    return "native-db-request-invalid: request.stagedInputDirectory must be absolute"
  }
  return $null
}

function New-NativeDbReply {
  param([long]$Correlation, [string]$Status, [string]$Diagnostic)
  return [ordered]@{
    schemaVersion = $NativeDbReplySchema
    correlation = $Correlation
    status = $Status
    owner = $null
    evidencePath = $null
    diagnostic = $Diagnostic
  }
}

# Writes the request under the anchor's ignored artifacts and invokes the
# incumbent wrapper in branch mode. The wrapper answers through
# <request>.reply.json; a missing or foreign reply is unknown, never completion.
function Invoke-NativeDbRequest {
  param([string]$Line, $Message, $Anchor, [long]$Correlation)
  if (-not $Anchor) { return New-NativeDbReply -Correlation $Correlation -Status "refused" -Diagnostic "native-db-anchor-unsupported" }
  if (-not (Test-Path -LiteralPath $Anchor.Wrapper -PathType Leaf)) {
    return New-NativeDbReply -Correlation $Correlation -Status "refused" -Diagnostic "native-db-runner-absent"
  }
  try {
    New-Item -ItemType Directory -Force -Path $Anchor.Artifacts | Out-Null
    $requestPath = Join-Path $Anchor.Artifacts ("{0}-{1}.json" -f $Message.run, $Correlation)
    [System.IO.File]::WriteAllText($requestPath, $Line + "`n", $Utf8)
    $replyPath = "$requestPath.reply.json"
    if (Test-Path -LiteralPath $replyPath) { Remove-Item -LiteralPath $replyPath -Force }
    & $Anchor.Wrapper -NativeDbProfile $NativeDbProfile -NativeRequestPath $requestPath -Worktree $Anchor.Worktree -Lane $Message.run -Branch $Anchor.Branch -ClaimedHead $Anchor.Head | Out-Host
    if (-not (Test-Path -LiteralPath $replyPath -PathType Leaf)) {
      return New-NativeDbReply -Correlation $Correlation -Status "unknown" -Diagnostic "native-db-runner-no-reply"
    }
    $reply = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($replyPath, $Utf8))
    $names = @($reply.PSObject.Properties.Name)
    $closed = ($names.Count -eq $NativeDbReplyKeys.Count) -and -not @($NativeDbReplyKeys | Where-Object { $names -notcontains $_ })
    if (-not $closed -or $reply.schemaVersion -ne $NativeDbReplySchema -or [long]$reply.correlation -ne $Correlation) {
      return New-NativeDbReply -Correlation $Correlation -Status "unknown" -Diagnostic "native-db-runner-reply-invalid"
    }
    if ($null -ne $reply.evidencePath -and -not $reply.evidencePath.StartsWith($Anchor.Worktree + [System.IO.Path]::DirectorySeparatorChar)) {
      return New-NativeDbReply -Correlation $Correlation -Status "unknown" -Diagnostic "native-db-runner-evidence-outside-anchor"
    }
    return [ordered]@{
      schemaVersion = $NativeDbReplySchema
      correlation = $Correlation
      status = $reply.status
      owner = $reply.owner
      evidencePath = $reply.evidencePath
      diagnostic = $reply.diagnostic
    }
  } catch {
    $text = ("native-db-runner-failed: " + $_.Exception.Message)
    if ($text.Length -gt 2048) { $text = $text.Substring(0, 2048) }
    return New-NativeDbReply -Correlation $Correlation -Status "unknown" -Diagnostic $text
  }
}

# One attached supervisor. Returns its exit code.
function Start-AttachedSupervisor {
  param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string[]]$ArgumentList,
    [string]$VerifierWorktree = ""
  )
  $info = [System.Diagnostics.ProcessStartInfo]::new($Executable)
  foreach ($argument in $ArgumentList) { $info.ArgumentList.Add($argument) }
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardInputEncoding = $Utf8
  $info.StandardOutputEncoding = $Utf8
  $info.StandardErrorEncoding = $Utf8
  # Nothing from this Windows environment is forwarded into the distribution.
  $info.Environment["WSLENV"] = ""
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "supervisor did not start: $Executable" }
  $process.StandardInput.NewLine = "`n"
  # Drained concurrently so a full stderr can never block the protocol stream.
  $stderr = $process.StandardError.ReadToEndAsync()
  $boundRun = ""
  $lastCorrelation = [long]0
  try {
    while ($null -ne ($line = $process.StandardOutput.ReadLine())) {
      $message = $null
      try { $message = ConvertFrom-Json -InputObject $line } catch { $message = $null }
      if ($message -isnot [System.Management.Automation.PSCustomObject]) {
        [Console]::Error.WriteLine("unaccepted protocol line: $line")
        continue
      }
      $names = @($message.PSObject.Properties.Name)
      if ($names -notcontains "schemaVersion" -or $message.schemaVersion -ne $NativeDbRequestSchema) {
        Write-Host $line
        continue
      }
      $diagnostic = Test-NativeDbRequest -Message $message -BoundRun $boundRun -LastCorrelation $lastCorrelation
      $correlation = [long]0
      if (Test-Integer -Value $message.correlation -Minimum 1 -Maximum 9007199254740991) { $correlation = [long]$message.correlation }
      if ($diagnostic) {
        $reply = New-NativeDbReply -Correlation $correlation -Status "refused" -Diagnostic $diagnostic
      } else {
        $boundRun = $message.run
        $lastCorrelation = $correlation
        $anchor = Resolve-NativeDbAnchor -VerifierWorktree $VerifierWorktree
        $reply = Invoke-NativeDbRequest -Line $line -Message $message -Anchor $anchor -Correlation $correlation
      }
      $process.StandardInput.WriteLine((ConvertTo-Json -InputObject $reply -Compress -Depth 4))
      $process.StandardInput.Flush()
    }
  } finally {
    if (-not $process.HasExited) {
      try { $process.StandardInput.Close() } catch { }
      if (-not $process.WaitForExit(5000)) { $process.Kill() }
    }
  }
  $process.WaitForExit()
  $errors = $stderr.GetAwaiter().GetResult()
  if ($errors) { [Console]::Error.Write($errors) }
  return $process.ExitCode
}

# Dot-sourced by tests for its functions only; the canonical start runs below.
if ($MyInvocation.InvocationName -eq ".") { return }

Start-PoolBridges -Bridge (Join-Path $PSScriptRoot "pool-bridge.mjs")
$code = Start-AttachedSupervisor `
  -Executable "C:\Windows\System32\wsl.exe" `
  -ArgumentList @("-d", "Ubuntu", "--", "bash", "/root/orchestration-m1/repo/scripts/executor/run-loop.sh", $Config) `
  -VerifierWorktree $VerifierWorktree
exit $code
