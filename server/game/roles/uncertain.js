/**
 * The card everybody gets when "les infiltrés savent qu'ils le sont" is off.
 *
 * Civil and Infiltré must receive a **byte-identical** brief in that mode —
 * otherwise the wording itself becomes the tell, and the whole variant
 * collapses. Both roles import this one function rather than each keeping their
 * own copy, so the two can never drift apart.
 *
 * The text is deliberately unsettling: it does not say "you are a Civil", it
 * says "nobody knows which side of the pair they got". That is the point of the
 * variant — everyone plays their first round suspecting themselves.
 */
export function uncertainBrief() {
  return {
    title: 'Tu as un mot',
    body: "Personne à cette table ne sait s'il a le mot de la majorité. Le tien est peut-être celui des infiltrés — tu ne le sauras qu'en écoutant les descriptions des autres. Décris-le sans le dire, prudemment : si tu te découvres à contre-courant, c'est que tu es l'imposteur.",
    knowsWord: true,
    uncertain: true,
  }
}
