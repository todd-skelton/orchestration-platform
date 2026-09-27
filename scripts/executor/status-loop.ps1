# Read-only Windows entry for ISS-136. Does not start the bridge or supervisor.
param(
  [string]$Config = "/root/orchestration-m1/loop.json",
  [string]$ExecutorRoot = "/root/orchestration-m1/repo",
  [switch]$Json
)
$ErrorActionPreference = "Stop"
$info = [System.Diagnostics.ProcessStartInfo]::new()
$info.FileName = "C:\Windows\System32\wsl.exe"
$info.UseShellExecute = $false
$info.RedirectStandardOutput = $true
$info.Environment["WSLENV"] = ""
# Pass paths as arguments, never interpolate them into shell code.
$arguments = @("-d", "Ubuntu", "--", "bash", "-c",
  'export PATH="/root/orchestration-m1/tools/git/bin:/root/orchestration-m1/tools/node-v24.15.0-linux-x64/bin:/root/orchestration-m1/tools/gh_2.93.0_linux_amd64/bin:$PATH"; exec node "$@"',
  "loop-status", "$ExecutorRoot/scripts/dogfood/status.mjs", $Config)
if ($Json) { $arguments += "--json" }
foreach ($argument in $arguments) { $info.ArgumentList.Add($argument) }
try {
  $child = [System.Diagnostics.Process]::Start($info)
  $output = $child.StandardOutput.ReadToEnd()
  $child.WaitForExit()
  if ([string]::IsNullOrWhiteSpace($output)) { throw "WSL returned no status (exit $($child.ExitCode)); evidence unavailable" }
  if ($Json) { $null = $output | ConvertFrom-Json -ErrorAction Stop }
  Write-Output $output.TrimEnd()
  exit $child.ExitCode
} catch {
  $result = @{ status = "unavailable"; observedAt = [DateTime]::UtcNow.ToString("o"); diagnostic = $_.Exception.Message }
  if ($Json) { $result | ConvertTo-Json -Compress } else { Write-Output "Status unavailable: $($result.diagnostic)" }
  exit 1
}
