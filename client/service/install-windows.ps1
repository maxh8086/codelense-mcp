# Installs synaptree-client as a Windows service with NSSM (https://nssm.cc). Run in an elevated PowerShell.
# usage: .\install-windows.ps1 -Config C:\synaptree\synaptree-client.json -Install C:\synaptree-mcp
param(
  [Parameter(Mandatory)] [string] $Config,
  [Parameter(Mandatory)] [string] $Install
)
$node = (Get-Command node -ErrorAction Stop).Source
nssm install synaptree-client $node "$Install\client\synaptree-client.js" $Config
nssm set synaptree-client AppDirectory $Install
nssm set synaptree-client AppStderr "$env:ProgramData\synaptree-client.log"
nssm set synaptree-client Start SERVICE_AUTO_START
nssm start synaptree-client
