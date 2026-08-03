# 🕵️ Undercover — LAN

Le jeu d'Undercover, hébergé sur ton PC. Les joueurs rejoignent depuis leur
téléphone en se connectant à ton wifi. Aucun compte, aucun cloud, aucune
connexion internet nécessaire.

- **688 paires de mots** réparties sur **16 thèmes**, jamais deux fois la même
  tant que le thème n'est pas épuisé. 119 paires portent une définition, affichée
  quand le mot est trop obscur pour être décrit à l'aveugle.
- **3 rôles + 8 modificateurs** : Civil, Infiltré et Mister White décident du
  camp et du mot ; Amoureux, Vengeuse, Duelliste, Bouffon, Mercenaire, Maire,
  Justicier et Fantôme se **superposent** au rôle réel. Activables à la carte,
  avec un budget automatique selon la taille de la table et un tirage équitable.
  Trois d'entre eux (Maire, Justicier, Fantôme) ne sont **jamais révélés** avant
  le bilan final.
- **Phase de discussion** chronométrée entre les indices et le vote.
- **Points cumulés** sur toute la soirée, avec grille de scores animée en fin de
  partie.
- **Indices policés** : impossible de donner son propre mot, un mot en jeu, ou un
  indice déjà utilisé dans la partie.
- **Variantes** : les infiltrés savent (ou non) qu'ils le sont, indices écrits,
  chrono par tour, nombre d'infiltrés, thème imposé.
- **Avatars personnalisables** : 48 emoji × 10 couleurs, unicité garantie dans le salon.
- **Son** entièrement synthétisé dans le navigateur — aucun fichier audio, avec
  réverbération, ambiances de phase et stings par camp.

---

## Démarrer

```bash
npm install
npm run play        # build + lancement sur le port 3000
```

La console affiche les deux adresses :

```
  Écran hôte (ton PC)   http://192.168.1.21:3000/host
  Joueurs (téléphones)  http://192.168.1.21:3000
```

1. Ouvre **`/host`** sur l'écran que tout le monde voit (PC, TV, vidéoproj).
2. Chaque joueur scanne le QR code, ou tape l'adresse et le code à 4 lettres.
3. Règle la partie depuis ⚙️ sur l'écran hôte, puis lance.

Les fois suivantes, `npm start` suffit (le build est déjà fait).

### Si les téléphones n'arrivent pas à se connecter

Dans l'ordre :

1. **Le pare-feu Windows.** C'est la cause n°1. Ouvre PowerShell **en
   administrateur**, puis :
   ```powershell
   cd c:\Users\atewo\Documents\Projects\undercover
   npm run firewall
   ```
   Ça crée une règle entrante sur le port 3000, limitée aux réseaux privés.

2. **L'isolation AP de ta box.** Certaines box (surtout en réseau invité)
   empêchent les appareils du wifi de se voir entre eux. Ça se désactive dans
   l'interface d'administration de la box.

3. **La bonne IP.** Si ta machine a plusieurs cartes réseau, `GET /api/info`
   liste toutes les adresses candidates avec leur score. Essaie la suivante.

---

## Jouer à distance

Le jeu est pensé pour une même pièce : un écran partagé, des accusations à voix
haute. À distance il te faudra un salon vocal, et quelqu'un pour partager
l'écran `/host` — le reste fonctionne, chaque téléphone étant autonome.

### Avec Cloudflare Tunnel (gratuit, rien à héberger)

Ton PC reste le serveur ; le tunnel lui donne une adresse publique en HTTPS.

```bash
# 1. Le jeu tourne comme d'habitude
npm run play

# 2. Dans un autre terminal
cloudflared tunnel --url http://localhost:3000
```

`cloudflared` affiche une URL du type `https://xxxx.trycloudflare.com`.
**Relance alors le serveur en lui donnant cette adresse**, sinon le QR code et
l'adresse affichée pointeront vers ton IP locale, inutilisable de l'extérieur :

```bash
PUBLIC_URL=https://xxxx.trycloudflare.com ADMIN_TOKEN=un-secret-au-hasard npm start
```

En PowerShell :

```powershell
$env:PUBLIC_URL = "https://xxxx.trycloudflare.com"
$env:ADMIN_TOKEN = "un-secret-au-hasard"
npm start
```

### Les deux variables

| | Rôle |
|---|---|
| `PUBLIC_URL` | L'adresse que taperont tes amis. Sans elle, le QR code renvoie vers ton IP locale. La définir signale aussi au serveur qu'il est exposé, ce qui active les protections ci-dessous. |
| `ADMIN_TOKEN` | Exigé pour `POST /api/bank/reset` dès que `PUBLIC_URL` est défini. Sans jeton, la route est bloquée pour tout le monde — y compris toi. |

