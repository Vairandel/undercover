# Opens the game port on the Windows firewall for private (home) networks only.
# Must be run from an elevated PowerShell — right-click > "Run as administrator".

param(
    [int]$Port = 3000
)

$ruleName = "Undercover LAN ($Port)"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "  Cette commande doit etre lancee en administrateur." -ForegroundColor Yellow
    Write-Host "  Ouvre PowerShell avec 'Executer en tant qu'administrateur', puis :" -ForegroundColor Yellow
    Write-Host "    cd '$PSScriptRoot\..'" -ForegroundColor Cyan
    Write-Host "    npm run firewall" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "  La regle '$ruleName' existe deja. Rien a faire." -ForegroundColor Green
    exit 0
}

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private `
    -Description "Autorise les telephones du wifi a rejoindre la partie Undercover." | Out-Null

Write-Host ""
Write-Host "  Regle creee : le port $Port est ouvert sur ton reseau prive." -ForegroundColor Green
Write-Host "  Pour la retirer plus tard :" -ForegroundColor DarkGray
Write-Host "    Remove-NetFirewallRule -DisplayName '$ruleName'" -ForegroundColor DarkGray
Write-Host ""
