#!/usr/bin/env bash
#
# Installe la version qui vient d'être envoyée et redémarre le jeu.
#
# Existe en tant que fichier plutôt qu'en commande passée à `gcloud ssh` :
# celui-ci découpe son argument sur les retours à la ligne, si bien qu'un script
# multiligne arrive sur le serveur en morceaux. Un fichier n'a pas ce problème.
#
# Appelé par `npm run push`, mais utilisable seul depuis le serveur.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "  Dépendances…"
# Le client est déjà compilé et envoyé tout fait : rien à construire ici, où
# une machine à 1 Go y passerait des minutes.
npm ci --omit=dev --ignore-scripts >/dev/null 2>&1 || npm install --omit=dev >/dev/null 2>&1

if [[ ! -f client/dist/index.html ]]; then
  echo "  ⚠️  client/dist absent — le jeu servira une page d'attente."
  echo "     Relance « npm run push » depuis ton PC sans --SkipBuild."
fi

if systemctl list-unit-files undercover.service >/dev/null 2>&1 &&
   [[ -f /etc/systemd/system/undercover.service ]]; then
  echo "  Redémarrage du service…"
  sudo systemctl restart undercover
  sleep 2
  if systemctl is-active --quiet undercover; then
    echo "  ✅ service actif"
  else
    echo "  ❌ le service n'a pas démarré :"
    sudo journalctl -u undercover -n 20 --no-pager
    exit 1
  fi
else
  echo "  ℹ️  Service pas encore installé."
  echo "     Lance : bash scripts/server-setup.sh ton.nom.dhote"
fi