### Ce qui change une fois exposé

- L'IP locale et la liste de tes interfaces réseau **disparaissent** de
  `/api/info` : ce n'est l'affaire de personne.
- `/api/bank/reset` exige `ADMIN_TOKEN`, en `?token=` ou en en-tête
  `x-admin-token`.
- `/api/qr` refuse de générer un QR vers une adresse étrangère : un générateur
  de QR servi depuis un domaine de confiance est un cadeau pour le phishing.
- La création de salons est plafonnée (10 par connexion, 200 au total) et les
  salons vides sont récupérés au bout de 10 minutes.

Rien de tout ça ne s'active sur ton wifi : sans `PUBLIC_URL`, le comportement
reste exactement celui d'avant.

## Qui pilote la partie

Deux télécommandes en parallèle, pour ne pas dépendre de qui est assis devant
l'ordinateur.

| | Écran `/host` | Téléphone de l'hôte 👑 |
|---|---|---|
| Lancer, passer au vote, manche suivante, rejouer | ✅ | ✅ |
| Réglages, thèmes, barème | ✅ | — |
| Expulser un joueur, abandonner | ✅ | — |
| Donner la couronne à quelqu'un d'autre | ✅ | — |

Le premier joueur à rejoindre porte la couronne. L'écran `/host` peut la donner
à n'importe qui via le bouton 👑 sur sa carte, et elle passe automatiquement à
un autre joueur si l'hôte quitte la partie.

Les réglages et l'expulsion restent volontairement sur le grand écran : ce sont
les actions pénibles à faire sur un téléphone et coûteuses à rater.

Côté serveur, une action `host:*` n'est acceptée que si elle vient de l'écran
partagé de cette partie **ou** du joueur qui porte la couronne. Tout le reste
est refusé.

## Réglages

