# Undercover — dossier de contexte

> Document de reprise, destiné à donner à quelqu'un qui découvre le projet tout
> ce qu'il faut pour y travailler sans relire le dépôt entier. À jour au commit
> `8ab74be`.

---

## 1. En une phrase

Le jeu d'ambiance **Undercover**, auto-hébergé : les joueurs rejoignent depuis
leur téléphone, un écran partagé facultatif sert de plateau, et tout tourne sur
un serveur Node unique — sans compte, sans base de données, sans aucun fichier
média.

Interface **en français**, commentaires de code **en anglais**.

---

## 2. Contraintes fondatrices

Elles expliquent la plupart des choix et ne doivent pas être cassées.

| Contrainte | Conséquence |
|---|---|
| **Zéro fichier média** | Audio entièrement synthétisé (Web Audio), confettis dessinés au canvas, aucune image. Le client compressé fait ~130 Ko. |
| **Pas de module natif** | Persistance en JSON à plat, pas de SQLite. `npm install` marche partout. |
| **Le serveur fait autorité** | Rien n'est jamais cru sur parole côté client. Toute règle est vérifiée serveur. |
| **Source unique par donnée** | Les rôles portent leurs règles, `POINT_FIELDS` son barème, `SETTING_FIELDS` ses descriptions. La documentation lit le code, jamais l'inverse. |
| **Aucune fuite d'information** | Voir §10 — c'est la section la plus importante du projet. |

---

## 3. Démarrer

```bash
npm install
npm run play          # build + serveur sur le port 3000
```

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur + Vite en watch |
| `npm start` | Serveur seul (build déjà fait) |
| `npm run build` | Compile le client |
| `npm test` | Les 4 suites, dans `tests/.scratch` |
| `npm run simulate` | Simulateur d'équilibrage |
| `npm run tunnel` | Tunnel Cloudflare jetable (adresse changeante) |
| `npm run tunnel:named` | Tunnel permanent sur domaine propre |
| `npm run push` | Déploie vers la VM Google Cloud |
| `npm run words:stats` | Statistiques de la banque de mots |
| `npm run firewall` | Ouvre le port 3000 (Windows, admin) |

**Routes du client** (SPA, une seule page) :
`/` joueur · `/host` écran partagé · `/words` éditeur de mots ·
`/simulate` banc d'essai · `/regles` règles et réglages

---

## 4. Pile technique

- **Serveur** : Node 22, Fastify 5, Socket.IO 4, `qrcode`. Un seul port sert
  l'API, les WebSockets et le client statique.
- **Client** : React 18, Vite 6, framer-motion. CSS écrit à la main, un seul
  thème sombre, aucun framework CSS.
- **Espace de travail npm** : le client est un workspace.

---

## 5. Carte des fichiers

### Serveur

