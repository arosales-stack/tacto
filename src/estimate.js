// Credit estimate for a custom request.
// For now: a fixed table matched on keywords (first match wins, most specific first).
// Later: replace estimate() with an AI call that returns the same shape.
//
// credits: null means no automatic number — either a new project outside the yearly credits
// ('out': separate quote) or a request we don't recognise ('custom': estimated by hand within 24 h).
// Neither reserves credits.

// Checked first: these are new projects, not changes to the site
const OUT_OF_SCOPE = {
  id: 'out', label: 'Hors forfait', credits: null, delay: 'Proposition sous 24 h',
  note: "Ça dépasse les crédits : c'est un nouveau projet. On t'envoie une proposition chiffrée.",
  keywords: ['acheter', 'achat', 'vente en ligne', 'vendre en ligne', 'vendre sur le site', 'boutique en ligne', 'e-commerce', 'ecommerce',
    'paiement', 'payer en ligne', 'payer sur le site', 'panier', 'commande en ligne', 'commander en ligne', 'click and collect',
    'click & collect', 'livraison', 'compte client', 'espace client', 'espace membre', 'abonnement', 'carte cadeau',
    'fidelite', 'application mobile', 'app mobile', 'une appli'],
};

const RULES = [
  { id: 'page', label: 'Nouvelle page', credits: 30, delay: '5 à 7 jours', keywords: ['nouvelle page', 'page entière', 'page complète', 'créer une page', 'ajouter une page', 'nouvel onglet'] },
  { id: 'translation', label: 'Traduction du site', credits: 25, delay: '5 à 7 jours', keywords: ['traduction', 'traduire', 'anglais', 'english', 'espagnol', 'version en'] },
  { id: 'form', label: 'Formulaire', credits: 20, delay: '3 à 5 jours', keywords: ['formulaire', 'inscription', 'réservation en ligne', 'questionnaire'] },
  { id: 'section', label: 'Nouvelle section', credits: 15, delay: '3 à 5 jours', keywords: ['section', 'bloc', 'rubrique', 'encart', 'bandeau', 'nouvelle collection', 'collection', 'événement', 'evenement', 'promo'] },
  { id: 'design', label: 'Modification de design', credits: 10, delay: '2 à 4 jours', keywords: ['couleur', 'police', 'design', 'mise en page', 'disposition', 'style', 'agrandir', 'déplacer', 'deplacer'] },
  { id: 'gallery', label: 'Ajout de photos', credits: 5, delay: '1 à 2 jours', keywords: ['galerie', 'plusieurs photos', 'ajouter des photos', 'nouvelles photos', 'album'] },
  { id: 'photo', label: 'Remplacement de photo', credits: 3, delay: '1 à 2 jours', keywords: ['photo', 'image', 'visuel', 'logo'] },
  { id: 'menu', label: 'Ajout à la carte', credits: 4, delay: '1 à 2 jours', keywords: ['carte', 'produit', 'boisson', 'parfum', 'dessert', 'nouveau café', 'menu'] },
];
const FALLBACK = {
  id: 'custom', label: 'Demande sur mesure', credits: null, delay: 'Estimation sous 24 h',
  note: "On regarde ta demande et on te dit combien de crédits elle représente. Rien n'est déduit avant.",
};

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function estimate(text) {
  const t = normalize(text ?? '');
  if (t.trim().length < 12) return null;
  const matches = (r) => r.keywords.some((k) => t.includes(normalize(k)));
  const rule = (matches(OUT_OF_SCOPE) ? OUT_OF_SCOPE : RULES.find(matches)) ?? FALLBACK;
  const { id, label, credits, delay, note = '' } = rule;
  return { id, label, credits, delay, note };
}

export const EXAMPLES = [
  ...RULES.map(({ label, credits }) => ({ label, credits })),
  { id: 'out', label: 'Vente en ligne, paiement, appli…', credits: null },
];
