# Ajouter un rôle

Le moteur (`server/game/engine.js`) ne connaît **aucun** rôle par son nom. Il ne
fait qu'appeler les hooks que chaque rôle déclare. Ajouter un rôle = créer un
fichier ici + une ligne dans `index.js`.

## Contrat

```js
export default {
  id: 'espion',            // identifiant stable, utilisé partout
  label: 'Espion',
  emoji: '🔍',
  color: '#a78bfa',
  team: 'civilian',        // équipe pour les conditions de victoire
  tagline: 'Une phrase affichée dans le sélecteur de rôles.',

  minPlayers: 5,           // en dessous, le rôle est grisé dans le lobby
  slots: 1,                // combien de joueurs reçoivent ce rôle (Amoureux : 2)
  winPriority: 0,          // les victoires sont évaluées du plus haut au plus bas

  // --- obligatoire ---
  getWord(ctx),            // -> string | null   le mot remis en début de manche

  brief(ctx),              // -> { title, body, knowsWord, ... }
                           //    le contenu de la carte de révélation

  // --- optionnel ---
  getDef(ctx),             // -> string | null   définition du mot ; par défaut
                           //    le moteur la déduit du mot lui-même
  onAssign(player, ctx),   // juste après la distribution (appairage, cible…)
  onVote(voter, target, ctx),        // -> { weight } pour pondérer un vote
  onEliminated(player, ctx, cause),  // cause : 'vote' | 'tiebreak' | 'revenge' | 'grief'
  checkWin(ctx),                     // -> { team, reason, teams?, winners? } | null
  onGameEnd(ctx),                    // -> [ { playerId, key, label, points } ]

  votesWhenDead: true,     // autorise le vote après élimination (Fantôme)
  canApply(player, ctx),   // modificateurs : refuser certaines mains
  tiebreak: { … },         // réclamer le départage des égalités
}
```

`ctx` contient : `players`, `alive`, `words`, `settings`, `round`, `game`,
`roleOf(p)`, `teamOf(p)`, `aliveOnTeam(team)`.

