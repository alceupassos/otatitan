# Envia o código do Otatitan para o servidor de produção e roda o deploy.
#
#   .\scripts\push-to-server.ps1                 # envia e faz deploy
#   .\scripts\push-to-server.ps1 -SkipDeploy     # só envia
#
# Não há remote git configurado, então o transporte é um tar do que está
# versionado (`git archive`) — o que garante que nada ignorado pelo
# .gitignore (a começar pelo .env de desenvolvimento) viaje junto.
#
# As credenciais vêm do .env do projeto (SSH/PWD_SSH), como define
# docs/13-deploy-producao.md. A senha é lida em tempo de execução e nunca
# impressa.
param(
  [string]$ServerHost = '169.58.71.28',
  [string]$RemoteDir = '/opt/otatitan',
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'
Import-Module Posh-SSH -ErrorAction Stop

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'

$pass = ((Get-Content $envPath | Where-Object { $_ -match '^PWD_SSH=' }) -replace '^PWD_SSH=', '').Trim()
if (-not $pass) { throw 'PWD_SSH não encontrada no .env' }

$cred = New-Object System.Management.Automation.PSCredential(
  'root', (ConvertTo-SecureString $pass -AsPlainText -Force))

# ── 1. Empacotar o que está versionado ────────────────────────────────────
$tar = Join-Path $env:TEMP 'otatitan-deploy.tar'
Push-Location $projectRoot
try {
  git archive --format=tar -o $tar HEAD
} finally {
  Pop-Location
}
Write-Host "→ Pacote: $([math]::Round((Get-Item $tar).Length / 1MB, 1)) MB"

# ── 2. Enviar ─────────────────────────────────────────────────────────────
$session = New-SSHSession -ComputerName $ServerHost -Credential $cred -AcceptKey -ConnectionTimeout 30
try {
  Invoke-SSHCommand -SSHSession $session -Command "mkdir -p $RemoteDir" | Out-Null

  Set-SCPItem -ComputerName $ServerHost -Credential $cred -AcceptKey `
    -Path $tar -Destination '/tmp' -Force
  Write-Host '→ Enviado.'

  # -m preserva o mtime do arquivo enviado em vez de carimbar "agora", o
  # que mantém o cache de camadas do Docker útil entre deploys.
  $extract = "cd $RemoteDir && tar -xf /tmp/otatitan-deploy.tar && rm -f /tmp/otatitan-deploy.tar && chmod +x scripts/deploy.sh scripts/db-init/*.sh && echo EXTRAIDO"
  $r = Invoke-SSHCommand -SSHSession $session -Command $extract -TimeOut 300
  $r.Output
  if ($r.ExitStatus -ne 0) { $r.Error; throw "Falha ao extrair (exit $($r.ExitStatus))" }

  if ($SkipDeploy) {
    Write-Host '→ -SkipDeploy: não executei o deploy.'
    return
  }

  Write-Host '→ Rodando deploy no servidor (pode levar alguns minutos)...'
  $d = Invoke-SSHCommand -SSHSession $session -Command "cd $RemoteDir && ./scripts/deploy.sh 2>&1" -TimeOut 1800
  $d.Output
  if ($d.ExitStatus -ne 0) { throw "Deploy falhou (exit $($d.ExitStatus))" }
} finally {
  Remove-SSHSession -SSHSession $session | Out-Null
  Remove-Item $tar -ErrorAction SilentlyContinue
}
