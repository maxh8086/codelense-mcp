# Installs codelense-client as a Windows service with NSSM (https://nssm.cc). Run in an elevated PowerShell.
# usage: .\install-windows.ps1 -Config C:\codelense\codelense-client.json -Install C:\codelense-mcp
param(
  [Parameter(Mandatory)] [string] $Config,
  [Parameter(Mandatory)] [string] $Install
)
$node = (Get-Command node -ErrorAction Stop).Source
nssm install codelense-client $node "$Install\client\codelense-client.js" $Config
nssm set codelense-client AppDirectory $Install
nssm set codelense-client AppStderr "$env:ProgramData\codelense-client.log"
nssm set codelense-client Start SERVICE_AUTO_START
nssm start codelense-client
