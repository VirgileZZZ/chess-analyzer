// Traduction des noms d'ouvertures (base Lichess, en anglais) vers le français.
// Familles connues traduites en entier, puis remplacement des termes génériques.

const FAMILIES = [
  ["King's Pawn Game", 'Partie du pion roi'], ["Queen's Pawn Game", 'Partie du pion dame'],
  ["King's Gambit Accepted", 'Gambit du roi accepté'], ["King's Gambit Declined", 'Gambit du roi refusé'], ["King's Gambit", 'Gambit du roi'],
  ["Queen's Gambit Accepted", 'Gambit Dame accepté'], ["Queen's Gambit Declined", 'Gambit Dame refusé'], ["Queen's Gambit", 'Gambit Dame'],
  ["King's Indian Defense", 'Défense est-indienne'], ["King's Indian Attack", 'Attaque est-indienne'],
  ["Queen's Indian Defense", 'Défense ouest-indienne'], ['Nimzo-Indian Defense', 'Défense nimzo-indienne'],
  ['Bogo-Indian Defense', 'Défense bogo-indienne'], ['Old Indian Defense', 'Défense vieille-indienne'],
  ['Indian Defense', 'Défense indienne'], ['Grünfeld Defense', 'Défense Grünfeld'], ['Benoni Defense', 'Défense Benoni'],
  ['Benko Gambit', 'Gambit Benko'], ['Dutch Defense', 'Défense hollandaise'], ['Slav Defense', 'Défense slave'],
  ['Semi-Slav Defense', 'Défense semi-slave'], ['French Defense', 'Défense française'], ['Sicilian Defense', 'Défense sicilienne'],
  ['Caro-Kann Defense', 'Défense Caro-Kann'], ['Scandinavian Defense', 'Défense scandinave'], ['Pirc Defense', 'Défense Pirc'],
  ['Modern Defense', 'Défense moderne'], ["Alekhine Defense", 'Défense Alekhine'], ['Philidor Defense', 'Défense Philidor'],
  ['Petrov\'s Defense', 'Défense Petrov'], ['Russian Game', 'Défense russe (Petrov)'], ['Owen Defense', 'Défense Owen'],
  ['Nimzowitsch Defense', 'Défense Nimzowitsch'], ['Englund Gambit', 'Gambit Englund'], ['Budapest Defense', 'Gambit de Budapest'],
  ['Italian Game', 'Partie italienne'], ['Giuoco Piano', 'Giuoco Piano'], ['Ruy Lopez', 'Partie espagnole'],
  ['Scotch Game', 'Partie écossaise'], ['Scotch Gambit', 'Gambit écossais'], ['Vienna Game', 'Partie viennoise'], ['Vienna Gambit', 'Gambit viennois'],
  ['Four Knights Game', 'Partie des quatre cavaliers'], ['Three Knights Opening', 'Partie des trois cavaliers'],
  ['Two Knights Defense', 'Défense des deux cavaliers'], ['Evans Gambit', 'Gambit Evans'], ['Danish Gambit', 'Gambit danois'],
  ['Center Game', 'Partie du centre'], ['Bishop\'s Opening', 'Ouverture du fou'], ['Ponziani Opening', 'Ouverture Ponziani'],
  ['English Opening', 'Ouverture anglaise'], ['Réti Opening', 'Ouverture Réti'], ['Zukertort Opening', 'Ouverture Zukertort'],
  ['London System', 'Système de Londres'], ['Colle System', 'Système Colle'], ['Torre Attack', 'Attaque Torre'],
  ['Trompowsky Attack', 'Attaque Trompowsky'], ['Catalan Opening', 'Ouverture catalane'], ['Bird Opening', 'Ouverture Bird'],
  ['Polish Opening', 'Ouverture polonaise'], ['Nimzo-Larsen Attack', 'Attaque Nimzo-Larsen'], ['Van\'t Kruijs Opening', 'Ouverture Van\'t Kruijs'],
  ['Hungarian Opening', 'Ouverture hongroise'], ['Grob Opening', 'Ouverture Grob'], ['Amar Opening', 'Ouverture Amar'],
  ['Elephant Gambit', 'Gambit de l\'éléphant'], ['Latvian Gambit', 'Gambit letton'], ['Blackmar-Diemer Gambit', 'Gambit Blackmar-Diemer'],
  ['Richter-Veresov Attack', 'Attaque Richter-Veresov'], ['Rat Defense', 'Défense du rat'], ['Mieses Opening', 'Ouverture Mieses'],
  ['Kings Pawn', 'Pion roi'],
];

const ADJ = [
  ['Advance', "d'avance"], ['Exchange', "d'échange"], ['Classical', 'classique'], ['Modern', 'moderne'], ['Main', 'principale'],
  ['Open', 'ouverte'], ['Closed', 'fermée'], ['Normal', 'normale'], ['Accelerated', 'accélérée'], ['Hyperaccelerated', 'hyper-accélérée'],
  ['Deferred', 'différée'], ['Reversed', 'inversée'], ['Old', 'ancienne'], ['Symmetrical', 'symétrique'], ['Fianchetto', 'fianchetto'],
  ['Two Knights', 'des deux cavaliers'], ['Three Knights', 'des trois cavaliers'], ['Four Knights', 'des quatre cavaliers'],
  ['Central', 'centrale'], ['Wing', "de l'aile"], ['Panov', 'Panov'], ['Tarrasch', 'Tarrasch'], ['Winawer', 'Winawer'],
];
const SUFFIX = [
  ['Gambit Accepted', 'gambit accepté'], ['Gambit Declined', 'gambit refusé'], ['Variation', 'variante'], ['Attack', 'attaque'],
  ['Countergambit', 'contre-gambit'], ['Counterattack', 'contre-attaque'], ['Gambit', 'gambit'], ['Line', 'ligne'],
  ['System', 'système'], ['Defense', 'défense'], ['Trap', 'piège'], ['Opening', 'ouverture'], ['Game', 'partie'],
];

function adj(core) {
  let out = core;
  for (const [en, fr] of ADJ) out = out.replace(new RegExp('(^|\\s)' + en + '(?=\\s|$)', 'g'), (m, p) => p + fr);
  return out;
}

function segment(seg) {
  seg = seg.trim();
  for (const [en, fr] of SUFFIX) {
    if (seg === en) return fr;
    if (seg.endsWith(' ' + en)) return fr + ' ' + adj(seg.slice(0, -en.length - 1));
  }
  return adj(seg);
}

const cache = new Map();

export function frOpening(name) {
  if (!name) return name;
  if (cache.has(name)) return cache.get(name);
  let head = name, rest = '';
  const i = name.indexOf(':');
  if (i >= 0) { head = name.slice(0, i); rest = name.slice(i + 1); }
  let fam = null;
  for (const [en, fr] of FAMILIES) if (head === en || head.startsWith(en + ' ')) { fam = fr + head.slice(en.length); break; }
  if (!fam) fam = segment(head);
  fam = fam[0].toUpperCase() + fam.slice(1);
  const out = rest ? fam + ' : ' + rest.split(',').map(segment).join(', ') : fam;
  cache.set(name, out);
  return out;
}
