/**
 * What every game setting does, in one place.
 *
 * The roles already work this way — their rules live on the role definitions,
 * so the rulebook cannot describe something the code does not do. The point
 * scale does too, through `POINT_FIELDS`. The game settings were the exception:
 * their explanations sat hardcoded in the settings panel, which meant any
 * reference page would have been a second copy, drifting within a month.
 *
 * So the panel and the rulebook both read from here. Changing a wording changes
 * it everywhere, and adding a setting without describing it is visible at once.
 *
 * `hint` is the one-liner under the control. `when` is the advice you only want
 * when you are actually reading up — deliberately about *when to switch it on*
 * rather than what it means, because that is the question a host really has.
 * Default values are not repeated here: they come from `DEFAULT_SETTINGS`.
 */

export const SETTING_GROUPS = [
  { id: 'deal', emoji: '🎲', label: 'La distribution', blurb: 'Qui reçoit quoi, et avec quels mots.' },
  { id: 'flow', emoji: '⏱️', label: 'Le déroulé', blurb: 'Comment une manche s\'enchaîne.' },
  { id: 'mood', emoji: '🎭', label: "L'ambiance", blurb: 'Ce qui se passe autour du jeu.' },
  { id: 'scoring', emoji: '💯', label: 'Les points', blurb: 'Ce qui rapporte, et ce qui coûte.' },
]

