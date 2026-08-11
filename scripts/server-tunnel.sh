#!/usr/bin/env bash
#
# Met en place le tunnel Cloudflare permanent sur le serveur.
#
# À lancer APRÈS `cloudflared tunnel login`, qui est la seule étape interactive :
#   cloudflared tunnel login
#   bash scripts/server-tunnel.sh undercover.tondomaine.org
#
# Le service système installé ici démarre au boot, donc le jeu est joignable
# sans que personne ne se connecte à la machine.
#
# Idempotent : relançable pour changer de nom d'hôte ou réparer la config.

set -euo pipefail

HOSTNAME_ARG="${1:-}"
TUNNEL_NAME="${2:-undercover}"
PORT="${PORT:-3000}"
CERT="$HOME/.cloudflared/cert.pem"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m\n  %s\033[0m\n\n' "$1"; exit 1; }

[[ -n "$HOSTNAME_ARG" ]] || die "Usage : bash scripts/server-tunnel.sh undercover.tondomaine.org"
command -v cloudflared >/dev/null || die "cloudflared absent — lance d'abord scripts/server-setup.sh"

if [[ ! -f "$CERT" ]]; then
  die "Pas encore autorisé. Lance « cloudflared tunnel login », ouvre l'adresse
  affichée dans le navigateur de ton PC, choisis ton domaine, puis relance ce script."
fi

# ------------------------------------------------------------------ tunnel
step "Tunnel « $TUNNEL_NAME »"
UUID="$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2 == n {print $1}' | head -n1)"
if [[ -n "$UUID" ]]; then
  echo "  existe déjà : $UUID"
else
  cloudflared tunnel create "$TUNNEL_NAME"
  UUID="$(cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2 == n {print $1}' | head -n1)"
  [[ -n "$UUID" ]] || die "Tunnel créé mais introuvable dans la liste."
  echo "  créé : $UUID"
fi

CREDS="$HOME/.cloudflared/$UUID.json"
[[ -f "$CREDS" ]] || die "Fichier d'identifiants manquant : $CREDS"

# --------------------------------------------------------------------- dns
step "Route DNS vers $HOSTNAME_ARG"
# Réappliquée à chaque fois : Cloudflare répond « already exists » quand elle est
# déjà bonne, ce qui n'est pas une erreur.
if cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME_ARG" 2>&1 | tee /tmp/route.log; then
  echo "  en place"
elif grep -qi "already exists\|record with that host" /tmp/route.log; then
  echo "  déjà en place"
else
  die "Impossible de router $HOSTNAME_ARG. Le domaine est-il bien géré par Cloudflare ?"
fi

# ------------------------------------------------------------------ config
#
# Le service système lit /etc/cloudflared/config.yml, pas celui du dossier
# personnel : les identifiants doivent donc y être recopiés.
step "Configuration du service"
sudo mkdir -p /etc/cloudflared
sudo cp "$CREDS" "/etc/cloudflared/$UUID.json"
sudo chmod 600 "/etc/cloudflared/$UUID.json"

sudo tee /etc/cloudflared/config.yml >/dev/null <<EOF
tunnel: $UUID
credentials-file: /etc/cloudflared/$UUID.json

ingress:
  - hostname: $HOSTNAME_ARG
    service: http://localhost:$PORT
    originRequest:
      # Le jeu vit sur des WebSockets ouvertes toute la partie ; sans ça elles
      # seraient coupées au bout du délai par défaut.
      noTLSVerify: true
      connectTimeout: 30s
  # Tout ce qui n'est pas notre nom d'hôte n'a rien à faire ici.
  - service: http_status:404
EOF
echo "  /etc/cloudflared/config.yml écrit"

# ----------------------------------------------------------------- service
step "Service système"
sudo systemctl stop cloudflared 2>/dev/null || true
sudo cloudflared service install 2>/dev/null || true
sudo systemctl daemon-reload
sudo systemctl enable cloudflared >/dev/null 2>&1 || true
sudo systemctl restart cloudflared
sleep 2

if systemctl is-active --quiet cloudflared; then
  echo "  cloudflared actif"
else
  die "cloudflared n'a pas démarré. Regarde : sudo journalctl -u cloudflared -n 40"
fi

cat <<EOF

$(bold "Tout est en place.")

  Joueurs        https://$HOSTNAME_ARG
  Écran hôte     https://$HOSTNAME_ARG/host

  Les deux services démarrent tout seuls au redémarrage de la machine.

$(bold "Vérifier :")

  sudo systemctl status undercover cloudflared
  sudo journalctl -u cloudflared -f

EOF