| Réglage | Effet |
|---|---|
| **Thèmes** | Sélection multiple : coche autant de thèmes que tu veux, ou aucun pour tirer dans les 16. Le tirage privilégie les thèmes qui ont le plus de paires inédites. |
| **Infiltrés** | `Auto` suit la taille de la table (1 jusqu'à 6 joueurs, 2 jusqu'à 9, 3 jusqu'à 12). |
| **Rôles spéciaux** | Activables un par un, dans la limite du budget de la table. Chacun a aussi son propre minimum de joueurs. Ceux qui ne rentrent pas sont écartés, avec la raison affichée. |
| **Les infiltrés savent qu'ils le sont** | Désactivé, ils reçoivent une carte de civil identique aux autres et doivent comprendre seuls qu'ils ont le mauvais mot. Variante nettement plus tendue. |
| **Indices écrits** | Chaque joueur tape son indice ; tous les indices s'affichent pendant la discussion et le vote. |
| **Chrono par tour** | 20 / 40 / 60 s, ou désactivé. Temps écoulé sans indice → « … » affiché à la place. |
| **Temps de discussion** | 30 s / 1 min / 2 min, ou désactivé. Débat libre avant le vote. Le vote s'ouvre à la fin du chrono, quand **tous** les joueurs ont demandé à passer, ou d'un seul clic depuis l'écran hôte. |

### Budget de rôles spéciaux

| Joueurs | 4-5 | 6-7 | 8-9 | 10-12 | 13+ |
|---|---|---|---|---|---|
| Rôles spéciaux max | 2 | 3 | 4 | 5 | 6 |

Deux civils « nus » sont toujours réservés, donc un rôle peut passer le budget et
manquer quand même de siège — le lobby le signale.

### Règles de fin de partie

- Les **civils** gagnent quand infiltrés et Mister White sont tous éliminés.
  Les modificateurs ne changent jamais de camp : un Bouffon ou un Maire reste
  ce que son rôle de base dit qu'il est.
- Les **infiltrés** gagnent à la parité, **ou dès qu'il ne reste qu'un seul civil** —
  un civil isolé ne peut plus construire de majorité, la partie est jouée.
- **Mister White** gagne s'il devine le mot des civils après avoir été démasqué,
  ou s'il atteint le duel final.
- **Mister White et les infiltrés se partagent la victoire** quand il ne reste
  qu'un civil et que les deux camps sont encore debout.
- Les **Amoureux** gagnent ensemble s'ils sont les deux derniers survivants,
  **même s'ils ne sont pas du même camp**. Cette victoire prime sur toutes les autres.
- Le **Bouffon** ne gagne jamais la partie : il marque des points.

### Points

Toutes ces valeurs sont **des valeurs par défaut, pas des constantes** : chacune
se règle depuis l'onglet 💯 **Barème** de l'écran hôte, au curseur ou en tapant
le nombre exact. Mettre 0 désactive complètement une récompense.

| | Défaut | Plage |
|---|---|---|
| Victoire des Civils | 2 | 0–15 |
| Victoire des Infiltrés | 3 | 0–15 |
| Victoire des Amoureux | 4 | 0–15 |
| Victoire de Mister White | 5 | 0–15 |
| Encore en vie à la fin | 1 | 0–10 |
| Mister White devine le mot | 2 | 0–10 |
| Bouffon lynché dès la 1re manche | 3 | 0–10 |
| Duelliste qui survit à son rival | 2 | 0–10 |
| Mercenaire dont la cible tombe dès la 1re manche | 2 | 0–10 |

Le barème choisi se propage partout : les cartes distribuées aux joueurs
annoncent le vrai chiffre, et l'onglet Points de la fiche de règles affiche les
valeurs réellement en vigueur. Aucun nombre n'est écrit en dur ailleurs que dans
`server/game/scoring.js`.

Les objectifs annexes (Bouffon, Mercenaire, Duelliste) paient **même si ton camp
perd**. En cas de victoire partagée, chaque camp est payé à son propre tarif.

Les scores se cumulent tant que la salle reste ouverte, y compris entre deux
parties. Remise à zéro depuis l'onglet 🏆 de l'écran hôte ; le barème, lui,
survit à une remise à zéro des scores.

---

## Comment ça tient debout

```
server/
  index.js            Fastify — sert le client, l'API, et attache Socket.IO
  net.js              choisit la vraie IP wifi parmi les cartes virtuelles
  words.js            chargement des thèmes + tirage anti-répétition
  store.js            historique persistant (JSON atomique, zéro dépendance native)
  game/
    engine.js         machine à états de la partie
    rooms.js          salons, sockets, diffusion publique/privée
    scoring.js        barème de points
    text.js           comparaison de mots (indices, devinette)
    roles/            un fichier par rôle  ← voir roles/README.md
    modifiers/        traits qui se superposent à un rôle (Amoureux)
  data/words/*.json   la banque de mots
client/src/
  audio.js            synthèse sonore Web Audio
  host/               écran partagé (lobby, QR, manche, révélations)
  player/             écran téléphone (join, carte, indice, vote)
```

**Le serveur est la seule autorité.** Chaque téléphone reçoit deux flux : `state`
(public, identique pour tous) et `you` (privé, uniquement son mot et son rôle).
Aucun client ne reçoit le mot d'un autre joueur avant la fin de la partie —
ouvrir les devtools ne révèle rien. Quand la variante « les infiltrés ignorent
leur rôle » est active, le serveur ne transmet même pas le véritable identifiant
de rôle.

### Ajouter un rôle ou un modificateur

Voir [server/game/roles/README.md](server/game/roles/README.md). Le moteur ne
connaît aucun rôle par son nom : il appelle seulement les hooks (`getWord`,
`brief`, `onAssign`, `onVote`, `onEliminated`, `onGameEnd`, `checkWin`,
`tiebreak`) que chaque trait déclare.

La règle de partage : **ce qui décide d'un camp et d'un mot est un rôle**, tout
le reste est un modificateur posé par-dessus. Il n'y a donc que trois rôles, et
huit modificateurs.

### Enrichir la banque de mots

Ajoute un fichier dans `server/data/words/` :

```json
{
  "id": "mon-theme",
  "label": "Mon thème",
  "emoji": "🎯",
  "pairs": [["Mot A", "Mot B"], ["Mot C", "Mot D"]]
}
```

Il est chargé au démarrage. Les paires identiques ou dupliquées sont rejetées
avec un avertissement en console.

```bash
npm run words:stats     # ce qui reste d'inédit par thème
```

Pour remettre tout l'historique à zéro : `POST /api/bank/reset`.

---

## État actuel

Testé de bout en bout via l'API socket réelle : lobby, choix d'avatar,
expulsion par l'hôte, budget et distribution des rôles, révélation, description
tour par tour, validation des indices, expiration du chrono, phase de
discussion, vote pondéré, départage d'égalité par le Justicier, couple mixte
Infiltré + Civil gagnant ensemble, morts en chaîne, dernière chance de Mister
White, les cinq conditions de victoire, calcul et cumul des points, abandon en
pleine partie, reconnexion d'un téléphone verrouillé, rejouer avec les mêmes
joueurs.

Pas encore fait : un mode pass-and-play pour ceux qui n'ont pas de téléphone, un
historique de soirée persistant sur disque (les scores vivent en mémoire et
disparaissent si le serveur redémarre), et un éditeur de banque de mots dans
l'interface (l'ajout se fait en éditant les JSON).
