# Envoie le projet vers le serveur Google Cloud et redémarre le jeu.
#
# À lancer depuis ton PC, à la racine du projet :
#   npm run push
#
# Le client est compilé ICI, pas là-bas : la machine gratuite n'a qu'1 Go de
# mémoire et un cœur partagé, où la compilation prend des minutes. Autant
# l'envoyer toute faite.
#
# Rien d'important n'est écrasé : `server/data` reste sur le serveur, donc les
# scores, les mots ajoutés et l'historique anti-répétition survivent.

param(
  [string]$Instance = $env:GCP_INSTANCE,
  [string]$Zone     = $env:GCP_ZONE,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

# Le serveur parle UTF-8 ; sans ça la console Windows rend sa sortie en
# charabia et on croit à une erreur là où il n'y en a pas.
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

if (-not $Instance) { $Instance = 'undercover' }
if (-not $Zone)     { $Zone = 'us-central1-a' }

function Step($t) { Write-Host "`n▸ $t" -ForegroundColor Cyan }

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Host "`n  gcloud est introuvable." -ForegroundColor Red
  Write-Host "  Installe le SDK : https://cloud.google.com/sdk/docs/install`n"
  exit 1
}

if (-not $SkipBuild) {
  Step "Compilation du client"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "La compilation a échoué." }
}

Step "Préparation de l'archive"
$staging = Join-Path $env:TEMP "undercover-push"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

# Tout sauf ce qui doit rester local ou se régénérer là-bas.
$exclude = @('node_modules', '.git', 'simulations', 'tests', '.scratch')
Get-ChildItem -Path . -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  Copy-Item $_.FullName -Destination $staging -Recurse -Force
}
# Les données de la maison n'ont rien à faire dans l'envoi : celles du serveur
# font autorité, et les écraser effacerait les scores de la soirée.
Remove-Item (Join-Path $staging 'server\data\state.json') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $staging 'server\data\custom-words.json') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $staging 'server\data\env') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $staging 'server\data\tunnel.json') -Force -ErrorAction SilentlyContinue

$archive = Join-Path $env:TEMP "undercover.tar.gz"
if (Test-Path $archive) { Remove-Item $archive -Force }
tar -czf $archive -C $staging .
$size = "{0:N1} Mo" -f ((Get-Item $archive).Length / 1MB)
Write-Host "  archive : $size"

Step "Envoi vers $Instance ($Zone)"
gcloud compute scp $archive "${Instance}:/tmp/undercover.tar.gz" --zone $Zone
if ($LASTEXITCODE -ne 0) { throw "L'envoi a échoué." }

Step "Installation et redémarrage"
# Tenu sur UNE seule ligne : `gcloud compute ssh` découpe son argument sur les
# retours à la ligne, si bien qu'un script multiligne arrive en morceaux et que
# la moitié se retrouve interprétée comme des options de gcloud. Tout ce qui
# dépasse une ligne vit dans server-update.sh, envoyé avec le reste.
$remote = 'mkdir -p ~/undercover && tar -xzf /tmp/undercover.tar.gz -C ~/undercover && rm -f /tmp/undercover.tar.gz && bash ~/undercover/scripts/server-update.sh'

gcloud compute ssh $Instance --zone $Zone --command $remote
if ($LASTEXITCODE -ne 0) { throw "Le redémarrage a échoué." }

Write-Host "`n✅ Déployé.`n" -ForegroundColor Green
