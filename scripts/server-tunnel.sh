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
if [[ ! -f "$CREDS" ]]; then
  # Le secret d'un tunnel n'existe que sur la machine qui l'a cree : Cloudflare
  # ne le redonne jamais. Un tunnel visible dans la liste mais sans son fichier
  # local est donc inutilisable ici — typiquement parce qu'il a ete cree
  # ailleurs, sur le PC de la maison par exemple.
  cat <<EOF

  Le tunnel « $TUNNEL_NAME » existe, mais son fichier secret n'est pas sur
  cette machine — il est reste la ou le tunnel a ete cree.

  Le plus simple, puisque rien n'y est encore attache :

    cloudflared tunnel delete -f $TUNNEL_NAME
    bash scripts/server-tunnel.sh $HOSTNAME_ARG $TUNNEL_NAME

  (Sinon : recopier $UUID.json depuis ~/.cloudflared de l'autre machine.)

EOF
  exit 1
fi

# --------------------------------------------------------------------- dns
step "Route DNS vers $HOSTNAME_ARG"
# `--overwrite-dns` est indispensable et non cosmetique : si le tunnel a ete
# recree, l'enregistrement existant pointe encore vers l'ancien, mort. Traiter
# « already exists » comme un succes laisserait le nom d'hote branche sur un
# tunnel qui n'existe plus, et plus rien ne repondrait — sans erreur nulle part.
if cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$HOSTNAME_ARG" >/tmp/route.log 2>&1; then
  echo "  en place"
else
  cat /tmp/route.log
  die "Impossible de router $HOSTNAME_ARG. Le domaine est-il bien gere par Cloudflare ?"
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
