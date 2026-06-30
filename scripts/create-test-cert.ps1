<#
.SYNOPSIS
  Creates a self-signed code-signing certificate for LOCAL TESTING of the
  FluxNode signing pipeline.

.DESCRIPTION
  This cert is NOT trusted by Windows SmartScreen — installs signed with it
  still show a warning unless the cert is manually trusted on the machine.
  Use it only to verify that `tauri build` signing works end to end. For real
  distribution, buy an EV cert or use Azure Trusted Signing (see SIGNING.md).

  Prints the thumbprint to paste into tauri.conf.json
  (bundle.windows.certificateThumbprint).
#>
param(
  [string]$Subject = 'CN=FluxNode (TEST — do not ship)',
  [int]$ValidYears = 3
)

$ErrorActionPreference = 'Stop'

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyUsage DigitalSignature `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears($ValidYears)

Write-Host "Created self-signed code-signing certificate." -ForegroundColor Green
Write-Host "  Subject   : $($cert.Subject)"
Write-Host "  Thumbprint: $($cert.Thumbprint)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Paste the thumbprint into tauri.conf.json -> bundle.windows.certificateThumbprint"
Write-Host "Reminder: self-signed builds still trigger SmartScreen. See SIGNING.md." -ForegroundColor Yellow