`player.data` est un objet libre réservé au rôle (l'Espion y range sa cible).

### `onEliminated` peut détourner le déroulement

```js
onEliminated: (player, ctx, cause) => ({
  win: { team, reason },        // fin immédiate de la partie
  alsoEliminate: [playerId],    // morts en chaîne (les hooks de ces morts jouent aussi)
  note: 'texte affiché sur les deux écrans',
  interrupt: { kind: 'mrwhiteGuess' },
  // ou
  interrupt: {
    kind: 'revenge',
    label, emoji, prompt,
    allowSkip: true, skipLabel: '…',
    targets: [playerId, …],
  },
})
```

Plusieurs interruptions peuvent se déclencher sur la même mort — un joueur qui
est à la fois Mister White **et** Vengeuse en produit deux. Elles sont mises en
file et jouées l'une après l'autre, aucune n'écrase l'autre.

### Victoires partagées

`checkWin` peut désigner plusieurs camps et nommer explicitement les gagnants :

```js
return {
  team: 'mrwhite',                    // camp principal (couleur du bandeau)
  teams: ['mrwhite', 'undercover'],   // victoire partagée
  winners: [playerId, …],             // qui encaisse
  reason: '…',
}
```

Chaque camp est alors payé à son propre tarif.

### Objectifs annexes (`onGameEnd`)

Un trait peut distribuer des points indépendamment du vainqueur. Appelé une fois
en fin de partie, il renvoie une liste de récompenses :

```js
onGameEnd: (ctx) => [{
  playerId,
  key: 'duelliste',
  label: 'Duel remporté',
  points: ctx.points.duelliste,   // jamais un nombre en dur
}]
```

Le moteur estampille chaque mort avec `player.data.eliminatedRound`,
`eliminatedCause` et `eliminatedOrder`, ce qui suffit à juger après coup.

### Le barème est réglable

`ctx.points` contient le barème en vigueur pour cette partie : les valeurs par
défaut de `scoring.js` fusionnées avec les réglages de l'hôte, bornées. **Aucun
rôle ne doit écrire un nombre de points en dur**, ni dans `onGameEnd`, ni dans
le texte de `brief` — sinon la carte du joueur mentirait dès que l'hôte touche
au barème.

Pour ajouter un réglage : une entrée dans `DEFAULT_POINTS` et une dans
`POINT_FIELDS` (avec `min`, `max`, et `role` si le réglage ne concerne qu'un
rôle). L'interface des réglages et la fiche de règles se construisent
automatiquement à partir de ces descripteurs.

### Départage des égalités

Un rôle peut réclamer le pouvoir de trancher un vote nul. Le moteur cherche un
joueur vivant dont le rôle déclare `tiebreak` et lui passe la main ; sinon
personne n'est éliminé, comme avant.

```js
tiebreak: {
  label: 'Départage',
  emoji: '⚖️',
  prompt: 'Texte affiché à celui qui décide.',
  allowAbstain: true,
  abstainLabel: 'Personne ne part',
},
```

L'identité de l'arbitre n'est **jamais** publiée : l'état public ne contient que
les joueurs à égalité, pas qui décide.

## Modificateurs

Un modificateur (`server/game/modifiers/`) se superpose à un rôle au lieu de le
remplacer. Même contrat de hooks, à quatre différences près :

- son `brief` renvoie un **bloc supplémentaire** (`{ title, body, color }`)
  ajouté sous la carte, au lieu de la carte entière ;
- il est distribué **après** les rôles, donc il peut tomber sur n'importe quelle
  main — et il ne coûte aucun siège dans la composition ;
- il peut refuser une main avec `canApply(player, ctx)` ;
- marqué `secret: true`, il n'est **jamais** publié par le jeu, pas même sur la
  carte d'élimination. Seul le bilan final le dévoile.

`ctx.hasModifier(player, id)` permet de tester leur présence.

### Quand `secret` ?

Quand le pouvoir cesse de fonctionner dès qu'on sait qui le détient : le
bulletin doublé du Maire, la voix prépondérante du Justicier, le vote d'outre-
tombe du Fantôme. À l'inverse, les traits qui se trahissent d'eux-mêmes
(Amoureux dont la mort est liée, Vengeuse qui frappe) ou dont la révélation est
le sel du jeu (Bouffon) restent publics.

## Rôles et modificateurs livrés

### Rôles (exclusifs, un par joueur)

Ce sont les **seuls** rôles. Tout le reste est un modificateur : ce qui décide
d'un camp et d'un mot est un rôle, ce qui ajoute un pouvoir ou un pari est un
modificateur.

| | Équipe | Min | Mécanique |
|---|---|---|---|
| **Civil** 🧑 | `civilian` | — | Le mot majoritaire. Gagne quand infiltrés et Mister White sont éliminés. |
| **Infiltré** 🕵️ | `undercover` | — | Mot voisin. Gagne à la parité, ou dès qu'il ne reste qu'un civil. |
| **Mister White** 🃏 | `mrwhite` | 4 | Aucun mot. Éliminé, il tente de deviner le mot des civils. |

### Modificateurs (superposés au rôle)

Tous gardent leur rôle de base et son mot.

| | Slots | Min | Secret | Mécanique |
|---|---|---|---|---|
| **Amoureux** 💘 | 2 | 5 | — | Deux joueurs liés qui se connaissent. Un Infiltré et un Civil peuvent former le couple. Si l'un meurt l'autre suit ; s'ils sont les deux derniers, ils gagnent ensemble. |
| **Vengeuse** 🗡️ | 1 | 5 | — | Lynchée, elle désigne quelqu'un qui tombe avec elle. |
| **Duelliste** ⚔️ | 2 | 5 | — | Deux rivaux qui se connaissent. Celui qui survit le plus longtemps marque 2 pts. Aucun effet sur la victoire. |
| **Bouffon** 🤡 | 1 | 4 | — | Marque 3 pts s'il se fait lyncher dès la 1re manche. Ne gagne jamais la partie. |
| **Mercenaire** 🎯 | 1 | 4 | — | Une cible tirée au hasard. Si elle tombe dès la 1re manche : 2 pts. |
| **Maire** 🎩 | 1 | 4 | 🔒 | Son bulletin compte double. **Civils uniquement** (`canApply`). Jamais révélé par le jeu. |
| **Justicier** ⚖️ | 1 | 5 | 🔒 | Départage les égalités de vote, ou épargne tout le monde. Jamais révélé. |
| **Fantôme** 👻 | 1 | 5 | 🔒 | Continue de voter une fois éliminé. **Civils uniquement** (`canApply`). Jamais révélé. |

## Notes de conception

- **Trois rôles seulement.** Bouffon, Maire et Justicier étaient des rôles ; ce
  sont désormais des modificateurs posés sur un rôle de base. Un Maire peut donc
  être Infiltré, et un Bouffon peut saborder son propre camp — ce qui est
  précisément l'intérêt.
- **Le Bouffon compte dans le camp de son rôle.** Il ne gagne plus la partie, il marque. Une table
  réduite à un Civil, un Bouffon et un Infiltré continue donc de jouer — deux
  joueurs du camp civil sont encore debout.
- **Les Amoureux ont la priorité de victoire la plus haute** (`winPriority: 30`),
  au-dessus de la parité des infiltrés — sinon un couple mixte arrivé en finale
  verrait la victoire attribuée au camp de l'un des deux.
- **Mister White et les Infiltrés se partagent la victoire** quand il ne reste
  qu'un seul civil et que les deux camps sont encore debout. Aucun des deux
  n'y serait arrivé sans l'autre.
- **La Vengeuse ne se déclenche qu'au lynchage.** Mourir de chagrin ou tomber
  sous la vengeance d'une autre ne l'active pas, sinon un seul vote pourrait
  faire s'écrouler la moitié de la table.
- **Le Fantôme et le Maire sont réservés aux civils.** Un Infiltré mort qui
  continuerait de voter offrirait un bulletin permanent à son camp ; un Infiltré
  au vote doublé, qui sait déjà qui est qui, dirigerait chaque élimination.
- **Le mot d'un joueur éliminé n'est jamais publié** avant la fin de la partie.
  Son rôle l'est — c'est la récompense du vote — mais annoncer « son mot était
  Autoroute » donnerait aux infiltrés le seul secret qui compte. Voir
  `publicResult()` dans `engine.js`.
- **Quitter ou être expulsé ne déclenche aucun hook de mort.**
- **Le tirage des rôles est équitable.** `traitOrder` est une permutation
  aléatoire de `OPTIONAL_TRAITS`, retirée à chaque changement de réglages et à
  chaque nouvelle partie. Sans elle, le rôle déclaré en premier gagnait toujours
  quand la table était trop petite pour tout accueillir.
