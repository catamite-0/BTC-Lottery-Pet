[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$InstallerPath,

  [string]$ExpectedSignerSubject,

  [switch]$AllowUnsignedTestArtifact
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command "Get-AuthenticodeSignature" -ErrorAction SilentlyContinue)) {
  throw "Get-AuthenticodeSignature is required. Run this guard on Windows."
}

$installer = Get-Item -LiteralPath $InstallerPath -ErrorAction Stop
if ($installer.PSIsContainer -or $installer.Extension -ine ".exe") {
  throw "InstallerPath must identify a Windows .exe file."
}

$signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
$status = [string]$signature.Status

if ($status -eq "Valid") {
  $signatureType = [string]$signature.SignatureType
  if ($signatureType -ne "Authenticode") {
    throw "The installer must carry an embedded Authenticode signature. Catalog signatures are not release eligible."
  }

  if ($null -eq $signature.SignerCertificate) {
    throw "The installer reports a valid signature but has no signer certificate."
  }

  if ($null -eq $signature.TimeStamperCertificate) {
    throw "The installer signature is valid but has no trusted timestamp."
  }

  $actualSignerSubject = [string]$signature.SignerCertificate.Subject
  if ([string]::IsNullOrWhiteSpace($ExpectedSignerSubject)) {
    throw "ExpectedSignerSubject is required to validate a signed installer."
  }
  if (-not [string]::Equals(
    $ExpectedSignerSubject.Trim(),
    $actualSignerSubject.Trim(),
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "The installer signer does not match the expected release publisher."
  }

  if ($AllowUnsignedTestArtifact) {
    Write-Warning "SIGNED TEST ARTIFACT ONLY. Manual-dispatch validation is never release eligible."
    return [pscustomobject]@{
      Status = $status
      SignatureType = $signatureType
      HasTimestamp = $true
      SignerMatched = $true
      ReleaseEligible = $false
    }
  }

  Write-Host "Installer embedded Authenticode signature, publisher, and timestamp are valid." -ForegroundColor Green
  return [pscustomobject]@{
    Status = $status
    SignatureType = $signatureType
    HasTimestamp = $true
    SignerMatched = $true
    ReleaseEligible = $true
  }
}

if ($status -eq "NotSigned" -and $AllowUnsignedTestArtifact) {
  Write-Warning "UNSIGNED TEST ARTIFACT ONLY. Do not publish or distribute this installer."
  return [pscustomobject]@{
    Status = $status
    SignatureType = [string]$signature.SignatureType
    HasTimestamp = $false
    SignerMatched = $false
    ReleaseEligible = $false
  }
}

if ($status -eq "NotSigned") {
  throw "The installer is not Authenticode signed. Tagged releases require a valid, timestamped signature."
}

throw "Installer Authenticode validation failed with status '$status'."
