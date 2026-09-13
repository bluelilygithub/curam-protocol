'use strict';

// Deterministic best-effort dietary/allergy exclusion filter. NOT a certified
// allergen database — a practical keyword list to catch the common cases and
// flag when the model didn't fully honor a stated restriction. See
// docs/recipes.md "Dietary & allergy restrictions".

const DIETARY_RESTRICTIONS = [
  {
    id: 'vegetarian',
    label: 'Vegetarian',
    instruction: 'Strictly vegetarian — no meat, poultry, fish, or seafood in any ingredient.',
    keywords: [
      'chicken', 'beef', 'pork', 'lamb', 'veal', 'bacon', 'ham', 'sausage', 'salami',
      'prosciutto', 'chorizo', 'mince', 'steak', 'turkey', 'duck', 'gelatin', 'gelatine',
      'fish', 'salmon', 'tuna', 'anchovy', 'anchovies', 'prawn', 'shrimp', 'crab', 'lobster',
      'oyster', 'mussel', 'squid', 'calamari', 'scallop', 'fish sauce', 'oyster sauce',
      'worcestershire', 'lard', 'suet', 'stock (meat)', 'chicken stock', 'beef stock',
      'meat stock', 'pepperoni',
    ],
  },
  {
    id: 'vegan',
    label: 'Vegan',
    instruction: 'Strictly vegan — no meat, poultry, fish, seafood, dairy, eggs, or honey in any ingredient.',
    keywords: [
      'chicken', 'beef', 'pork', 'lamb', 'veal', 'bacon', 'ham', 'sausage', 'salami',
      'prosciutto', 'chorizo', 'mince', 'steak', 'turkey', 'duck', 'gelatin', 'gelatine',
      'fish', 'salmon', 'tuna', 'anchovy', 'anchovies', 'prawn', 'shrimp', 'crab', 'lobster',
      'oyster', 'mussel', 'squid', 'calamari', 'scallop', 'fish sauce', 'oyster sauce',
      'worcestershire', 'lard', 'suet', 'meat stock', 'pepperoni',
      'milk', 'cream', 'butter', 'cheese', 'yoghurt', 'yogurt', 'ghee', 'custard',
      'egg', 'eggs', 'mayonnaise', 'honey', 'whey', 'casein',
    ],
  },
  {
    id: 'glutenFree',
    label: 'Gluten-free',
    instruction: 'Strictly gluten-free — no wheat, barley, rye, or common gluten sources (flour, bread, pasta, soy sauce) unless explicitly labelled gluten-free.',
    keywords: [
      'wheat', 'barley', 'rye', 'flour', 'plain flour', 'self-raising flour', 'bread',
      'breadcrumbs', 'pasta', 'spaghetti', 'noodles (wheat)', 'couscous', 'semolina',
      'soy sauce', 'malt', 'malt vinegar', 'beer', 'seitan', 'cracker', 'biscuit',
      'pastry', 'puff pastry', 'shortcrust', 'cake flour', 'wheat starch',
    ],
  },
  {
    id: 'dairyFree',
    label: 'Dairy-free',
    instruction: 'Strictly dairy-free — no milk, cream, butter, cheese, yoghurt, or other dairy ingredients.',
    keywords: [
      'milk', 'cream', 'butter', 'cheese', 'yoghurt', 'yogurt', 'ghee', 'custard',
      'whey', 'casein', 'buttermilk', 'sour cream', 'condensed milk', 'evaporated milk',
      'ice cream', 'mascarpone', 'ricotta', 'parmesan', 'mozzarella', 'cheddar',
    ],
  },
  {
    id: 'nutFree',
    label: 'Nut-free',
    instruction: 'Strictly nut-free — no peanuts or tree nuts (almond, cashew, walnut, pecan, pistachio, hazelnut, macadamia, brazil nut) or derivatives like nut butter/oil/milk.',
    keywords: [
      'peanut', 'peanuts', 'peanut butter', 'peanut oil', 'almond', 'almonds', 'almond milk',
      'cashew', 'cashews', 'walnut', 'walnuts', 'pecan', 'pecans', 'pistachio', 'pistachios',
      'hazelnut', 'hazelnuts', 'macadamia', 'brazil nut', 'brazil nuts', 'nut butter',
      'nutella', 'pine nut', 'pine nuts', 'praline',
    ],
  },
  {
    id: 'shellfishFree',
    label: 'Shellfish-free',
    instruction: 'Strictly shellfish-free — no prawns, shrimp, crab, lobster, oyster, mussel, squid, calamari, or scallop.',
    keywords: [
      'prawn', 'prawns', 'shrimp', 'crab', 'lobster', 'oyster', 'oysters', 'mussel',
      'mussels', 'squid', 'calamari', 'scallop', 'scallops', 'crayfish', 'crawfish',
      'shellfish',
    ],
  },
  {
    id: 'eggFree',
    label: 'Egg-free',
    instruction: 'Strictly egg-free — no eggs or egg-derived ingredients (mayonnaise, meringue, egg wash).',
    keywords: ['egg', 'eggs', 'mayonnaise', 'meringue', 'egg wash', 'egg white', 'egg yolk', 'aioli'],
  },
];

const RESTRICTIONS_BY_ID = Object.fromEntries(DIETARY_RESTRICTIONS.map((r) => [r.id, r]));

function normalizeRestrictionIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id || '').trim()).filter((id) => RESTRICTIONS_BY_ID[id]))];
}

function buildRestrictionPromptBlock(ids) {
  const active = normalizeRestrictionIds(ids).map((id) => RESTRICTIONS_BY_ID[id]);
  if (!active.length) return '';
  return `\nDietary restrictions — these are NON-NEGOTIABLE hard constraints, not preferences:\n${active
    .map((r) => `- ${r.instruction}`)
    .join('\n')}\n`;
}

/**
 * Deterministic post-generation check: scan a returned ingredient list against
 * the keyword sets for each active restriction. Best-effort substring match —
 * not a certified allergen database.
 */
function checkIngredientsAgainstRestrictions(ingredients, restrictionIds) {
  const active = normalizeRestrictionIds(restrictionIds);
  if (!active.length || !Array.isArray(ingredients) || !ingredients.length) return [];

  const warnings = [];
  const lines = ingredients.map((ing) => {
    if (typeof ing === 'string') return ing;
    return `${ing?.amount || ''} ${ing?.item || ing?.name || ''}`.trim();
  });

  for (const restrictionId of active) {
    const restriction = RESTRICTIONS_BY_ID[restrictionId];
    if (!restriction) continue;
    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const term of restriction.keywords) {
        const t = term.toLowerCase();
        // Word-boundary-ish match to avoid "hamster" matching "ham" etc — use
        // \b on simple single-word terms; multi-word terms match as substrings.
        const re = /^[a-z]+$/.test(t) ? new RegExp(`\\b${t}\\b`, 'i') : null;
        const hit = re ? re.test(lower) : lower.includes(t);
        if (hit) {
          warnings.push({ restriction: restrictionId, ingredient: line.trim(), matchedTerm: term });
          break; // one flag per (restriction, ingredient) pair is enough
        }
      }
    }
  }
  return warnings;
}

module.exports = {
  DIETARY_RESTRICTIONS,
  RESTRICTIONS_BY_ID,
  normalizeRestrictionIds,
  buildRestrictionPromptBlock,
  checkIngredientsAgainstRestrictions,
};
