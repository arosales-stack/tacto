// Credit estimate for a custom request.
// For now: a fixed table matched on keywords (first match wins, most specific first).
// Later: replace estimate() with an AI call that returns the same shape.

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
const FALLBACK = { id: 'custom', label: 'Demande sur mesure', credits: 10, delay: '2 à 5 jours' };

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function estimate(text) {
  const t = normalize(text ?? '');
  if (t.trim().length < 12) return null;
  const rule = RULES.find((r) => r.keywords.some((k) => t.includes(normalize(k)))) ?? FALLBACK;
  const { id, label, credits, delay } = rule;
  return { id, label, credits, delay };
}

export const EXAMPLES = RULES.map(({ label, credits }) => ({ label, credits }));
