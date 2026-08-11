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

# Premier envoi : Node n'existe pas encore, c'est server-setup.sh qui
# l'installe. Sortir en succès plutôt qu'en erreur — le transfert a bien
# eu lieu, il ne reste qu'à installer, et un échec ici ferait croire le
# contraire.
if ! command -v npm >/dev/null 2>&1; then
  cat <<'EOF'

  Fichiers recus. Node n'est pas encore installe sur cette machine.

  Connecte-toi en SSH et lance l'installation, une seule fois :

    cd ~/undercover
    bash scripts/server-setup.sh ton.nom.dhote

EOF
  exit 0
fi

echo "  Dependances..."
# Le client est déjà compilé et envoyé tout fait : rien à construire ici, où
# une machine à 1 Go y passerait des minutes.
npm ci --omit=dev --ignore-scripts >/dev/null 2>&1 || npm install --omit=dev >/dev/null 2>&1

if [[ ! -f client/dist/index.html ]]; then
  echo "  Attention : client/dist absent, le jeu n'aura pas d'interface."
fi

if [[ -f /etc/systemd/system/undercover.service ]]; then
  echo "  Redemarrage du service..."
  sudo systemctl restart undercover
  sleep 2
  if systemctl is-active --quiet undercover; then
    echo "  OK - service actif"
  else
    echo "  ECHEC - le service n'a pas demarre :"
    sudo journalctl -u undercover -n 20 --no-pager
    exit 1
  fi
else
  cat <<'EOF'

  Fichiers a jour. Le service n'est pas encore installe.

    cd ~/undercover
    bash scripts/server-setup.sh ton.nom.dhote

EOF
fi
