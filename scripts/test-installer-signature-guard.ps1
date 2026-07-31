[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$guardPath = Join-Path $PSScriptRoot "verify-installer-signature.ps1"
$signedHostPath = (Get-Process -Id $PID).Path
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "btc-lottery-pet-signature-guard-$([guid]::NewGuid().ToString('N'))"
$unsignedPath = Join-Path $tempRoot "unsigned.exe"
$tamperedPath = Join-Path $tempRoot "tampered.exe"

function Assert-Fails {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [scriptblock]$Action,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedMessage
  )

  try {
    & $Action
  } catch {
    if ($_.Exception.Message -notlike "*$ExpectedMessage*") {
      throw "$Name failed with an unexpected message: $($_.Exception.Message)"
    }
    return
  }

  throw "$Name unexpectedly succeeded."
}

New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null

try {
  $typeName = "UnsignedFixture$([guid]::NewGuid().ToString('N'))"
  Add-Type `
    -TypeDefinition "public sealed class $typeName { public static int Value = 1; }" `
    -OutputAssembly $unsignedPath | Out-Null

  Assert-Fails `
    -Name "Strict unsigned rejection" `
    -ExpectedMessage "not Authenticode signed" `
    -Action { & $guardPath -InstallerPath $unsignedPath }

  $unsignedResult = & $guardPath `
    -InstallerPath $unsignedPath `
    -AllowUnsignedTestArtifact
  if ($unsignedResult.Status -ne "NotSigned" -or $unsignedResult.ReleaseEligible) {
    throw "Unsigned test-artifact handling returned an unsafe result."
  }

  $signedHostSignature = Get-AuthenticodeSignature -LiteralPath $signedHostPath
  if (
    $signedHostSignature.Status -ne "Valid" -or
    $signedHostSignature.SignatureType -ne "Authenticode" -or
    $null -eq $signedHostSignature.SignerCertificate -or
    $null -eq $signedHostSignature.TimeStamperCertificate
  ) {
    throw "The signed host executable is not a usable embedded-signature test fixture."
  }
  $fixtureSignerSubject = [string]$signedHostSignature.SignerCertificate.Subject

  Assert-Fails `
    -Name "Missing expected publisher rejection" `
    -ExpectedMessage "ExpectedSignerSubject is required to validate a signed installer" `
    -Action { & $guardPath -InstallerPath $signedHostPath }

  Assert-Fails `
    -Name "Wrong publisher rejection" `
    -ExpectedMessage "does not match the expected release publisher" `
    -Action {
      & $guardPath `
        -InstallerPath $signedHostPath `
        -ExpectedSignerSubject "CN=Deliberately Wrong Test Publisher"
    }

  $signedResult = & $guardPath `
    -InstallerPath $signedHostPath `
    -ExpectedSignerSubject $fixtureSignerSubject
  if (
    $signedResult.Status -ne "Valid" -or
    $signedResult.SignatureType -ne "Authenticode" -or
    -not $signedResult.HasTimestamp -or
    -not $signedResult.SignerMatched -or
    -not $signedResult.ReleaseEligible
  ) {
    throw "The matching signed, timestamped fixture was not release eligible."
  }

  $boundSignedTestResult = & $guardPath `
    -InstallerPath $signedHostPath `
    -ExpectedSignerSubject $fixtureSignerSubject `
    -AllowUnsignedTestArtifact
  if (
    $boundSignedTestResult.Status -ne "Valid" -or
    $boundSignedTestResult.SignatureType -ne "Authenticode" -or
    -not $boundSignedTestResult.HasTimestamp -or
    -not $boundSignedTestResult.SignerMatched -or
    $boundSignedTestResult.ReleaseEligible
  ) {
    throw "A signed manual-dispatch artifact was incorrectly made release eligible."
  }

  Assert-Fails `
    -Name "Unbound signed manual artifact rejection" `
    -ExpectedMessage "ExpectedSignerSubject is required to validate a signed installer" `
    -Action {
      & $guardPath `
        -InstallerPath $signedHostPath `
        -AllowUnsignedTestArtifact
    }

  Assert-Fails `
    -Name "Wrong-publisher signed manual artifact rejection" `
    -ExpectedMessage "does not match the expected release publisher" `
    -Action {
      & $guardPath `
        -InstallerPath $signedHostPath `
        -ExpectedSignerSubject "CN=Deliberately Wrong Test Publisher" `
        -AllowUnsignedTestArtifact
    }
  $catalogPath = Join-Path $env:SystemRoot "System32\notepad.exe"
  if (Test-Path -LiteralPath $catalogPath -PathType Leaf) {
    $catalogSignature = Get-AuthenticodeSignature -LiteralPath $catalogPath
    if (
      $catalogSignature.Status -eq "Valid" -and
      $catalogSignature.SignatureType -eq "Catalog" -and
      $null -ne $catalogSignature.SignerCertificate
    ) {
      Assert-Fails `
        -Name "Catalog signature rejection" `
        -ExpectedMessage "embedded Authenticode signature" `
        -Action {
          & $guardPath `
            -InstallerPath $catalogPath `
            -ExpectedSignerSubject $catalogSignature.SignerCertificate.Subject
        }
    } else {
      Write-Warning "Catalog-signature fixture unavailable; catalog rejection integration test skipped."
    }
  }

  Copy-Item -LiteralPath $signedHostPath -Destination $tamperedPath -ErrorAction Stop
  $stream = [IO.File]::Open($tamperedPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite)
  try {
    if ($stream.Length -lt 2048) {
      throw "The signed positive-control executable is unexpectedly small."
    }
    $stream.Position = 1024
    $originalByte = $stream.ReadByte()
    $stream.Position = 1024
    $stream.WriteByte($originalByte -bxor 0xff)
  } finally {
    $stream.Dispose()
  }

  Assert-Fails `
    -Name "Tampered signature rejection" `
    -ExpectedMessage "validation failed" `
    -Action {
      & $guardPath `
        -InstallerPath $tamperedPath `
        -AllowUnsignedTestArtifact
    }

  Write-Host "Installer signature guard tests passed." -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $unsignedPath) {
    Remove-Item -LiteralPath $unsignedPath -Force
  }
  if (Test-Path -LiteralPath $tamperedPath) {
    Remove-Item -LiteralPath $tamperedPath -Force
  }
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Force
  }
}
