# Publicar.ps1 - de la carpeta del escritorio al telefono, en una orden.
#
#   1. sube los cambios a GitHub
#   2. GitHub Actions republica app/ en GitHub Pages (un par de minutos)
#   3. el telefono abre https://miguelarc0401.github.io/Lector/
#
# Es el de Liturgicum sin los pasos de datos: Lector no tiene nada que
# rehacer antes de subir, los libros viven en el telefono.
#
# Uso:   .\publicar.ps1
#        .\publicar.ps1 -Mensaje "afino el adelanto de la voz"

param(
    [string]$Mensaje = ""
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Test-Path ".git")) {
    throw "Esta carpeta todavia no es un repositorio git."
}

git add -A
$hayCambios = git status --porcelain
if (-not $hayCambios) {
    Write-Host "`nNo hay nada que subir." -ForegroundColor Yellow
    exit 0
}

# Lo mismo que en Liturgicum: si se cuela algo gordo -un libro, un PDF de
# prueba-, se avisa antes de que quede en la historia para siempre.
$umbralMB = 5
$gordos = @()
foreach ($ruta in (git diff --cached --name-only --diff-filter=AM)) {
    if (Test-Path -LiteralPath $ruta -PathType Leaf) {
        $mb = (Get-Item -LiteralPath $ruta).Length / 1MB
        if ($mb -ge $umbralMB) { $gordos += [pscustomobject]@{ MB = $mb; Ruta = $ruta } }
    }
}
if ($gordos.Count -gt 0) {
    Write-Host ""
    Write-Host ("Van a entrar {0} fichero(s) de mas de {1} MB:" -f $gordos.Count, $umbralMB) -ForegroundColor Yellow
    foreach ($g in ($gordos | Sort-Object -Property MB -Descending)) {
        Write-Host ("   {0,8:N1} MB  {1}" -f $g.MB, $g.Ruta)
    }
    $r = Read-Host "Subirlos de todos modos? (escribe si)"
    if ($r -notin @("si", "SI", "Si", "s", "S", "yes", "y")) {
        git reset --quiet
        Write-Host "`nNo se ha subido nada." -ForegroundColor Yellow
        exit 1
    }
}

if (-not $Mensaje) {
    $Mensaje = "Actualizo Lector ({0})" -f (Get-Date -Format "yyyy-MM-dd HH:mm")
}
git commit -m $Mensaje
if ($LASTEXITCODE -ne 0) { throw "git commit fallo" }

git push
if ($LASTEXITCODE -ne 0) { throw "git push fallo" }

Write-Host "`nSubido. GitHub Pages tarda un par de minutos en republicar." -ForegroundColor Green
Write-Host "Luego: https://miguelarc0401.github.io/Lector/"
