# 🕵️ Undercover — LAN

Le jeu d'Undercover, hébergé sur ton PC. Les joueurs rejoignent depuis leur
téléphone en se connectant à ton wifi. Aucun compte, aucun cloud, aucune
connexion internet nécessaire.

- **1200 paires de mots**, **75 par thème** sur **16 thèmes**, jamais deux fois la même
  tant que le thème n'est pas épuisé. 160 paires portent une définition, affichée
  quand le mot est trop obscur pour être décrit à l'aveugle.
- **3 rôles + 8 modificateurs** : Civil, Infiltré et Mister White décident du
  camp et du mot ; Amoureux, Vengeuse, Duelliste, Bouffon, Mercenaire, Maire,
  Justicier et Fantôme se **superposent** au rôle réel. Activables à la carte,
  avec un budget automatique selon la taille de la table et un tirage équitable.
  Trois d'entre eux (Maire, Justicier, Fantôme) ne sont **jamais révélés** avant
  le bilan final.
- **Phase de discussion** chronométrée entre les indices et le vote, et le chat
  reste ouvert pendant le vote — on peut changer d'avis jusqu'au dernier bulletin.
- **Réactions sur les indices** : 🤨 👍 😂 👀 💀 ⭐ collés sous l'indice de
  quelqu'un, signés et visibles de tous.
- **Dernier soupçon** : un civil éliminé a quelques secondes, en secret, pour
  nommer tous les imposteurs restants.
- **Palmarès de fin de manche** : des titres décernés d'après ce qui s'est
  vraiment passé.
- **Points cumulés** sur toute la soirée, avec grille de scores animée en fin de
  partie.
- **Indices policés** : impossible de donner son propre mot, ou un indice déjà
  utilisé dans la partie. Les autres mots en jeu, eux, passent — refuser l'un
  d'eux revenait à confirmer au joueur qu'il venait de deviner le mot du camp
  d'en face.
- **Banque de mots éditable** depuis `/words` : nouveaux thèmes, nouvelles
  paires, sans toucher aux fichiers.
- **Mode spectateur** : arriver en cours de partie, choisir son avatar, regarder
  la manche en cours, et se retrouver assis automatiquement à la suivante.
- **Mister White peut gagner d'un mot** : s'il lâche le mot des civils dans sa
  description, il emporte la partie sur-le-champ.
- **Variantes** : les infiltrés savent (ou non) qu'ils le sont, indices écrits,
  chrono par tour, nombre d'infiltrés, thème imposé.
- **Avatars personnalisables** : 96 emoji rangés par familles × 18 couleurs,
  unicité garantie dans le salon, et un bouton « au hasard » pour les pressés.
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

### Adresse fixe, sur ton propre domaine

Si tu as un domaine géré par Cloudflare, c'est la meilleure option : l'adresse
ne change **jamais**, tes amis peuvent la mettre en favori, et le QR code
redevient un raccourci au lieu d'être la seule façon d'entrer.

La première fois, donne le nom d'hôte :

```bash
npm run tunnel:named -- --hostname undercover.tondomaine.org
```

Le script t'ouvre la page d'autorisation Cloudflare, crée le tunnel, pointe le
DNS dessus, puis démarre tout. Les fois suivantes, il n'y a plus rien à taper :

```bash
npm run tunnel:named
```

Le nom d'hôte et le **jeton administrateur** sont retenus dans
`server/data/tunnel.json` (non versionné). Le jeton est délibérément stable :
avec une adresse permanente, l'éditeur de mots devient une page où l'on revient,
et un jeton qui changerait à chaque lancement finirait par être désactivé.

Prérequis : le domaine doit être dans ton compte Cloudflare, c'est-à-dire que
ses **serveurs de noms** doivent pointer vers Cloudflare — gratuit, quel que
soit le vendeur du domaine.

### Sans domaine : le tunnel jetable

