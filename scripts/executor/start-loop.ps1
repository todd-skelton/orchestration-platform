# Starts the loop on the WSL Ubuntu executor from Windows.
# Ensures the pool bridge is listening on the WSL-facing host address first,
# so workers on the executor can reach the local subscription pool.
param([string]$Config = "/root/orchestration-m1/loop.json")

$ErrorActionPreference = "Stop"
# 8317 carries inference; 8318 the read-only pool status the loop reads before each launch.
$ports = @(8317, 8318)
$adapter = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -like "vEthernet (WSL*" } |
  Select-Object -First 1
if (-not $adapter) { throw "WSL host adapter not found; is WSL running?" }
$address = $adapter.IPAddress

$bridge = Join-Path $PSScriptRoot "pool-bridge.mjs"
foreach ($port in $ports) {
  $listening = Get-NetTCPConnection -State Listen -LocalAddress $address -LocalPort $port -ErrorAction SilentlyContinue
  if (-not $listening) {
    Start-Process -FilePath "node" -ArgumentList @($bridge, $address, $port) -WindowStyle Hidden
    Start-Sleep -Seconds 1
    Write-Host "pool bridge started on ${address}:$port"
  } else {
    Write-Host "pool bridge already listening on ${address}:$port"
  }
}

wsl -d Ubuntu -- bash /root/orchestration-m1/repo/scripts/executor/run-loop.sh $Config