| Fichier | Contenu |
|---|---|
| `server/index.js` | Fastify, routes HTTP, bannière de démarrage, endpoint de simulation |
| `server/game/rooms.js` | Gestion des salons, tous les événements Socket.IO, autorisations |
| `server/game/engine.js` | **Le cœur** (2300 lignes) : machine à états, distribution, votes, scoring |
| `server/game/roles/` | `civilian`, `undercover`, `mrwhite`, plus `uncertain.js` (briefing partagé) |
| `server/game/modifiers/` | Les 8 modificateurs, un fichier chacun |
| `server/game/scoring.js` | `DEFAULT_POINTS`, `POINT_FIELDS`, `scoreGame()` |
| `server/game/settings-fields.js` | Description de chaque réglage (lu par l'UI **et** la doc) |
| `server/game/titles.js` | Titres de **fin de manche** (rares, « le plus X ou personne ») |
| `server/game/career.js` | Carnet de soirée par joueur |
| `server/game/honours.js` | Les 47 titres de **fin de soirée** + algorithme d'attribution |
| `server/game/appearance.js` | 96 avatars en 8 familles, 18 couleurs |
| `server/game/text.js` | `normalise`, `sameWord`, `tooClose` — comparaison de mots |
| `server/words.js` | Chargement, tirage anti-répétition, édition de la banque |
| `server/store.js` | Persistance JSON atomique et débattue |
| `server/paths.js` | Chemins, et `UNDERCOVER_DATA_DIR` pour isoler tests et simulations |
| `server/net.js` | Détection de l'IP locale |

### Client

| Fichier | Contenu |
|---|---|
| `client/src/App.jsx` | Routage par `location.pathname` |
| `client/src/socket.js` | Connexion, `send()` avec accusés, session en localStorage |
| `client/src/components.jsx` | `PlayerChip`, `ScoreBoard`, `AvatarPicker`, `ReactionBar`, `InviteButton`… |
| `client/src/settings.jsx` | Les 4 panneaux de réglages, **partagés** entre écran hôte et téléphone |
| `client/src/Finale.jsx` | Podium, titres, confettis — fin de soirée |
| `client/src/Reference.jsx` | Réglages expliqués (onglet fiche **et** page `/regles`) |
| `client/src/player/` | `JoinScreen`, `PlayerApp`, `PlayerRound`, `Dossier`, `HostSheet`, `SpectatorView` |
| `client/src/host/` | `HostApp`, `HostLobby`, `HostRound` |
| `client/src/audio.js` | ~30 sons synthétisés, ambiances par phase, stings par camp |

---

## 6. Le moteur

### Phases

```
lobby → reveal → describe → discuss → vote → voteResult → (describe…)
                                        ↘ tiebreak / revenge / mrwhiteGuess
                                                              ↘ gameOver
```

`tiebreak`, `revenge` et `mrwhiteGuess` sont des **interruptions** empilées dans
`interruptQueue` et jouées l'une après l'autre.

**3 à 16 joueurs.** `sessionOver` est un **drapeau**, pas une phase : il décrit
la soirée, pas la partie.

### Rôles (un par joueur)

| id | camp | optionnel | min. joueurs |
|---|---|---|---|
| `civilian` | civilian | non | 3 |
| `undercover` | undercover | non | 3 |
| `mrwhite` | mrwhite | oui | 4 |

### Modificateurs (se superposent au rôle)

| id | places | min. | secret |
|---|---|---|---|
| `amoureux` | 2 | 5 | non |
| `duelliste` | 2 | 5 | non |
| `bouffon` | 1 | 4 | non |
| `mercenaire` | 1 | 4 | non |
| `vengeuse` | 1 | 5 | non |
| `maire` | 1 | 4 | **oui** |
| `justicier` | 1 | 5 | **oui** |
| `fantome` | 1 | 5 | **oui** |

*Secret* = jamais révélé avant le bilan final, même à l'élimination.

**Budget de rôles spéciaux selon la table** :
3→0, 4-5→2, 6-7→3, 8-9→4, 10-12→5, 13-16→6.
Au-delà du budget, les rôles activés sont écartés dans un **ordre mélangé**
(`traitOrder`) — un ordre fixe avantageait toujours le même rôle.

### Conditions de victoire

- **Civils** : tous les imposteurs éliminés.
- **Infiltrés** : parité, **ou** un seul civil restant.
- **Mister White** : nomme le mot des civils (en description → fin immédiate, ou
  après démasquage), ou atteint le duel final.
- **Partage** : un civil + Mister White + infiltré ⇒ victoire partagée.
- **Amoureux** : les deux derniers survivants, même de camps opposés. **Prime
  sur tout le reste** (`winPriority`).
- **Bouffon** : ne gagne jamais la partie, marque des points.

### Barème par défaut

```json
{ "civilian": 2, "undercover": 3, "mrwhite": 5, "lovers": 4,
  "survivor": 1, "whiteGuess": 2, "bouffon": 3, "duelliste": 2,
  "mercenaire": 2, "dyingGuess": 2, "detective": 1 }
```

Toutes les valeurs sont réglables de 0 au maximum du champ.

---

## 7. Les 14 réglages

Décrits une seule fois, dans `settings-fields.js`, servis par `/api/info`.

| Clé | Défaut | Effet |
|---|---|---|
| `visibility` | `private` | `public` rend le salon trouvable sans code |
| `themeIds` | `[]` (tous) | Thèmes du tirage |
| `undercoverCount` | `auto` | 1 ≤6 j., 2 ≤9, 3 ≤12 |
| `undercoverKnowsRole` | `true` | Désactivé : les infiltrés reçoivent une carte de civil |
| `writtenClues` | `true` | Indices tapés ; conditionne chat, réactions, historique |
| `turnTimer` | `0` | Chrono par tour ; expiration ⇒ indice « … » |
| `discussTime` | `60` | Débat avant le vote |
| `reactions` | `true` | Emoji sous les indices |
| `endTitles` | `true` | Palmarès de fin de manche |
| `dyingGuess` | `true` | Dernier soupçon d'un civil éliminé |
| `dyingGuessTime` | `20` | Son compte à rebours, non bloquant |
| `detectiveMode` | `false` | Bulletins de civils payés / pénalisés |
| `scoreFloor` | `total` | `round` \| `total` \| `none` |
| `blankVote` | `false` | Vote blanc |

⚠️ `DEFAULT_SETTINGS.roles` contient encore `espion: false`, vestige d'un rôle
supprimé. Sans effet (absent du catalogue), mais à nettoyer.

---

## 8. Fonctionnalités notables

**Réactions** — 🤨 👍 😂 👀 💀 ⭐ collés sous l'indice d'un joueur, pendant
`describe`, `discuss` et `vote`. **Signées** (on voit qui) et réservées aux
vivants. Effacées à chaque manche ; les totaux de la partie alimentent les
titres.

**Dernier soupçon** — un civil éliminé a 20 s, sur son seul téléphone, pour
nommer tous les imposteurs restants. **Secret jusqu'au bilan**, **non bloquant**
pour la table. Ne rapporte que si les civils perdent quand même.

**Dossier 🗂️** — feuille à deux onglets sur le téléphone : sa propre carte
(mot, rôle, modificateurs) et l'historique de tous les indices depuis le début.
Le journal ne contient **que des indices**, jamais un mot secret.

**Titres de manche** — 12 titres, logique « le plus X **ou personne** » : une
égalité annule le titre, et chacun a un seuil minimum. Maximum 4 par partie, un
seul par joueur.

**Palmarès de fin de soirée** — 47 titres, logique **inverse** : tout le monde
repart avec quelque chose. Voir §9.

**Spectateurs** — arrivée en cours de partie : on choisit pseudo et avatar
(réservés), on regarde, et on est **assis automatiquement** à la manche
suivante. Ne reçoivent que l'état public.

**Parties publiques** — le bouton rejoint le salon public **le plus rempli** au
lobby, et en ouvre un si aucun n'attend. Délibérément pas une liste : à faible
affluence, une liste éparpille les joueurs et empêche les parties de démarrer.

**Reconnexion** — grâce de 5 min, possession du socket vérifiée, `wakeUp` sur
`visibilitychange`/`pageshow`/`focus`, erreurs `transient` réessayées.

---

## 9. Le palmarès de fin de soirée

**`career.js`** — chaque partie terminée replie ses faits dans un carnet par
joueur, **avant** que `restart()` n'efface tout. Le carnet voyage dans la
sauvegarde du salon.

**`honours.js`** — 47 titres, notés puis attribués :

1. chaque titre note la revendication de chaque joueur ;
2. les plus fortes sont servies d'abord, **un titre par joueur** ;
3. la place restante accueille les meilleures revendications restantes ;
4. plafond = `min(12, joueurs + 3)`.

Les titres de repli en fin de catalogue sont vrais de quiconque s'est assis, ce
qui tient la promesse « au moins un chacun » sans inventer de mérite.

**Deux crans de sévérité** — les titres piquants ont une seconde formulation qui
ne se déclenche que sur un chiffre extrême défini par le titre lui-même. « Deux
fois à court de mots » reste *Le Mutique*, six fois devient *Le Mime*. C'est la
donnée qui décide, jamais un jugement.

**Deux règles de ton** : l'écran n'ouvre jamais sur une pique (tri par ton), et
*Le Paratonnerre* — accusé à tort en boucle — vise la table, pas le joueur.

---

## 10. Anti-fuite d'information ⚠️

**La section la plus importante.** Chacun de ces points corrige un bug réel où
le jeu trahissait quelqu'un. Ne pas les défaire.

| Règle | Pourquoi |
|---|---|
| Un indice n'est refusé que s'il est **son propre mot** | Refuser « ce mot est en jeu » *était* la réponse : Mister White apprenait qu'il avait trouvé, l'infiltré qu'il n'était pas avec la majorité. |
| Le **mot de l'éliminé** n'apparaît jamais avant `gameOver` | Il donnait le mot des civils à l'infiltré. |
| Le champ `disguised` est **retiré** de la charge privée | Seul un infiltré déguisé le portait — sa présence le désignait. |
| Le **dernier soupçon** est secret jusqu'au bilan | Un mort visible deviendrait un oracle sans rien à perdre. |
| **Aucun `touch()`** après une réponse au dernier soupçon | Une diffusion trahirait le moment où il a répondu. |
| Les modificateurs **secrets** ne sortent jamais avant le bilan | Maire, Justicier, Fantôme. |
| Les **morts** ne réagissent ni n'écrivent | Ils savent des choses et orienteraient la partie. |
| Le **jeton d'écran** conditionne les pouvoirs d'hôte | Un code à 4 lettres est devinable ; « connaît le code » ≠ « possède le salon ». |
| Le **journal d'indices** ne contient que des indices | Jamais un mot secret. |
| Réactions **signées** | Anonymes, elles ne coûtent rien et ne veulent rien dire. |

---

## 11. Contrat des rôles et modificateurs

Rôles et modificateurs partagent les mêmes points d'accroche, tous facultatifs :

```
getWord, getDef, brief, onAssign, onVote, onEliminated(player, ctx, cause),
onGameEnd, checkWin, tiebreak, canApply, votesWhenDead, secret, winPriority,
minPlayers, slots
```

Un modificateur **ne coûte pas de place** de rôle et se distribue après les
rôles. Les briefings s'empilent : le rôle donne le corps, chaque modificateur
ajoute son encart.

Pour ajouter un rôle : un fichier dans `roles/` ou `modifiers/`, l'inscrire dans
l'`index.js` correspondant. Le catalogue alimente automatiquement l'UI, la fiche
de règles et le simulateur.

---

## 12. Protocole

### Deux flux

- **`state`** — état public, diffusé à toute la salle
- **`you`** — charge privée, par joueur, canal `player:<id>`

### Événements Socket.IO

**Hôte** (passent tous par `requireController`) :
`host:create` `host:watch` `host:settings` `host:start` `host:continue`
`host:restart` `host:skipDiscussion` `host:endSession` `host:newEvening`
`host:resetScores` `host:setHost` `host:kick`

**Joueur** :
`player:createGame` `player:joinPublic` `player:join` `player:rejoin`
`player:ready` `player:clue` `player:chat` `player:react` `player:vote`
`player:tiebreak` `player:revenge` `player:guess` `player:dyingGuess`
`player:appearance` `player:skipDiscussion` `player:quit` `player:leave`

**Spectateur** : `spectate:join` `spectate:leave`

### Autorisation

`requireController(code)` accepte **deux** identités :
1. l'écran qui a **créé** le salon (prouvé par `screenToken`) ;
2. le joueur qui porte la **couronne** (`isHost`).

Un écran rattaché par simple code est en **affichage seul**.

### Routes HTTP

```
GET    /api/info              catalogue complet : rôles, réglages, barème, avatars
GET    /api/public            compteur d'attente des salons publics
GET    /api/where             adresse de connexion vue du client
GET    /api/qr                QR code SVG, construit depuis l'en-tête Host
POST   /api/bank/reset        efface l'historique des mots (jeton si exposé)
GET    /api/words             banque de mots
GET    /api/words/:themeId
POST   /api/words/theme
DELETE /api/words/:themeId
POST   /api/words/:themeId/pair
DELETE /api/words/:themeId/pair/:key
POST   /api/simulate          lance le simulateur dans un processus isolé
```

---

## 13. Banque de mots

**1200 paires, 75 par thème, 16 thèmes.** 160 portent une définition, affichée
quand un mot est trop obscur pour être décrit à l'aveugle.

- Une paire est `["Mot", "Voisin"]` ou `["Mot", "Voisin", "défA", "défB"]`.
- L'historique « déjà joué » est **indexé par contenu** (`pairKey`), pas par
  position — l'indexation par position corrompait tout à la moindre insertion.
- Le tirage privilégie les thèmes ayant le plus de paires inédites.
- Les ajouts de l'utilisateur vont dans `custom-words.json`, jamais dans les
  fichiers livrés.

⚠️ **L'historique est global au serveur**, pas par salon. Fonctionnalité entre
amis, défaut dès que des inconnus jouent (§16).

---

## 14. Persistance

`server/data/state.json`, écrit de façon atomique et débattue (250 ms) :

- `seenPairs` — historique anti-répétition par thème
- `gamesPlayed`, `lastTheme`
- `rooms` — instantané par salon : joueurs, scores, victoires, **carnets**,
  réglages, `screenToken`. TTL 24 h.

**Ce qui n'est jamais persisté** : la partie en cours. Un redémarrage remet la
table au salon avec ses scores, jamais au milieu d'une manche.

**Isolation** : `UNDERCOVER_DATA_DIR` redirige tout ce qui s'écrit. Les tests et
le simulateur l'utilisent — auparavant ils brûlaient l'historique réel.

---

## 15. Déploiement

Une VM `e2-micro` **gratuite** sur Google Cloud (`us-central1`), Debian 12,
disque persistant standard 30 Go. Deux services systemd : le jeu et
`cloudflared`. Tunnel Cloudflare permanent sur domaine propre — **aucun port
entrant ouvert**, HTTPS fourni.

```
npm run push                            # depuis le PC : compile, envoie, redémarre
bash scripts/server-setup.sh <hôte>     # une seule fois
bash scripts/server-tunnel.sh <hôte>    # une seule fois, après cloudflared tunnel login
```

Le client est compilé **sur le PC** : sur 1 Go de RAM, Vite se fait tuer par le
noyau. `server-setup.sh` crée 2 Go de swap pour la même raison.
`npm run push` **exclut `server/data`** — les données du serveur font autorité.

**Limites du gratuit** : 1 seule `e2-micro`, 30 Go de disque, **1 Go de trafic
sortant par mois** (~8000 chargements). Latence ~130 ms depuis la France, les
régions gratuites étant américaines.

---

## 16. Tests

```bash
npm test        # 4 suites, 162 assertions
```

`tests/run.mjs` lance chaque suite dans son propre processus (le moteur garde
un état de module) et **considère qu'une suite sans assertion a échoué** — un
serveur qui ne démarre pas laissait sinon la campagne au vert.

| Suite | Couvre |
|---|---|
| `engine.test.mjs` | Réactions, chat, vote blanc, mode détective, planchers, Mister White, dernier soupçon, couverture des descriptions de réglages |
| `honours.test.mjs` | Catalogue, « personne ne repart bredouille », crans de sévérité, fin de soirée |
| `host.test.mjs` | Création depuis un téléphone, autorisations, jeton d'écran, parties publiques |
| `simulate.test.mjs` | Reproductibilité, balayage, isolation des données |

---

## 17. Simulateur d'équilibrage

`npm run simulate` ou la page `/simulate`. Joue des milliers de parties contre
le **vrai moteur** et rapporte victoires par camp, points par rôle, scores
finaux de soirée, fréquence des titres, écart d'espérance entre camps.

Ne modélise **pas le langage** : ce qui décide les vraies parties est remplacé
par un seul paramètre, `skill` — la probabilité qu'un bulletin de civil tombe
sur un imposteur. Lire la sortie comme « pour une table qui démasque 55 % du
temps, ce barème est-il juste ? ».

La graine ensemence **aussi** `Math.random`, donc la distribution des rôles et
l'ordre de passage sont reproductibles — sans quoi un balayage compare des
barèmes sur des parties différentes et mesure la chance.

---

## 18. Conventions

- Interface et messages d'erreur **en français**, commentaires **en anglais**.
- Les commentaires expliquent **pourquoi**, pas quoi. Beaucoup documentent un
  bug réel — les lire avant de « simplifier ».
- Aucune valeur de règle en dur côté client : tout vient de `/api/info`.
- Les panneaux de réglages sont **partagés** entre écran hôte et téléphone, pas
  dupliqués.
- Un test refuse tout réglage ajouté sans description.
- Messages de commit en français, corps explicatif du **pourquoi**.

---

## 19. Dettes connues et chantiers ouverts

Par ordre d'importance.

1. **Équilibrage** — le simulateur donne l'infiltré à **6,5 % de victoires** à 6
   joueurs. Aucun barème ne corrige ça (balayage effectué) : c'est un problème
   de **règles**. Jamais traité.
2. **Historique des mots global** — devient un défaut dès que des inconnus
   jouent : un groupe consomme la fraîcheur des autres. Il devrait être par
   salon.
3. **Modération absente** — pseudos et chat libres. Enjeu réel maintenant que
   les parties publiques existent.
4. **Codes de salon devinables** — 4 lettres sur 24 = 331 776. Le jeton d'écran
   protège les pouvoirs d'hôte, pas l'entrée.
5. **Plafond de trafic** — 1 Go/mois sur l'offre gratuite.
6. **Sauvegarde des données** — `server/data` sur la VM n'est copié nulle part.
7. **`espion: false`** résiduel dans `DEFAULT_SETTINGS.roles`.
8. **Chat général** — discuté, non fait : panneau ouvrable, morts en lecture
   seule avec canal séparé, saisie fermée pendant la description.
9. **Le Faiseur de rois** — titre écarté faute d'attribution des égalités.

---

## 20. Historique décisionnel

Quelques décisions structurantes, et ce qui les motive.

- **Le grand écran est facultatif.** Il était le seul moyen de créer une partie,
  donc jouer exigeait un ordinateur.
- **Deux présentations plutôt qu'un responsive** pour le palmarès : théâtre sur
  grand écran, résumé lisible sur téléphone.
- **Plancher de score sur le cumul, pas la manche** — bloquer chaque manche à
  zéro protège ceux qui mènent, c'est-à-dire exactement ceux que le mode vise.
  Devenu réglable à trois modes.
- **Un salon public unique plutôt qu'une liste** — une liste éparpille les
  joueurs quand ils sont peu nombreux.
- **Pas de SQLite** — pour rester installable partout sans compilation.
- **Tirage des rôles mélangé** — un ordre fixe faisait toujours gagner le même
  rôle contre le budget.