Une seule commande, rien à acheter, mais **l'adresse change à chaque
lancement** :

```bash
npm run tunnel
```

Elle compile le client, ouvre un tunnel Cloudflare, lit l'adresse publique dans
sa sortie et démarre le serveur en la lui passant — plus de copier-coller. Les
deux processus sont liés : `Ctrl+C` arrête tout, et si l'un tombe l'autre suit,
pour ne jamais laisser un serveur derrière un tunnel mort.

Prérequis, une seule fois :

```powershell
winget install --id Cloudflare.cloudflared
```

Le QR code de l'écran hôte se construit à partir de l'adresse que **le
navigateur** utilise, donc il suit automatiquement le tunnel, y compris quand
celui-ci change d'adresse.

### À la main, si tu préfères

```powershell
cloudflared tunnel --url http://localhost:3000   # terminal 1
$env:PUBLIC_URL = "https://xxxx.trycloudflare.com"
$env:ADMIN_TOKEN = "un-secret-au-hasard"
npm start                                        # terminal 2
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

## Héberger le jeu ailleurs que sur ton PC

Sur la machine `e2-micro` **gratuite à vie** de Google Cloud, pour que le jeu
soit joignable même quand ton ordinateur est éteint.

Google, plutôt qu'Oracle, pour une raison précise : Oracle **récupère les
machines inactives** au bout de 7 jours sous 20 % d'utilisation — soit
exactement le profil d'un serveur de soirée. Google ne le fait pas. Le prix à
payer est la latence : les régions gratuites sont toutes aux États-Unis, donc
~130 ms depuis la France au lieu de ~15 ms.

### 1. Créer la machine

Sur https://console.cloud.google.com :

1. Crée un projet, ajoute une carte (vérification d'identité — voir l'avertissement plus bas)
2. **Facturation → Budgets → Créer un budget à 1 €** avec alerte par mail. Fais-le tout de suite.
3. **Compute Engine → Instances de VM → Créer une instance**

| Réglage | Valeur |
|---|---|
| Région | `us-central1` (Iowa), `us-west1` (Oregon) ou `us-east1` (Caroline du Sud) — **aucune autre n'est gratuite** |
| Type de machine | **E2 → `e2-micro`** |
| Disque de démarrage | Debian 12, **disque persistant standard**, 30 Go |
| Pare-feu | **Ne coche rien** — le tunnel n'a besoin d'aucun port entrant |

### 2. Envoyer le projet

Depuis ton PC, avec le [SDK gcloud](https://cloud.google.com/sdk/docs/install) :

```powershell
npm run push
```

Le client est compilé **sur ton PC** puis envoyé tout fait : sur 1 Go de RAM,
Vite se ferait tuer par le noyau. Le script exclut `server/data`, donc les
scores et les mots ajoutés côté serveur ne sont jamais écrasés.

Si ton instance ne s'appelle pas `undercover` ou n'est pas en `us-central1-a` :

```powershell
$env:GCP_INSTANCE = "mon-instance"; $env:GCP_ZONE = "us-west1-b"; npm run push
```

### 3. Installer, une seule fois

Connecte-toi en SSH (bouton **SSH** dans la console Google), puis :

```bash
cd ~/undercover
bash scripts/server-setup.sh undercover.tondomaine.org
```

Il installe Node, crée **2 Go de fichier d'échange** (sans quoi la compilation
meurt), compile, et pose un service système qui redémarre tout seul.

Puis le tunnel :

```bash
cloudflared tunnel login          # ouvre l'adresse affichée sur ton PC
bash scripts/server-tunnel.sh undercover.tondomaine.org
```

### Au quotidien

```powershell
npm run push                      # publier tes modifications
```

```bash
sudo systemctl status undercover cloudflared
sudo journalctl -u undercover -f
```

Les deux services démarrent au boot : la machine peut redémarrer sans toi.

### ⚠️ La carte bancaire

Elle sert à la vérification d'identité — une machine gratuite allumée en
permanence attire les mineurs et les spammeurs.

**Le risque réel** : passé les 90 jours de crédits d'essai, il faut basculer en
compte payant pour continuer, et tout dépassement est alors **facturé
automatiquement**, sans validation. Le tier gratuit permanent continue sans
frais, mais la barrière est moins haute que chez Oracle. D'où le budget à 1 €
dès l'inscription.

Les quotas gratuits : **1 seule** `e2-micro`, 30 Go de disque standard, et
**1 Go de trafic sortant par mois**. Ce dernier point est large pour ton usage —
le client compressé fait ~127 Ko et se met en cache.

## Jouer avec des inconnus

Les parties sont **privées par défaut** : on n'y entre qu'avec le code.

Le bouton **🌍 Partie publique** de l'écran d'accueil place le joueur dans une
partie ouverte, et **n'échoue jamais** : s'il n'y a personne, il en ouvre une et
le joueur devient le premier à attendre — la suivante le trouvera. « Aucune
partie disponible » est la façon dont un salon public meurt avant d'exister.

Délibérément **pas une liste à parcourir**. Une liste n'a de valeur qu'une fois
pleine, et à faible affluence elle fait l'inverse de ce qu'il faut : six
personnes réparties sur trois salons, ce sont trois salons qui ne peuvent pas
démarrer, puisqu'il en faut trois par table. Le bouton rejoint donc **le salon
le plus rempli** encore au lobby.

Une partie déjà ouverte se rend publique depuis ⚙️ **Réglages → Le salon**.
Utile surtout quand il manque deux ou trois personnes pour démarrer : le jeu vit
de connaître ceux qu'on accuse, et entre inconnus complets il reste bon mais
nettement plus sec.

## Arriver en retard

Rien à faire de particulier : on entre le code et son pseudo comme tout le
monde. Si une partie tourne déjà, le bouton **Rejoindre** installe le retardataire
dans les gradins au lieu de le renvoyer — son pseudo, son avatar et sa couleur
sont retenus et réservés dès cet instant, personne d'autre ne peut les prendre.

Il voit la manche se dérouler exactement comme le grand écran : aucun mot,
aucun rôle, aucune charge privée ne descend par ce canal, et rien ne remonte —
il ne peut ni voter, ni écrire, ni agir. Quand la partie se termine et que
l'hôte relance, **il est assis automatiquement**, avec son avatar, à zéro point.
Son téléphone bascule tout seul sur sa carte de rôle.

Depuis le salon, où il n'y a pas de manche à attendre, un bouton lui permet de
prendre sa place tout de suite.

## Ce qui se passe autour des indices

Trois options, toutes activables depuis ⚙️ **Réglages**, toutes allumées par
défaut.

### Réactions

Chacun colle un emoji sous l'indice d'un autre — 🤨 👍 😂 👀 💀 ⭐. Ça remplit le
seul temps mort de la partie : la description, où l'on attendait son tour en
silence. Et ça donne un vrai signal — trois 🤨 sous le même indice, tout le monde
le voit au moment de voter.

Elles vivent **sous l'indice**, pas dans le chat : le chat n'existe que pendant
le débat, alors que le moment à remplir est la description. Collées à l'indice,
elles sont encore là quand le vote s'ouvre.

Deux règles délibérées. Elles sont **signées, jamais anonymes** : réagir sans
que personne puisse t'en demander compte ne coûte rien et ne veut rien dire.
Et **seuls les vivants réagissent**, pour la même raison qu'ils sont seuls à
pouvoir écrire — un éliminé sait des choses, et un 🤨 bien placé lui permettrait
de continuer à diriger une partie dont il est sorti.

### Dernier soupçon

Un civil qui vient d'être éliminé a quelques secondes (20 par défaut) pour
nommer **tous** les imposteurs encore debout. S'il vise juste **et que les civils
perdent quand même**, il marque 2 points. C'est une consolation pour avoir bien
lu la table dans une partie qu'il ne pouvait plus gagner — jamais un bonus
ajouté à une victoire déjà acquise.

Deux choses le rendent jouable :

- **La réponse est secrète** jusqu'au bilan. Affichée en direct, le mort
  deviendrait un oracle : il n'a plus rien à perdre et dirait simplement aux
  vivants sur qui voter.
- **Le compte à rebours ne bloque personne.** Il tourne sur son seul téléphone
  pendant que la manche continue. Sinon on ajouterait vingt secondes d'attente
  après chaque mort.

### Palmarès

Trois ou quatre titres à la fin, calculés sur ce qui s'est réellement passé :
🦎 *le caméléon* (imposteur jamais visé par un seul vote), 🪤 *le paratonnerre*
(le civil que tout le monde a soupçonné pour rien), 🧭 *la boussole cassée*,
🐑 *le mouton*, 🗡️ *le bourreau*, ⭐ *la star*, 🎪 *le clown*…

Aucun point en jeu — c'est le commentaire de la soirée. Chaque titre a un seuil
en dessous duquel il se tait, et une égalité l'annule au lieu d'être départagée :
« le plus X » n'est drôle que si quelqu'un l'était vraiment. Un joueur ne porte
qu'un titre, et il n'y en a jamais plus de quatre.

## Récompense et punition

Trois réglages liés, tous **éteints par défaut** — ils changent la façon de
jouer, pas seulement de compter.

| Réglage | Effet |
|---|---|
| **Récompense et punition** | Chaque bulletin de civil est payé : `detective` points gagnés s'il vise un imposteur, autant de perdus sinon. |
| **Limite basse des scores** | Jusqu'où une mauvaise manche fait descendre — trois modes, ci-dessous. |
| **Vote blanc** | Refuser d'accuser. Ne nomme personne, ne rapporte ni ne coûte rien. |

**Les imposteurs ne sont jamais concernés.** Voter faux est leur métier ; les
payer pour ça reviendrait à les récompenser deux fois. Mister White non plus.

### La limite basse

| Mode | Effet | Pour qui |
|---|---|---|
| **Par manche** | Une manche ne coûte jamais rien : au pire elle rapporte zéro. | Punir les tièdes sans jamais reprendre ce qui est acquis. |
| **Cumulé** *(défaut)* | La manche mord dans les points déjà gagnés, mais le total ne passe pas sous zéro. | Le compromis : une mauvaise manche coûte du terrain sans enterrer personne. |
| **Aucune** | Pas de limite. On peut finir la soirée dans le négatif. | Les tables qui veulent que ça pique. |

Le choix n'est pas cosmétique : **il décide de qui la punition touche vraiment**.
En mode `Par manche`, tout ce qui est acquis est protégé, donc les joueurs en
tête ne risquent rien. Les deux autres les exposent.

Le réglage n'apparaît que si le mode récompense/punition est allumé — rien
d'autre dans le jeu ne peut faire descendre un score.

Le **vote blanc** a son propre interrupteur parce qu'il vaut le coup seul, mais
il prend tout son sens ici : sans lui, un tableau qui paie les bulletins pousse
à accuser au hasard plutôt qu'à reconnaître qu'on n'a rien.

## Simuler des parties pour régler le barème

**Le plus simple : ouvre `/simulate`** (lien depuis les réglages de l'écran
hôte). Tous les paramètres sont au curseur, on lance, et les résultats
s'affichent — victoires par camp, points moyens, verdict d'équilibre, et le
balayage qui désigne la meilleure valeur.

En ligne de commande, si tu préfères :

```bash
npm run simulate -- --games 3000 --players 7
npm run simulate -- --config simulation.example.json
npm run simulate -- --sweep mrwhite=3,4,5,6,7      # compare plusieurs valeurs
```

Le simulateur joue des milliers de parties contre le **vrai moteur** — mêmes
rôles, mêmes conditions de victoire, même scoring — et rapporte le taux de
victoire par camp, les points moyens par rôle, la fréquence de chaque titre et
l'écart d'espérance entre les camps.

### Les soirées

Les parties sont groupées en **soirées** (`sessionLength`, 5 par défaut) : la
même table enchaîne plusieurs parties, les scores se cumulent, puis le tableau
final est relevé. C'est ce qui donne les **scores finaux** — moyenne par place,
médiane, et surtout l'**écart entre le premier et le dernier**, qui dit si la
soirée reste jouable jusqu'au bout ou si quelqu'un écrase.

Sans ça, deux réglages sont tout simplement invisibles : `par manche` et
`cumulé` se comportent à l'identique dans une partie isolée et ne divergent
qu'une fois qu'il y a un total à entamer.

Ce qu'il ne modélise **pas**, c'est le langage : un robot ne peut pas écrire un
indice habile ou maladroit. Ce qui décide les vraies parties est donc remplacé
par un seul bouton honnête, `skill` — la probabilité qu'un bulletin de civil
tombe sur un imposteur. Lis la sortie comme « pour une table qui démasque 55 %
du temps, ce barème est-il juste ? », qui est la question à laquelle un barème
doit répondre.

Tout va dans `simulations/`, et jamais dans tes vraies données — le serveur
lance un **processus séparé** avec `UNDERCOVER_DATA_DIR` redirigé, ce qui est la
seule façon d'en être sûr.

**La graine rend une série rejouable à l'identique**, y compris la distribution
des rôles et l'ordre de passage. C'est ce qui rend un balayage honnête : les
cinq valeurs comparées jouent exactement les mêmes parties, donc l'écart mesuré
vient du barème et de rien d'autre.

| Option | Rôle |
|---|---|
| `--games`, `--players`, `--skill`, `--seed` | La série à jouer. |
| `--set.discussTime 0`, `--roles.mrwhite true` | N'importe quel réglage du jeu. |
| `--points.mrwhite 4` | N'importe quelle valeur du barème. |
| `--sweep <clé>=<v1,v2,…>` | Rejoue la même série pour chaque valeur et désigne la plus équilibrée. |

## Tests

```bash
npm test
```

Ils tournent dans `tests/.scratch/` grâce à `UNDERCOVER_DATA_DIR`. C'est une
correction, pas un détail : les suites démarrent le vrai serveur, donc chaque
partie de robot tirait de vraies paires et les marquait « déjà jouées » dans
l'historique de la maison. Des centaines de paires ont été brûlées par des
robots que personne à la table n'a jamais vues.

## Qui pilote la partie

**Le grand écran n'est plus obligatoire.** N'importe qui peut ouvrir une partie
depuis son téléphone : bouton **✨ Créer une partie** sur l'écran d'accueil. Le
créateur porte la couronne 👑 et dispose de tout.

| | Téléphone 👑 | Écran `/host` |
|---|---|---|
| Créer une partie | ✅ | ✅ |
| Lancer, passer au vote, manche suivante, rejouer | ✅ | ✅ |
| Thèmes, rôles, barème, réglages | ✅ | ✅ |
| Expulser, donner la couronne | ✅ | ✅ |

Sur le téléphone tout se trouve derrière **⚙️ Régler la partie**, dans le salon.
Les panneaux sont littéralement les mêmes objets que ceux du grand écran, pas
des copies — deux versions divergeraient à la première option ajoutée.

L'écran `/host` reste ce qu'il a de meilleur à offrir : la grille d'indices que
tout le monde lit ensemble, la carte de l'éliminé qui se retourne, le palmarès
animé. Il devient un **complément**, plus un péage.

### Qui a le droit de commander

| Situation | Résultat |
|---|---|
| L'écran qui a **ouvert** la partie | ✅ commande |
| Le joueur qui porte la **couronne** | ✅ commande |
| Un écran qui rejoint par le code | 👁 **affichage seul** |
| N'importe qui d'autre | ❌ refusé |

Ce dernier point est délibéré. `/host` peut désormais afficher une partie
existante, et si connaître un code à quatre lettres suffisait à obtenir les
pouvoirs d'hôte, n'importe qui pourrait deviner un code et saborder la partie
d'inconnus. L'écran qui crée la partie reçoit un **jeton** — c'est lui qui
prouve, après un rafraîchissement, qu'il s'agit bien du même écran et non de
quelqu'un qui a lu le code sur le mur.

## Où lire les règles

Trois portes vers la même chose :

- **📖 dans le jeu** — écran d'accueil, téléphone, ou grand écran. Quatre onglets :
  Rôles, Déroulé, Points, **Réglages**. Atteignable en pleine manche sans perdre
  sa place.
- **`/regles`** — la même chose en page autonome, à envoyer avant une soirée.
- Le tableau ci-dessous, pour qui lit le dépôt.

Ces trois-là ne peuvent pas se contredire : les descriptions vivent dans
[`server/game/settings-fields.js`](server/game/settings-fields.js) et sont lues
aussi bien par le panneau ⚙️ que par la fiche. Un test refuse d'ajouter un
réglage sans le décrire.

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
- **Mister White** gagne s'il nomme le mot des civils — soit **en pleine
  description**, ce qui met fin à la partie sur-le-champ, soit après avoir été
  démasqué — ou s'il atteint le duel final. Il empoche alors sa victoire *et* la
  prime « Mot deviné ». Une tentative ratée passe comme un indice ordinaire : le
  jeu ne lui dit jamais qu'il a chauffé, sinon il saurait sans rien risquer.
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

**Un redémarrage du serveur ne perd pas la soirée.** Le salon, ses joueurs,
leurs scores et les réglages sont sauvegardés sur disque et rechargés au
démarrage — chacun retrouve sa place en rouvrant simplement sa page. En
revanche la manche en cours, elle, est perdue : on repart du salon. Les salons
sauvegardés expirent au bout de 24 h.

### Revoir la partie

L'écran de fin propose un **déroulé manche par manche** : les indices de chacun,
qui a voté pour qui, qui est tombé et avec quel rôle. C'est le moment où tout le
monde découvre à côté de quoi il est passé.

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

Le plus simple : la page **`/words`**, accessible depuis l'onglet 🎲 Thèmes de
l'écran hôte. On y crée un thème, on y ajoute des paires avec leur définition
facultative, et on voit d'un coup d'œil ce qui a déjà été joué.

Tout ce qui est ajouté là atterrit dans `server/data/custom-words.json`, jamais
dans les thèmes fournis : la banque livrée reste intacte et remplaçable, et tes
ajouts tiennent dans un seul fichier à sauvegarder. C'est aussi pour ça que les
paires fournies ne sont pas supprimables depuis l'éditeur — seulement les
tiennes.

Une fois le jeu exposé sur internet, écrire dans la banque demande le
`ADMIN_TOKEN` ; la lecture, non. Le serveur affiche le jeton à son démarrage,
juste sous les adresses — `npm run tunnel` en génère un au hasard si tu n'en
imposes pas un toi-même :

```bash
ADMIN_TOKEN=monsecret npm run tunnel
```

L'ancienne méthode marche toujours — un fichier dans `server/data/words/` :

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

L'historique du « déjà joué » est indexé par le contenu de la paire, pas par sa
position dans le fichier : tu peux ajouter, retirer ou réordonner sans rien
corrompre.

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

S'ajoutent à ça le mode spectateur (arriver en cours de partie et regarder sans
rien voir de secret), l'éditeur de banque de mots, et la restauration d'une
soirée après un redémarrage du serveur.

Pas encore fait : un mode pass-and-play pour ceux qui n'ont pas de téléphone, et
le salon vocal.
