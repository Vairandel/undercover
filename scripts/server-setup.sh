#!/usr/bin/env bash
#
# Installe le jeu sur un serveur Debian/Ubuntu neuf, pour qu'il tourne tout seul.
#
# Pensé pour la machine `e2-micro` gratuite de Google Cloud, qui n'a qu'1 Go de
# mémoire et un cœur partagé — d'où le fichier d'échange créé plus bas, sans
# lequel la compilation du client se fait tuer par le noyau à court de mémoire.
#
# À lancer depuis la racine du projet, sur le serveur :
#   bash scripts/server-setup.sh undercover.tondomaine.org
#
# Idempotent : on peut le relancer sans rien casser.

set -euo pipefail

HOSTNAME_ARG="${1:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
ENV_FILE="$APP_DIR/server/data/env"
NODE_MAJOR=22

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  %s\033[0m\n' "$1"; }

if [[ -z "$HOSTNAME_ARG" ]]; then
  echo "Usage : bash scripts/server-setup.sh undercover.tondomaine.org"
  exit 1
fi

# --------------------------------------------------------------------- swap
#
# 1 Go de RAM ne suffit pas à Vite. Sans échange, `npm run build` se fait tuer
# silencieusement par le noyau et on cherche longtemps pourquoi.
step "Fichier d'échange (2 Go)"
if [[ -f /swapfile ]]; then
  echo "  déjà en place"
else
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "  créé et activé"
fi

# --------------------------------------------------------------------- node
step "Node.js $NODE_MAJOR"
if command -v node >/dev/null && [[ "$(node -v)" == v${NODE_MAJOR}.* ]]; then
  echo "  déjà installé : $(node -v)"
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
  sudo apt-get install -y nodejs >/dev/null
  echo "  installé : $(node -v)"
fi

# -------------------------------------------------------------- cloudflared
#
# Le tunnel évite d'ouvrir le moindre port entrant sur la machine : rien à
# configurer côté pare-feu, et le HTTPS est fourni.
step "cloudflared"
if command -v cloudflared >/dev/null; then
  echo "  déjà installé"
else
  ARCH="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  sudo dpkg -i /tmp/cloudflared.deb >/dev/null
  rm -f /tmp/cloudflared.deb
  echo "  installé"
fi

# ------------------------------------------------------------ dépendances
step "Dépendances"
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts >/dev/null 2>&1 || npm install --omit=dev >/dev/null

# `npm run push` envoie le client déjà compilé, précisément pour ne pas faire
# tourner Vite ici : sur un cœur partagé à 1 Go, la compilation prend des
# minutes quand elle ne se fait pas tuer par le noyau. On ne compile donc que
# si le résultat manque vraiment.
if [[ -f client/dist/index.html ]]; then
  echo "  client déjà compilé, reçu depuis le PC"
else
  warn "client/dist absent — compilation sur place, ce sera long."
  npm install --prefix client >/dev/null
  npm run build
fi

# -------------------------------------------------------------- variables
step "Configuration"
mkdir -p "$APP_DIR/server/data"
if [[ -f "$ENV_FILE" ]]; then
  echo "  $ENV_FILE existe, conservé"
else
  # Le jeton reste stable d'un redémarrage à l'autre : avec une adresse
  # permanente, l'éditeur de mots est une page où l'on revient.
  TOKEN="$(head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 12)"
  cat > "$ENV_FILE" <<EOF
PORT=3000
PUBLIC_URL=https://$HOSTNAME_ARG
ADMIN_TOKEN=$TOKEN
EOF
  chmod 600 "$ENV_FILE"
  echo "  créé"
fi

# ----------------------------------------------------------------- service
step "Service système"
sudo tee /etc/systemd/system/undercover.service >/dev/null <<EOF
[Unit]
Description=Undercover — serveur de jeu
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node server/index.js
# Une partie en cours ne doit pas mourir d'un incident passager.
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable undercover >/dev/null 2>&1
sudo systemctl restart undercover
echo "  undercover.service actif"

# -------------------------------------------------------------------- fin
ADMIN="$(grep '^ADMIN_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"

cat <<EOF

$(bold "Serveur installé.")

  Adresse        https://$HOSTNAME_ARG
  Jeton admin    $ADMIN

$(bold "Il reste le tunnel, une seule fois :")

  cloudflared tunnel login
  bash scripts/server-tunnel.sh $HOSTNAME_ARG

  La première commande affiche une adresse : ouvre-la dans le navigateur
  de ton PC et choisis ton domaine. La seconde fait tout le reste.

$(bold "Au quotidien :")

  sudo systemctl status undercover     état du jeu
  sudo journalctl -u undercover -f     journaux en direct
  sudo systemctl restart undercover    redémarrage

EOF