export const SETTING_FIELDS = [
  {
    key: 'themeIds',
    group: 'deal',
    emoji: '🗂️',
    label: 'Thèmes',
    hint: 'Coche autant de thèmes que tu veux, ou aucun pour piocher dans les 16.',
    when: "Le tirage privilégie les thèmes qui ont le plus de paires inédites, donc laisser tout coché reste le meilleur choix par défaut. Restreins pour une soirée à thème, ou quand un thème ne parle pas au groupe.",
  },
  {
    key: 'undercoverCount',
    group: 'deal',
    emoji: '🕵️',
    label: "Nombre d'infiltrés",
    hint: '« Auto » suit la taille de la table : 1 jusqu\'à 6 joueurs, 2 jusqu\'à 9, 3 jusqu\'à 12.',
    when: "Laisse sur Auto. En forcer deux à cinq joueurs rend les civils presque incapables de gagner : il suffit d'une erreur de vote pour atteindre la parité.",
  },
  {
    key: 'undercoverKnowsRole',
    group: 'deal',
    emoji: '🎭',
    label: "Les infiltrés savent qu'ils le sont",
    hint: "Désactivé : ils reçoivent une carte de civil et doivent comprendre seuls qu'ils ont le mauvais mot.",
    when: "Désactive-le avec des habitués. La partie devient beaucoup plus tendue — personne ne sait de quel côté il joue, et un civil qui doute de lui se trahit tout seul. À éviter pour une première partie, où l'on a déjà assez à comprendre.",
  },
  {
    key: 'writtenClues',
    group: 'flow',
    emoji: '✍️',
    label: 'Indices écrits',
    hint: "Chaque joueur tape son indice, qui s'affiche pour tout le monde.",
    when: "Garde-le activé : c'est ce qui permet la liste d'indices, l'historique, les réactions et le chat. Désactive-le seulement si tout le monde est autour d'une table et préfère parler à voix haute — le jeu se contente alors de gérer les rôles et les votes.",
  },
  {
    key: 'turnTimer',
    group: 'flow',
    emoji: '⏳',
    label: 'Chrono par tour',
    hint: "Temps écoulé sans indice : « … » s'affiche à la place, visible de tous.",
    when: "Utile quand quelqu'un réfléchit trop longtemps et que la partie s'enlise. 40 secondes suffisent largement. Sans chrono, c'est à la table de presser les hésitants.",
  },
  {
    key: 'discussTime',
    group: 'flow',
    emoji: '💬',
    label: 'Temps de discussion',
    hint: 'Débat libre entre les indices et le vote.',
    when: "C'est là que la partie se joue vraiment — ne le mets pas à zéro sauf si vous jouez très vite. Une minute pour six joueurs, deux au-delà. Tout le monde peut voter d'accord pour l'écourter, ou la couronne l'interrompre.",
  },
  {
    key: 'reactions',
    group: 'mood',
    emoji: '🤨',
    label: 'Réactions sur les indices',
    hint: 'Chacun colle un emoji sous l\'indice des autres : 🤨 👍 😂 👀 💀 ⭐.',
    when: "Laisse activé. Ça remplit le seul temps mort du jeu — la description, où l'on attend son tour en silence — et trois 🤨 sous le même indice, tout le monde les voit au moment de voter. Les réactions sont signées, jamais anonymes.",
  },
  {
    key: 'endTitles',
    group: 'mood',
    emoji: '🏅',
    label: 'Palmarès de fin de manche',
    hint: "Titres décernés d'après ce qui s'est réellement passé. Aucun point en jeu.",
    when: "Purement décoratif, et c'est ce qu'on raconte le lendemain : le caméléon jamais soupçonné, le paratonnerre accusé pour rien, la boussole cassée. Chaque titre a un seuil sous lequel il se tait, donc une partie courte n'en décerne aucun.",
  },
  {
    key: 'detectiveMode',
    group: 'scoring',
    emoji: '🔍',
    label: 'Récompense et punition',
    hint: "Chaque bulletin de civil est payé : autant de points gagnés s'il vise un imposteur, autant de perdus sinon.",
    when: "Pour les tables où l'on vote au hasard ou en suivant le plus bruyant. Ça met un prix sur l'accusation, donc les suiveurs ralentissent et ceux qui lisent vraiment la table sont payés. Les imposteurs ne sont jamais concernés — voter faux est leur métier.",
  },
  {
    key: 'scoreFloor',
    group: 'scoring',
    emoji: '📉',
    label: 'Limite basse des scores',
    hint: "Jusqu'où une mauvaise manche peut faire descendre.",
    when: "N'a d'effet que sous récompense et punition. « Par manche » protège tout l'acquis, donc ceux qui sont en tête ne risquent rien — c'est le mode le plus doux. « Cumulé » laisse une mauvaise manche coûter du terrain sans jamais enterrer personne. « Aucune » autorise les scores négatifs.",
    dependsOn: 'detectiveMode',
  },
  {
    key: 'blankVote',
    group: 'scoring',
    emoji: '🤷',
    label: 'Vote blanc',
    hint: "Permet de refuser d'accuser. Ne nomme personne, ne rapporte ni ne coûte rien.",
    when: "Presque indispensable avec récompense et punition : sans lui, un tableau qui paie les bulletins pousse à accuser au hasard plutôt qu'à reconnaître qu'on n'a rien. Sans ce mode, il ralentit un peu les manches.",
  },
  {
    key: 'dyingGuess',
    group: 'scoring',
    emoji: '🔮',
    label: 'Dernier soupçon',
    hint: 'Un civil éliminé nomme en secret tous les imposteurs restants.',
    when: "Une consolation pour avoir bien lu la table dans une partie qu'on ne pouvait plus gagner — les points ne tombent que si les civils perdent quand même. La réponse reste secrète jusqu'au bilan, sinon un mort dirait simplement aux vivants sur qui voter.",
  },
  {
    key: 'dyingGuessTime',
    group: 'scoring',
    emoji: '⏱️',
    label: 'Temps de réflexion',
    hint: 'Le compte à rebours tourne sur son seul téléphone, la manche continue sans lui.',
    when: "Vingt secondes suffisent : il s'agit de nommer des gens, pas de réfléchir longuement. La table n'attend jamais — c'est ce qui permet de garder l'option allumée sans ralentir la soirée.",
    dependsOn: 'dyingGuess',
  },
]
