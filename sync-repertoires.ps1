# Copie les repertoires d'En Croissant dans l'extension (data/repertoires).
# A relancer apres avoir modifie un repertoire dans En Croissant (double-clic sur sync-repertoires.bat).
$ErrorActionPreference = 'Stop'
$src = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'EnCroissant'
$dst = Join-Path $PSScriptRoot 'data\repertoires'
if (-not (Test-Path $src)) { Write-Host "Dossier En Croissant introuvable ($src) : rien a synchroniser."; exit 0 }
New-Item -ItemType Directory -Force $dst | Out-Null
Get-ChildItem $dst -Filter *.pgn | Remove-Item -Force

$index = @()
if (Test-Path $src) {
  foreach ($info in Get-ChildItem $src -Filter *.info) {
    try { $meta = Get-Content $info.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
    if ($meta.type -ne 'repertoire') { continue }
    $pgn = Join-Path $src ($info.BaseName + '.pgn')
    if (-not (Test-Path $pgn)) { continue }
    $safe = ($info.BaseName -replace '[^\w\- ]', '_') + '.pgn'
    Copy-Item $pgn (Join-Path $dst $safe) -Force
    $index += [ordered]@{ file = $safe; name = $info.BaseName; modified = (Get-Item $pgn).LastWriteTimeUtc.ToString('o') }
  }
}
$json = ConvertTo-Json @($index) -Depth 3
[IO.File]::WriteAllText((Join-Path $dst 'index.json'), $json, (New-Object Text.UTF8Encoding $false))
Write-Host "$($index.Count) repertoire(s) synchronise(s) depuis $src"
