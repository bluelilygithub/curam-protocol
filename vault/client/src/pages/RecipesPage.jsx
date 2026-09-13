import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { startRecipesTour, TOUR_KEY as RECIPES_TOUR_KEY } from '../utils/tours/recipesTour';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import { scaleIngredients } from '../utils/recipeScaling';

const RECIPE_TAG_OPTIONS = [
  'breakfast', 'lunch', 'dinner', 'snack', 'curry', 'pasta', 'rice', 'soup',
  'salad', 'fast', 'slow', 'vegetarian', 'vegan', 'leftovers', 'comfort', 'healthy',
];

// Fallback list — mirrors server/services/recipeDietary.js ids/labels so the
// picker still renders before /api/recipes/status loads.
const DIETARY_RESTRICTION_OPTIONS = [
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'glutenFree', label: 'Gluten-free' },
  { id: 'dairyFree', label: 'Dairy-free' },
  { id: 'nutFree', label: 'Nut-free' },
  { id: 'shellfishFree', label: 'Shellfish-free' },
  { id: 'eggFree', label: 'Egg-free' },
];

const TOOL_GROUPS = [
  {
    id: 'create',
    label: 'Create',
    tools: [
      { id: 'leftovers', label: 'Leftover recipes', desc: 'Ingredients in → four ideas out' },
      { id: 'by-name', label: 'Recipe by name', desc: 'Dish name → Basic / Advanced / Master' },
    ],
  },
  {
    id: 'shop',
    label: 'Shop',
    tools: [
      { id: 'grocery-prices', label: 'Grocery prices', desc: 'Sourced Coles & Woolworths (AU)' },
      { id: 'meal-plan', label: 'Meal plan', desc: 'Combine saved recipes into one shop' },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    tools: [
      { id: 'saved', label: 'My recipes', desc: 'Favourites you saved' },
    ],
  },
];

const TOOL_HELP = {
  title: 'Recipes',
  description: 'A cooking assistant that turns leftovers or a dish name into a full recipe, keeps a deterministic check on stated dietary restrictions, scales servings, and sources real Coles/Woolworths prices — for one recipe or a combined weekly plan.',
  features: [
    'Leftover recipes — list what you have, get four dish ideas, expand into full steps + nutrition + dish photo',
    'Recipe by name — Basic / Advanced / Master tiers with accessible ingredient swaps',
    'Dietary restrictions — a best-effort keyword filter checks the AI\'s own output and flags anything that slipped through',
    'Serving-size stepper — scales ingredient amounts without a second AI call',
    'Grocery prices — live-sourced Coles & Woolworths prices with a correction glossary that improves over time',
    'Meal plan — combine several saved recipes into one merged, priced shopping list',
  ],
};

function HelpModal({ onClose }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold text-base" style={{ color: 'var(--color-text)' }}>{TOOL_HELP.title}</h3>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }} className="hover:opacity-60 transition-opacity flex-shrink-0">✕</button>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>{TOOL_HELP.description}</p>
        <ul className="space-y-1.5">
          {TOOL_HELP.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
              <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>•</span>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Reused wherever nutrition info is shown — this app has no shared Callout
// component (UserGuidePage.jsx's is local to that file), so a lightweight
// equivalent matching its visual style lives here.
function NutritionDisclaimer() {
  return (
    <div
      className="flex gap-2.5 px-3 py-2.5 rounded-xl text-[11px] leading-relaxed"
      style={{ background: 'rgba(217,119,6,0.08)', borderLeft: '3px solid #f59e0b', color: 'var(--color-text)' }}
    >
      <span className="flex-shrink-0 font-bold" style={{ color: '#f59e0b' }}>⚠</span>
      <span className="opacity-85">
        AI-estimated, not measured — for a real dietary need, verify with a nutrition label or dietitian.
      </span>
    </div>
  );
}

function RestrictionPicker({ options, selected, onChange }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {(options?.length ? options : DIETARY_RESTRICTION_OPTIONS).map((r) => {
          const on = selected.includes(r.id);
          return (
            <Tooltip key={r.id} text={`Exclude ${r.label.toLowerCase()} ingredients (best-effort keyword filter)`}>
              <button
                type="button"
                onClick={() => onChange(on ? selected.filter((id) => id !== r.id) : [...selected, r.id])}
                className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
                style={{
                  borderColor: on ? 'var(--color-primary)' : 'var(--color-border)',
                  color: on ? 'var(--color-primary)' : 'var(--color-muted)',
                  background: on ? 'var(--color-surface)' : 'transparent',
                }}
              >
                {r.label}
              </button>
            </Tooltip>
          );
        })}
      </div>
      {selected.length > 0 && (
        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
          Best-effort keyword filter — always double-check labels for a real allergy.
        </p>
      )}
    </div>
  );
}

function RestrictionWarnings({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <div
      className="flex gap-2.5 px-3 py-2.5 rounded-xl text-[11px] leading-relaxed"
      style={{ background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444', color: 'var(--color-text)' }}
    >
      <span className="flex-shrink-0 font-bold" style={{ color: '#ef4444' }}>⚠</span>
      <span className="opacity-90">
        <span className="font-medium">Possible restriction conflict</span> — the AI may not have fully honoured your selection:
        <ul className="mt-1 space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i}>
              <span className="capitalize">{w.restriction.replace(/([A-Z])/g, ' $1').trim()}</span>: “{w.ingredient}” matched “{w.matchedTerm}”
            </li>
          ))}
        </ul>
      </span>
    </div>
  );
}

function ServingsStepper({ servings, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <Tooltip text="Fewer servings — ingredient amounts scale automatically">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, servings - 1))}
          className="w-7 h-7 rounded-lg border flex items-center justify-center transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          aria-label="Fewer servings"
        >
          −
        </button>
      </Tooltip>
      <span className="text-xs font-medium w-16 text-center" style={{ color: 'var(--color-text)' }}>
        {servings} serving{servings === 1 ? '' : 's'}
      </span>
      <Tooltip text="More servings — ingredient amounts scale automatically">
        <button
          type="button"
          onClick={() => onChange(servings + 1)}
          className="w-7 h-7 rounded-lg border flex items-center justify-center transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          aria-label="More servings"
        >
          +
        </button>
      </Tooltip>
    </div>
  );
}

function formatMinutes(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function mealCardInteractiveStyle({ selected, loading, hovered }) {
  const active = selected || loading;
  const lifted = active || hovered;
  return {
    borderColor: lifted ? 'var(--color-primary)' : 'var(--color-border)',
    background: lifted ? 'var(--color-surface)' : 'var(--color-bg)',
    boxShadow: active
      ? '0 0 0 2px var(--color-primary), 0 4px 14px rgba(26, 26, 26, 0.12)'
      : hovered
        ? '0 8px 24px rgba(26, 26, 26, 0.14)'
        : 'none',
    transform: hovered && !active ? 'translateY(-4px) scale(1.015)' : 'none',
  };
}

function RecipeCard({ recipe, selected, loading, onSelect }) {
  const getIcon = useIcon();
  const [hovered, setHovered] = useState(false);
  const interactive = mealCardInteractiveStyle({ selected, loading, hovered });

  return (
    <button
      type="button"
      onClick={() => onSelect(recipe)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`View full recipe: ${recipe.title}`}
      className="text-left rounded-xl border-2 p-4 space-y-2 w-full cursor-pointer transition-all duration-200"
      style={interactive}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{recipe.title}</p>
      <p className="text-xs line-clamp-2" style={{ color: 'var(--color-muted)' }}>{recipe.summary}</p>
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {recipe.mealType && (
          <span className="px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            {recipe.mealType}
          </span>
        )}
        {recipe.timeMinutes && (
          <span className="px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            {formatMinutes(recipe.timeMinutes)}
          </span>
        )}
        {(recipe.tags || []).slice(0, 2).map((t) => (
          <span key={t} className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>{t}</span>
        ))}
      </div>
      <div
        className="flex items-center justify-between gap-2 pt-2 mt-1 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span
          className="text-xs font-medium"
          style={{
            color: loading ? 'var(--color-muted)' : 'var(--color-primary)',
            textDecoration: hovered && !loading ? 'underline' : 'none',
          }}
        >
          {loading ? 'Loading recipe…' : hovered ? 'Open full recipe →' : 'Tap to view full recipe'}
        </span>
        <span style={{ color: 'var(--color-primary)' }}>{getIcon('chevron-right', { size: 14 })}</span>
      </div>
    </button>
  );
}

function TagPicker({ selected, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RECIPE_TAG_OPTIONS.map((tag) => {
        const on = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onChange(on ? selected.filter((t) => t !== tag) : [...selected, tag])}
            className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 capitalize"
            style={{
              borderColor: on ? 'var(--color-primary)' : 'var(--color-border)',
              color: on ? 'var(--color-primary)' : 'var(--color-muted)',
              background: on ? 'var(--color-surface)' : 'transparent',
            }}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

function TierCard({ recipe, selected, loading, onSelect }) {
  const getIcon = useIcon();
  const [hovered, setHovered] = useState(false);
  const interactive = mealCardInteractiveStyle({ selected, loading, hovered });

  return (
    <button
      type="button"
      onClick={() => onSelect(recipe)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`View ${recipe.tierLabel || recipe.id} recipe: ${recipe.title}`}
      className="text-left rounded-xl border-2 p-4 space-y-2 w-full cursor-pointer transition-all duration-200"
      style={interactive}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
        style={{ background: 'var(--color-primary)', color: '#fff' }}
      >
        {recipe.tierLabel || recipe.id}
      </span>
      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{recipe.title}</p>
      <p className="text-xs line-clamp-3" style={{ color: 'var(--color-muted)' }}>{recipe.summary}</p>
      {recipe.timeMinutes && (
        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{formatMinutes(recipe.timeMinutes)}</p>
      )}
      <div
        className="flex items-center justify-between gap-2 pt-2 mt-1 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span
          className="text-xs font-medium"
          style={{
            color: loading ? 'var(--color-muted)' : 'var(--color-primary)',
            textDecoration: hovered && !loading ? 'underline' : 'none',
          }}
        >
          {loading ? 'Loading recipe…' : hovered ? 'Open full recipe →' : 'Tap to view full recipe'}
        </span>
        <span style={{ color: 'var(--color-primary)' }}>{getIcon('chevron-right', { size: 14 })}</span>
      </div>
    </button>
  );
}

const GROCERY_STORES = ['coles', 'woolworths'];
const STORE_LABELS = { coles: 'Coles', woolworths: 'Woolworths' };

function formatStorePrice(cell) {
  if (cell?.recipePrice != null) return cell.recipePriceLabel;
  if (cell?.checkoutPrice != null) return cell.checkoutPriceLabel;
  if (!cell?.price) return 'Not found';
  return `$${cell.price.toFixed(2)}`;
}

function GroceryFeedbackRow({ row, store, onSubmitted }) {
  const addToast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!note.trim()) return;
    setSending(true);
    try {
      const res = await api.post('/api/recipes/grocery/feedback', {
        ingredient: row.ingredient,
        store,
        note: note.trim(),
        matchedProduct: row[store]?.product || null,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save that correction');
      onSubmitted(data.item);
      addToast('Learned — recalculated with the correction', 'success');
      setOpen(false);
      setNote('');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block text-[10px] mt-1 underline transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        This looks wrong
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1" onClick={(e) => e.stopPropagation()}>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={'What’s wrong? e.g. "that’s a 12-pack, not 10"'}
        rows={2}
        className="w-full text-[10px] p-1.5 rounded-lg border resize-none"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={sending || !note.trim()}
          className="text-[10px] px-2 py-1 rounded-lg text-white transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--color-primary)' }}
        >
          {sending ? 'Learning…' : 'Submit & recalc'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setNote(''); }}
          className="text-[10px] px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function GroceryCorrectionsGlossary() {
  const addToast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/recipes/grocery/corrections');
      const data = await res.json();
      setItems(data.corrections || []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { if (open && items == null) load(); }, [open, items, load]);

  const remove = async (id) => {
    try {
      await api.delete(`/api/recipes/grocery/corrections/${id}`);
      setItems((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="text-[10px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="underline transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        {open ? 'Hide learned corrections' : 'Learned corrections'}
      </button>
      {open && (
        <ul className="mt-1 space-y-1">
          {items == null && <li style={{ color: 'var(--color-muted)' }}>Loading…</li>}
          {items?.length === 0 && <li style={{ color: 'var(--color-muted)' }}>None yet — flag a wrong price above to teach it.</li>}
          {items?.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border p-1.5" style={{ borderColor: 'var(--color-border)' }}>
              <span style={{ color: 'var(--color-text)' }}>
                <span className="font-medium">{c.ingredientTerm}</span>
                {c.store ? ` (${c.store})` : ''} — {c.type.replace('_', ' ')}: {c.value?.word || c.value?.label || JSON.stringify(c.value)}
              </span>
              <button type="button" onClick={() => remove(c.id)} className="underline transition-opacity hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroceryPriceResults({ result, onResultChange }) {
  if (!result?.items?.length) return null;
  const cheapestRecipe = result.totals?.cheapestRecipeStore || result.totals?.cheapestStore;
  const cheapestBasket = result.totals?.cheapestBasketStore;

  const handleItemUpdated = (updatedItem) => {
    if (!updatedItem || !onResultChange) return;
    const items = result.items.map((row) => (row.ingredient === updatedItem.ingredient ? updatedItem : row));
    onResultChange({ ...result, items });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs rounded-xl border p-3" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
        {result.disclaimer}
        {result.liveFetchNote && (
          <span> {result.liveFetchNote}</span>
        )}
      </p>

      {result.totals && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Recipe cost (quantity used)</p>
          <div className="grid grid-cols-2 gap-2">
            {GROCERY_STORES.map((store) => {
              const t = result.totals[store];
              const isCheapest = cheapestRecipe === store;
              return (
                <div
                  key={`recipe-${store}`}
                  className="rounded-xl border p-3 text-center"
                  style={{
                    borderColor: isCheapest ? 'var(--color-primary)' : 'var(--color-border)',
                    background: isCheapest ? 'var(--color-surface)' : 'var(--color-bg)',
                  }}
                >
                  <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-muted)' }}>{STORE_LABELS[store]}</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>
                    {t?.recipeLabel || t?.label || '—'}
                  </p>
                  {t?.recipePricedCount != null && t.recipePricedCount < result.items.length && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {t.recipePricedCount}/{result.items.length} priced
                    </p>
                  )}
                  {isCheapest && t?.recipeTotal != null && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-primary)' }}>Lowest recipe cost</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-wider pt-1" style={{ color: 'var(--color-muted)' }}>Pack total (checkout)</p>
          <div className="grid grid-cols-2 gap-2">
            {GROCERY_STORES.map((store) => {
              const t = result.totals[store];
              const isCheapest = cheapestBasket === store;
              return (
                <div
                  key={`basket-${store}`}
                  className="rounded-xl border p-3 text-center"
                  style={{
                    borderColor: isCheapest ? 'var(--color-primary)' : 'var(--color-border)',
                    background: 'var(--color-bg)',
                  }}
                >
                  <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-muted)' }}>{STORE_LABELS[store]}</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>
                    {t?.basketLabel || '—'}
                  </p>
                  {isCheapest && t?.basketTotal != null && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-primary)' }}>Lowest pack total</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr style={{ background: 'var(--color-surface)' }}>
              <th className="text-left p-2 font-medium" style={{ color: 'var(--color-text)' }}>Ingredient</th>
              {GROCERY_STORES.map((s) => (
                <th key={s} className="text-right p-2 font-medium" style={{ color: 'var(--color-text)' }}>{STORE_LABELS[s]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.items.map((row) => (
              <tr key={row.ingredient} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="p-2 align-top" style={{ color: 'var(--color-text)' }}>
                  <span className="font-medium">{row.ingredient}</span>
                  {row.quantity && <span className="block text-[10px]" style={{ color: 'var(--color-muted)' }}>Qty: {row.quantity}</span>}
                  {row.matched === false && row.coles?.price && row.woolworths?.price && (
                    <span className="block text-[10px] mt-0.5" style={{ color: '#b45309' }}>Variant mismatch</span>
                  )}
                </td>
                {GROCERY_STORES.map((store) => {
                  const cell = row[store];
                  const isCheapest = row.cheapestStore === store && (cell?.recipePrice ?? cell?.price) != null;
                  return (
                    <td key={store} className="p-2 text-right align-top" style={{ color: isCheapest ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                      {cell?.recipePrice != null ? (
                        <>
                          <span className="font-medium">{cell.recipePriceLabel}</span>
                          <span className="block text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>recipe qty</span>
                        </>
                      ) : (
                        <span className="font-medium">{formatStorePrice(cell)}</span>
                      )}
                      {cell?.checkoutPrice != null && cell?.recipePrice != null && (
                        <span className="block text-[10px] mt-0.5">Pack {cell.checkoutPriceLabel}{cell.packSizeLabel ? ` · ${cell.packSizeLabel}` : ''}</span>
                      )}
                      {cell?.priceNote && (
                        <span className="block text-[10px] mt-0.5">{cell.priceNote}</span>
                      )}
                      {cell?.product && (
                        <span className="block text-[10px] mt-0.5 line-clamp-2">{cell.product}</span>
                      )}
                      {cell?.url && (
                        <a href={cell.url} target="_blank" rel="noopener noreferrer" className="block text-[10px] mt-0.5 transition-opacity hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                          {cell?.price ? `Source: ${cell.source || STORE_LABELS[store]}` : `Search ${STORE_LABELS[store]}`}
                        </a>
                      )}
                      {cell?.price != null && (
                        <GroceryFeedbackRow row={row} store={store} onSubmitted={handleItemUpdated} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <GroceryCorrectionsGlossary />
    </div>
  );
}

function recipeIngredientLines(recipe) {
  return (recipe?.ingredients || [])
    .map((ing) => `${ing.amount ? `${ing.amount} ` : ''}${ing.item}`)
    .filter(Boolean);
}

function RecipeDetailPanel({
  expanded,
  dishImage,
  saveTags,
  onSaveTagsChange,
  onSave,
  onRegenerateImage,
  onComparePrices,
  groceryLoading,
  groceryResult,
  onGroceryResultChange,
  status,
}) {
  const imageRef = useRef(null);
  const imageSrc = dishImage || expanded?.imageDataUrl;
  const [scaledServings, setScaledServings] = useState(null);

  useEffect(() => {
    setScaledServings(Number(expanded?.servings) || null);
  }, [expanded?.title, expanded?.tier, expanded?.servings]);

  const originalServings = Number(expanded?.servings) || null;
  const effectiveServings = scaledServings || originalServings;
  const scaleFactor = originalServings && effectiveServings ? effectiveServings / originalServings : 1;
  const displayIngredients = useMemo(
    () => scaleIngredients(expanded?.ingredients, scaleFactor),
    [expanded?.ingredients, scaleFactor]
  );

  const scrollToImage = useCallback(() => {
    imageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    const timer = window.setTimeout(scrollToImage, 200);
    return () => clearTimeout(timer);
  }, [expanded, expanded?.title, expanded?.tier, expanded?.tierLabel, imageSrc, scrollToImage]);

  if (!expanded) return null;

  return (
    <div className="rounded-xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{expanded.title}</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          {expanded.tierLabel && <span className="font-medium">{expanded.tierLabel} · </span>}
          prep {formatMinutes(expanded.prepMinutes)} · cook {formatMinutes(expanded.cookMinutes)}
        </p>
      </div>

      <RestrictionWarnings warnings={expanded.restrictionWarnings} />

      <div ref={imageRef} className="scroll-mt-6">
        {imageSrc && (
          <img
            src={imageSrc}
            alt=""
            className="w-full max-h-56 object-cover rounded-xl border"
            style={{ borderColor: 'var(--color-border)' }}
            onLoad={scrollToImage}
          />
        )}
      </div>

      {originalServings != null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Servings</p>
          <Tooltip text="Ingredient amounts scale automatically; adjust cooking times/steps by eye for large changes">
            <span><ServingsStepper servings={effectiveServings} onChange={setScaledServings} /></span>
          </Tooltip>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Ingredients</p>
        <ul className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
          {(displayIngredients || []).map((ing, i) => (
            <li key={i}>
              {ing.amount ? `${ing.amount} ` : ''}{ing.item}
              {ing.accessibleAlternative && (
                <span style={{ color: 'var(--color-primary)' }}> · swap: {ing.accessibleAlternative}</span>
              )}
            </li>
          ))}
        </ul>
        {scaleFactor !== 1 && (
          <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>
            Ingredient amounts scale automatically; adjust cooking times/steps by eye for large changes.
          </p>
        )}
      </div>

      {(expanded.ingredientAlternatives || []).length > 0 && (
        <div className="rounded-xl border p-3 space-y-2 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Accessible alternatives</p>
          <ul className="space-y-2">
            {expanded.ingredientAlternatives.map((row) => (
              <li key={row.ingredient}>
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{row.ingredient}</span>
                <ul className="mt-0.5 pl-3 list-disc" style={{ color: 'var(--color-muted)' }}>
                  {(row.alternatives || []).map((alt, j) => <li key={j}>{alt}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Steps</p>
        <ol className="text-xs space-y-2 list-decimal pl-4" style={{ color: 'var(--color-text)' }}>
          {(expanded.steps || []).map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </div>

      {expanded.nutrition && (
        <div className="rounded-xl border p-3 space-y-2 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Nutrition</p>
          <p style={{ color: 'var(--color-muted)' }}>{expanded.nutrition.summary}</p>
          {expanded.nutrition.estimatedCaloriesPerServing && (
            <p style={{ color: 'var(--color-muted)' }}>~{expanded.nutrition.estimatedCaloriesPerServing}</p>
          )}
          {expanded.nutrition.benefits?.length > 0 && (
            <p style={{ color: 'var(--color-muted)' }}><span className="font-medium" style={{ color: 'var(--color-text)' }}>Benefits:</span> {expanded.nutrition.benefits.join(' · ')}</p>
          )}
          {expanded.nutrition.cautions?.length > 0 && (
            <p style={{ color: '#b45309' }}><span className="font-medium">Watch:</span> {expanded.nutrition.cautions.join(' · ')}</p>
          )}
          <NutritionDisclaimer />
        </div>
      )}

      {expanded.links?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Videos & similar recipes</p>
          <ul className="space-y-1">
            {expanded.links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {link.type === 'video' ? '▶ ' : ''}{link.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {status?.imageGen && !imageSrc && expanded.imageError && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{expanded.imageError}</p>
        )}
        {status?.imageGen && (
          <Tooltip text={imageSrc ? 'Generate a new dish photo with the current model' : 'Retry generating a dish photo'}>
            <button
              type="button"
              onClick={onRegenerateImage}
              className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {imageSrc ? 'Regenerate photo' : 'Retry photo'}
            </button>
          </Tooltip>
        )}
      </div>

      {onComparePrices && (
        <div className="space-y-3 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Grocery prices</p>
            <p className="text-[10px] mb-2" style={{ color: 'var(--color-muted)' }}>
              Coles & Woolworths, sourced from live product search — check stores before you buy.
              {scaleFactor !== 1 ? ' Uses your scaled serving amounts.' : ''}
            </p>
            {status && !status.webSearch && (
              <p className="text-[10px] mb-2" style={{ color: '#f59e0b' }}>
                Add <code className="text-[10px]">SERPER_SEARCH_API_KEY</code> on Railway — add or edit the Shopping search model in Settings → AI & Chat → AI Models.
              </p>
            )}
            <Tooltip text="Look up live Coles & Woolworths prices for these ingredients">
              <button
                type="button"
                onClick={() => onComparePrices(displayIngredients, effectiveServings)}
                disabled={groceryLoading || !status?.webSearch}
                className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {groceryLoading ? 'Finding prices…' : groceryResult ? 'Refresh prices' : 'Get prices'}
              </button>
            </Tooltip>
          </div>
          {groceryResult && <GroceryPriceResults result={groceryResult} onResultChange={onGroceryResultChange} />}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Categories</p>
        <TagPicker selected={saveTags} onChange={onSaveTagsChange} />
        <Tooltip text="Save this recipe to your library">
          <button
            type="button"
            onClick={onSave}
            className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Save to my recipes
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function MealPlanTool({
  libraryItems,
  loadLibrary,
  mealPlans,
  mealPlansLoading,
  loadMealPlans,
  mealPlanTitle,
  setMealPlanTitle,
  mealPlanSelection,
  setMealPlanSelection,
  onCreatePlan,
  activeMealPlan,
  onOpenPlan,
  onDeletePlan,
  onPricePlan,
  mealPlanPricing,
  mealPlanResult,
  setMealPlanResult,
}) {
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const toggleRecipe = (recipeId, defaultServings) => {
    setMealPlanSelection((prev) => {
      const next = { ...prev };
      if (next[recipeId]) delete next[recipeId];
      else next[recipeId] = defaultServings || 4;
      return next;
    });
  };

  const setRecipeServings = (recipeId, servings) => {
    setMealPlanSelection((prev) => ({ ...prev, [recipeId]: Math.max(1, servings) }));
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Meal plan</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          Combine several saved recipes into one merged, priced shopping list — duplicate ingredients across recipes are combined into a single line.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>New plan</p>
          <Tooltip text="Reload your saved recipes to pick from">
            <button type="button" onClick={loadLibrary} className="text-[10px] underline transition-opacity hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
              Refresh recipes
            </button>
          </Tooltip>
        </div>

        {libraryItems.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            No saved recipes yet — save a recipe from Leftover recipes or Recipe by name first.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {libraryItems.map((item) => {
              const checked = Boolean(mealPlanSelection[item.id]);
              const originalServings = Number(item.payload?.servings) || 4;
              return (
                <li key={item.id} className="flex items-center justify-between gap-2 text-xs rounded-lg border p-2" style={{ borderColor: 'var(--color-border)' }}>
                  <Tooltip text="Include this recipe in the plan">
                    <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRecipe(item.id, originalServings)}
                      />
                      <span className="truncate" style={{ color: 'var(--color-text)' }}>{item.title}</span>
                    </label>
                  </Tooltip>
                  {checked && (
                    <Tooltip text="Servings for this recipe in the plan">
                      <span><ServingsStepper servings={mealPlanSelection[item.id]} onChange={(v) => setRecipeServings(item.id, v)} /></span>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <label className="block space-y-1">
          <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Plan name</span>
          <Tooltip text="Give this meal plan a name, e.g. 'This week'">
            <input
              value={mealPlanTitle}
              onChange={(e) => setMealPlanTitle(e.target.value)}
              placeholder="This week"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </Tooltip>
        </label>

        <Tooltip text="Save this selection as a named meal plan">
          <button
            type="button"
            onClick={onCreatePlan}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Save plan
          </button>
        </Tooltip>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Saved plans</p>
        {mealPlansLoading && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
        {!mealPlansLoading && mealPlans.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No meal plans yet.</p>
        )}
        <ul className="space-y-1.5">
          {mealPlans.map((plan) => (
            <li key={plan.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-xs" style={{ borderColor: activeMealPlan?.id === plan.id ? 'var(--color-primary)' : 'var(--color-border)' }}>
              <button type="button" onClick={() => onOpenPlan(plan)} className="text-left min-w-0">
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{plan.title}</span>
                <span className="ml-1.5" style={{ color: 'var(--color-muted)' }}>{plan.itemCount} recipe{plan.itemCount === 1 ? '' : 's'}</span>
              </button>
              {deleteConfirmId === plan.id ? (
                <span className="flex items-center gap-1 shrink-0">
                  <span style={{ color: 'var(--color-muted)' }}>Delete?</span>
                  <button type="button" onClick={() => { onDeletePlan(plan.id); setDeleteConfirmId(null); }} style={{ color: '#ef4444' }}>Yes</button>
                  <button type="button" onClick={() => setDeleteConfirmId(null)} style={{ color: 'var(--color-muted)' }}>No</button>
                </span>
              ) : (
                <Tooltip text="Delete this meal plan">
                  <button type="button" onClick={() => setDeleteConfirmId(plan.id)} className="shrink-0" style={{ color: '#ef4444' }}>Delete</button>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      </div>

      {activeMealPlan && (
        <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{activeMealPlan.title}</p>
          <ul className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
            {activeMealPlan.items.map((it) => (
              <li key={it.id}>{it.title}{it.servings ? ` · ${it.servings} servings` : ''}</li>
            ))}
          </ul>
          <Tooltip text="Merge ingredients across every recipe in this plan and price them once">
            <button
              type="button"
              onClick={() => onPricePlan(activeMealPlan.id)}
              disabled={mealPlanPricing}
              className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {mealPlanPricing ? 'Pricing…' : mealPlanResult ? 'Refresh plan prices' : 'Price this plan'}
            </button>
          </Tooltip>
          {mealPlanResult?.missingRecipes?.length > 0 && (
            <p className="text-[10px]" style={{ color: '#b45309' }}>
              Skipped (no saved ingredients): {mealPlanResult.missingRecipes.join(', ')}
            </p>
          )}
          {mealPlanResult && <GroceryPriceResults result={mealPlanResult} onResultChange={setMealPlanResult} />}
        </div>
      )}
    </section>
  );
}

export default function RecipesPage() {
  const navigate = useNavigate();
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.recipes !== false;

  const [status, setStatus] = useState(null);
  const [openGroup, setOpenGroup] = useState('create');
  const [tool, setTool] = useState('leftovers');
  const [search, setSearch] = useState('');

  const [ingredients, setIngredients] = useState('');
  const [notes, setNotes] = useState('');
  const [suggestions, setSuggestions] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [dishImage, setDishImage] = useState(null);
  const [saveTags, setSaveTags] = useState([]);
  const [restrictions, setRestrictions] = useState([]);

  const [dishName, setDishName] = useState('');
  const [nameNotes, setNameNotes] = useState('');
  const [nameSuggestions, setNameSuggestions] = useState(null);
  const [selectedTier, setSelectedTier] = useState(null);
  const [namedExpanded, setNamedExpanded] = useState(null);
  const [namedDishImage, setNamedDishImage] = useState(null);
  const [namedSaveTags, setNamedSaveTags] = useState([]);
  const [namedRestrictions, setNamedRestrictions] = useState([]);

  const [expandingCardId, setExpandingCardId] = useState(null);
  const [expandingTierId, setExpandingTierId] = useState(null);

  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryTagFilter, setLibraryTagFilter] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [viewingSaved, setViewingSaved] = useState(null);

  const [groceryInput, setGroceryInput] = useState('');
  const [groceryResult, setGroceryResult] = useState(null);
  const [detailGroceryResult, setDetailGroceryResult] = useState(null);
  const [detailGroceryLoading, setDetailGroceryLoading] = useState(false);

  const [showHelp, setShowHelp] = useState(false);

  const [mealPlans, setMealPlans] = useState([]);
  const [mealPlansLoading, setMealPlansLoading] = useState(false);
  const [mealPlanTitle, setMealPlanTitle] = useState('');
  const [mealPlanSelection, setMealPlanSelection] = useState({}); // { [recipeId]: servings }
  const [activeMealPlan, setActiveMealPlan] = useState(null);
  const [mealPlanPricing, setMealPlanPricing] = useState(false);
  const [mealPlanResult, setMealPlanResult] = useState(null);

  const activeRecipeForShop = expanded || namedExpanded;

  useEffect(() => {
    setDetailGroceryResult(null);
    setDetailGroceryLoading(false);
  }, [expanded?.title, expanded?.tier, namedExpanded?.title, namedExpanded?.tier]);

  const copyRecipeToGroceryInput = useCallback(() => {
    const recipe = expanded || namedExpanded;
    if (!recipe?.ingredients?.length) {
      addToast('Generate a recipe first, or type ingredients below', 'error');
      return;
    }
    setGroceryInput(recipeIngredientLines(recipe).join('\n'));
    addToast('Ingredients copied to shopping list', 'success');
  }, [expanded, namedExpanded, addToast]);

  const handleDetailGroceryPrice = useCallback(async (recipe, scaledIngredients, scaledServings) => {
    const ingredientsToPrice = scaledIngredients?.length ? scaledIngredients : recipe?.ingredients;
    if (!ingredientsToPrice?.length) {
      addToast('No ingredients to price', 'error');
      return;
    }
    startProcessing('Finding prices…', 'Searching Coles & Woolworths listings (AUD).');
    setDetailGroceryLoading(true);
    setDetailGroceryResult(null);
    try {
      const res = await api.post('/api/recipes/grocery/price', {
        ingredients: recipeIngredientLines({ ingredients: ingredientsToPrice }).join('\n'),
        recipeTitle: recipe.title,
        servings: scaledServings || recipe.servings,
        recipeIngredients: ingredientsToPrice,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Price check failed');
      setDetailGroceryResult(data);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDetailGroceryLoading(false);
      stopProcessing();
    }
  }, [addToast, startProcessing, stopProcessing]);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUse) return;
    api.get('/api/recipes/status').then((r) => r.json()).then(setStatus).catch(() => {});
  }, [canUse]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TOOL_GROUPS;
    return TOOL_GROUPS.map((g) => ({
      ...g,
      tools: g.tools.filter((t) => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)),
    })).filter((g) => g.tools.length > 0);
  }, [search]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const q = libraryTagFilter ? `?tag=${encodeURIComponent(libraryTagFilter)}` : '';
      const res = await api.get(`/api/recipes/library${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load recipes');
      setLibraryItems(Array.isArray(data) ? data : []);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLibraryLoading(false);
    }
  }, [libraryTagFilter, addToast]);

  useEffect(() => {
    if (!canUse || (tool !== 'saved' && tool !== 'meal-plan')) return;
    loadLibrary();
  }, [canUse, tool, loadLibrary]);

  const loadMealPlans = useCallback(async () => {
    setMealPlansLoading(true);
    try {
      const res = await api.get('/api/recipes/meal-plans');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load meal plans');
      setMealPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setMealPlansLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!canUse || tool !== 'meal-plan') return;
    loadMealPlans();
  }, [canUse, tool, loadMealPlans]);

  const handleCreateMealPlan = async () => {
    const items = Object.entries(mealPlanSelection)
      .filter(([, servings]) => servings)
      .map(([recipeId, servings]) => ({ recipeId: Number(recipeId), servings: Number(servings) }));
    if (!items.length) {
      addToast('Pick at least one recipe for the plan', 'error');
      return;
    }
    startProcessing('Saving meal plan…', '');
    try {
      const res = await api.post('/api/recipes/meal-plans', {
        title: mealPlanTitle || 'Untitled plan',
        items,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save plan');
      addToast('Meal plan saved', 'success');
      setMealPlanTitle('');
      setMealPlanSelection({});
      setActiveMealPlan(data);
      setMealPlanResult(null);
      await loadMealPlans();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleOpenMealPlan = async (planSummary) => {
    try {
      const res = await api.get(`/api/recipes/meal-plans/${planSummary.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load plan');
      setActiveMealPlan(data);
      setMealPlanResult(null);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleDeleteMealPlan = async (planId) => {
    try {
      const res = await api.delete(`/api/recipes/meal-plans/${planId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      if (activeMealPlan?.id === planId) { setActiveMealPlan(null); setMealPlanResult(null); }
      addToast('Meal plan deleted', 'success');
      await loadMealPlans();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handlePriceMealPlan = async (planId) => {
    startProcessing('Pricing meal plan…', 'Merging ingredients across recipes and searching Coles & Woolworths.');
    setMealPlanPricing(true);
    setMealPlanResult(null);
    try {
      const res = await api.post(`/api/recipes/meal-plans/${planId}/price`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Price check failed');
      setMealPlanResult(data);
      addToast('Meal plan priced', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setMealPlanPricing(false);
      stopProcessing();
    }
  };

  const handleSuggest = async () => {
    if (!ingredients.trim()) {
      addToast('List what you have on hand', 'error');
      return;
    }
    startProcessing('Finding recipes…', 'Matching your leftovers to four dish ideas.');
    setSelectedCard(null);
    setExpanded(null);
    setDishImage(null);
    try {
      const res = await api.post('/api/recipes/suggest', { ingredients, notes, restrictions });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Suggest failed');
      setSuggestions(data);
      addToast('Four recipes ready — pick one', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleSelectCard = async (card) => {
    setSelectedCard(card);
    setExpanded(null);
    setDishImage(null);
    setExpandingCardId(card.id);
    setSaveTags([...(card.tags || []), card.mealType].filter(Boolean));
    startProcessing('Building recipe…', 'Steps, nutrition, dish photo, and links.');
    try {
      const res = await api.post('/api/recipes/expand', {
        recipe: card,
        ingredients: suggestions?.ingredients || ingredients,
        notes: suggestions?.notes || notes,
        restrictions: suggestions?.restrictions || restrictions,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not expand recipe');
      setExpanded(data);
      setDishImage(data.imageDataUrl || null);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setExpandingCardId(null);
      stopProcessing();
    }
  };

  const handleSaveRecipe = async ({ expanded, dishImage, selectedCard, source, transaction }) => {
    if (!expanded) return;
    startProcessing('Saving recipe…', '');
    const tags = source === 'named' ? namedSaveTags : saveTags;
    try {
      const payload = { ...expanded, card: selectedCard, links: expanded.links };
      const res = await api.post('/api/recipes/library', {
        title: expanded.title || selectedCard?.title,
        tags,
        source,
        payload,
        imageDataUrl: dishImage || expanded.imageDataUrl,
        transaction,
      });
      const item = await res.json();
      if (!res.ok) throw new Error(item.error || 'Save failed');
      addToast('Saved to your library', 'success');
      await loadLibrary();
      return item;
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleGenerateImage = async ({ expanded, setImage }) => {
    if (!expanded) return;
    startProcessing('Generating dish photo…', 'Using your Graphics model from Settings.');
    try {
      const res = await api.post('/api/recipes/image', {
        title: expanded.title,
        imagePrompt: expanded.imagePrompt,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image failed');
      setImage(data.imageDataUrl);
      addToast('Dish image ready', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleNamedSuggest = async () => {
    if (!dishName.trim()) {
      addToast('Enter a dish name', 'error');
      return;
    }
    startProcessing('Building levels…', 'Basic, Advanced, and Master versions.');
    setSelectedTier(null);
    setNamedExpanded(null);
    setNamedDishImage(null);
    try {
      const res = await api.post('/api/recipes/named/suggest', { name: dishName, notes: nameNotes, restrictions: namedRestrictions });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Suggest failed');
      setNameSuggestions(data);
      addToast('Pick a level', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleSelectTier = async (tierCard) => {
    setSelectedTier(tierCard);
    setNamedExpanded(null);
    setNamedDishImage(null);
    setExpandingTierId(tierCard.id);
    setNamedSaveTags([...(tierCard.tags || []), tierCard.tierLabel?.toLowerCase()].filter(Boolean));
    startProcessing('Building recipe…', 'Steps, swaps, dish photo, and links.');
    try {
      const res = await api.post('/api/recipes/named/expand', {
        name: nameSuggestions?.name || dishName,
        tier: tierCard.id,
        recipe: tierCard,
        notes: nameSuggestions?.notes || nameNotes,
        restrictions: nameSuggestions?.restrictions || namedRestrictions,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not build recipe');
      setNamedExpanded(data);
      setNamedDishImage(data.imageDataUrl || null);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setExpandingTierId(null);
      stopProcessing();
    }
  };

  const handleGroceryPrice = async () => {
    if (!groceryInput.trim()) {
      addToast('List ingredients to price', 'error');
      return;
    }
    startProcessing('Finding prices…', 'Searching Coles & Woolworths listings (AUD).');
    setGroceryResult(null);
    try {
      const recipe = activeRecipeForShop;
      const res = await api.post('/api/recipes/grocery/price', {
        ingredients: groceryInput,
        recipeTitle: recipe?.title,
        servings: recipe?.servings,
        recipeIngredients: recipe?.ingredients,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Price check failed');
      setGroceryResult(data);
      addToast('Price comparison ready', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const deleteLibraryItem = async (id) => {
    try {
      const res = await api.delete(`/api/recipes/library/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setLibraryItems((prev) => prev.filter((i) => i.id !== id));
      setDeleteConfirmId(null);
      if (viewingSaved?.id === id) setViewingSaved(null);
      addToast('Recipe deleted', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside
        className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('utensils', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Recipes</h1>
          <button
            onClick={() => { localStorage.removeItem(RECIPES_TOUR_KEY); startRecipesTour(navigate); }}
            title="Take the Recipes tour"
            style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'opacity 0.2s' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
          >
            {getIcon('compass', { size: 13 })}
          </button>
          <button
            onClick={() => setShowHelp(true)}
            title="What is Recipes?"
            style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'opacity 0.2s' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
          >
            {getIcon('help-circle', { size: 13 })}
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools…"
          className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />

        {filteredGroups.map((group) => (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}
              className="text-xs font-semibold w-full text-left py-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-primary)' }}
            >
              {openGroup === group.id ? '▼' : '▶'} {group.label}
            </button>
            {(openGroup === group.id || search.trim()) && (
              <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                {group.tools.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTool(t.id)}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                      style={{
                        background: tool === t.id ? 'var(--color-bg)' : 'transparent',
                        color: tool === t.id ? 'var(--color-text)' : 'var(--color-muted)',
                      }}
                    >
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-2xl">
        {status && !status.ai && (
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
            No text model available for recipes — add a chat model (Anthropic, Gemini, or DeepSeek) in Settings → AI & Chat. Image models (FAL) are used only for dish photos, same as Graphics.
          </div>
        )}

        {status && !status.imageGen && status.imageError && (
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
            Dish photos: {status.imageError}. Uses your Graphics model from Settings → AI & Chat.
          </div>
        )}

        {tool === 'leftovers' && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Leftover recipes</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                List what you have. We always assume {status?.pantryStaples?.join(', ') || 'salt, pepper, olive oil'} are in the cupboard.
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Ingredients on hand</span>
              <Tooltip text="List everything you have — one per item or comma-separated">
                <textarea
                  value={ingredients}
                  onChange={(e) => setIngredients(e.target.value)}
                  rows={4}
                  placeholder="canned tuna, mushrooms, pasta, milk, rice, eggplant…"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </Tooltip>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Notes (optional)</span>
              <Tooltip text="Free-text preferences — servings, equipment, style">
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. feeding two, prefer something warm, no oven"
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </Tooltip>
            </label>

            <div className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Dietary restrictions (optional)</span>
              <RestrictionPicker options={status?.dietaryRestrictions} selected={restrictions} onChange={setRestrictions} />
            </div>

            <Tooltip text="Generate four dish ideas from your ingredients">
              <button
                type="button"
                onClick={handleSuggest}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                Suggest four recipes
              </button>
            </Tooltip>

            {suggestions?.recipes?.length > 0 && (
              <div className="space-y-3">
                <div
                  className="rounded-xl border px-3 py-2.5"
                  style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}
                >
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                    Choose one — tap a card below
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    Steps, dish photo, nutrition, and save options load when you select a meal.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {suggestions.recipes.map((r) => (
                    <RecipeCard
                      key={r.id}
                      recipe={r}
                      selected={selectedCard?.id === r.id}
                      loading={expandingCardId === r.id}
                      onSelect={handleSelectCard}
                    />
                  ))}
                </div>
              </div>
            )}

            {expanded && (
              <RecipeDetailPanel
                expanded={expanded}
                dishImage={dishImage}
                saveTags={saveTags}
                onSaveTagsChange={setSaveTags}
                onRegenerateImage={() => handleGenerateImage({ expanded, setImage: setDishImage })}
                onComparePrices={(scaledIngredients, scaledServings) => handleDetailGroceryPrice(expanded, scaledIngredients, scaledServings)}
                groceryLoading={detailGroceryLoading}
                groceryResult={detailGroceryResult}
                onGroceryResultChange={setDetailGroceryResult}
                onSave={() => handleSaveRecipe({
                  expanded,
                  dishImage,
                  selectedCard,
                  source: 'leftovers',
                  transaction: {
                    ingredients: suggestions?.ingredients || ingredients,
                    notes: suggestions?.notes || notes,
                  },
                })}
                status={status}
              />
            )}
          </section>
        )}

        {tool === 'by-name' && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Recipe by name</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Enter a dish — get Basic, Advanced, and Master versions with accessible ingredient swaps.
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Dish name</span>
              <Tooltip text="The name of the dish you want to cook">
                <input
                  value={dishName}
                  onChange={(e) => setDishName(e.target.value)}
                  placeholder="Green Curry"
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </Tooltip>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Notes (optional)</span>
              <Tooltip text="Free-text preferences — protein, spice level, servings">
                <input
                  value={nameNotes}
                  onChange={(e) => setNameNotes(e.target.value)}
                  placeholder="e.g. chicken, mild heat, serves 4"
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </Tooltip>
            </label>

            <div className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Dietary restrictions (optional)</span>
              <RestrictionPicker options={status?.dietaryRestrictions} selected={namedRestrictions} onChange={setNamedRestrictions} />
            </div>

            <Tooltip text="Generate Basic, Advanced, and Master versions of this dish">
              <button
                type="button"
                onClick={handleNamedSuggest}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                Show Basic / Advanced / Master
              </button>
            </Tooltip>

            {nameSuggestions?.tiers?.length > 0 && (
              <div className="space-y-3">
                <div
                  className="rounded-xl border px-3 py-2.5"
                  style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}
                >
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                    Choose a level — tap a card below
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    Basic, Advanced, or Master — full recipe loads when you select one.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {nameSuggestions.tiers.map((t) => (
                    <TierCard
                      key={t.id}
                      recipe={t}
                      selected={selectedTier?.id === t.id}
                      loading={expandingTierId === t.id}
                      onSelect={handleSelectTier}
                    />
                  ))}
                </div>
              </div>
            )}

            {namedExpanded && (
              <RecipeDetailPanel
                expanded={namedExpanded}
                dishImage={namedDishImage}
                saveTags={namedSaveTags}
                onSaveTagsChange={setNamedSaveTags}
                onRegenerateImage={() => handleGenerateImage({ expanded: namedExpanded, setImage: setNamedDishImage })}
                onComparePrices={(scaledIngredients, scaledServings) => handleDetailGroceryPrice(namedExpanded, scaledIngredients, scaledServings)}
                groceryLoading={detailGroceryLoading}
                groceryResult={detailGroceryResult}
                onGroceryResultChange={setDetailGroceryResult}
                onSave={() => handleSaveRecipe({
                  expanded: namedExpanded,
                  dishImage: namedDishImage,
                  selectedCard: selectedTier,
                  source: 'named',
                  transaction: {
                    name: nameSuggestions?.name || dishName,
                    tier: selectedTier?.id,
                    notes: nameSuggestions?.notes || nameNotes,
                  },
                })}
                status={status}
              />
            )}
          </section>
        )}

        {tool === 'grocery-prices' && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Grocery prices</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Coles & Woolworths prices for your shopping list (Australia), sourced from live product search with a link back to each result.
              </p>
            </div>

            {status && !status.webSearch && (
              <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
                Add <code className="text-[10px]">SERPER_SEARCH_API_KEY</code> on Railway — add or edit the Shopping search model in Settings → AI & Chat → AI Models.
              </div>
            )}

            {activeRecipeForShop?.ingredients?.length > 0 && (
              <Tooltip text="Copy the currently open recipe's ingredients into this list">
                <button
                  type="button"
                  onClick={copyRecipeToGroceryInput}
                  className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                >
                  Use ingredients from {activeRecipeForShop.title || 'current recipe'}
                </button>
              </Tooltip>
            )}

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Shopping list</span>
              <Tooltip text="One ingredient per line, e.g. '500g chicken breast'">
                <textarea
                  value={groceryInput}
                  onChange={(e) => setGroceryInput(e.target.value)}
                  rows={8}
                  placeholder={'500g chicken breast\n400ml coconut milk\n2 tbsp green curry paste\n…'}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </Tooltip>
            </label>

            <Tooltip text="Look up live Coles & Woolworths prices for this list">
              <button
                type="button"
                onClick={handleGroceryPrice}
                disabled={!status?.webSearch}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {groceryResult ? 'Refresh prices' : 'Get prices'}
              </button>
            </Tooltip>

            {groceryResult && <GroceryPriceResults result={groceryResult} onResultChange={setGroceryResult} />}
          </section>
        )}

        {tool === 'meal-plan' && (
          <MealPlanTool
            libraryItems={libraryItems}
            loadLibrary={loadLibrary}
            mealPlans={mealPlans}
            mealPlansLoading={mealPlansLoading}
            loadMealPlans={loadMealPlans}
            mealPlanTitle={mealPlanTitle}
            setMealPlanTitle={setMealPlanTitle}
            mealPlanSelection={mealPlanSelection}
            setMealPlanSelection={setMealPlanSelection}
            onCreatePlan={handleCreateMealPlan}
            activeMealPlan={activeMealPlan}
            onOpenPlan={handleOpenMealPlan}
            onDeletePlan={handleDeleteMealPlan}
            onPricePlan={handlePriceMealPlan}
            mealPlanPricing={mealPlanPricing}
            mealPlanResult={mealPlanResult}
            setMealPlanResult={setMealPlanResult}
          />
        )}

        {tool === 'saved' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>My recipes</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Favourites saved from leftovers or recipe by name.</p>
              </div>
              <Tooltip text="Reload your saved recipes">
                <button type="button" onClick={loadLibrary} disabled={libraryLoading} className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                  {libraryLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </Tooltip>
            </div>

            <div className="space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Filter by tag</span>
              <TagPicker
                selected={libraryTagFilter ? [libraryTagFilter] : []}
                onChange={(tags) => setLibraryTagFilter(tags[tags.length - 1] || '')}
              />
            </div>

            {!libraryLoading && libraryItems.length === 0 && (
              <p className="text-xs rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                No saved recipes yet. Generate a recipe and tap <strong>Save to my recipes</strong>.
              </p>
            )}

            <ul className="space-y-2">
              {libraryItems.map((item) => (
                <li key={item.id} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <button type="button" onClick={() => setViewingSaved(viewingSaved?.id === item.id ? null : item)} className="text-left min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{item.title}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        {(item.tags || []).join(' · ') || 'uncategorised'} · {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}
                      </p>
                    </button>
                    <div className="flex gap-1.5 shrink-0">
                      {deleteConfirmId === item.id ? (
                        <span className="flex items-center gap-1 text-xs">
                          <span style={{ color: 'var(--color-muted)' }}>Delete?</span>
                          <button type="button" onClick={() => deleteLibraryItem(item.id)} style={{ color: '#ef4444' }}>Yes</button>
                          <button type="button" onClick={() => setDeleteConfirmId(null)} style={{ color: 'var(--color-muted)' }}>No</button>
                        </span>
                      ) : (
                        <Tooltip text="Delete this saved recipe">
                          <button type="button" onClick={() => setDeleteConfirmId(item.id)} className="text-xs" style={{ color: '#ef4444' }}>Delete</button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  {item.imageDataUrl && (
                    <img src={item.imageDataUrl} alt="" className="w-full max-h-32 object-cover rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />
                  )}
                  {viewingSaved?.id === item.id && item.payload && (
                    <div className="text-xs space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <ol className="list-decimal pl-4 space-y-1" style={{ color: 'var(--color-text)' }}>
                        {(item.payload.steps || []).map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                      {item.payload.nutrition?.summary && (
                        <>
                          <p style={{ color: 'var(--color-muted)' }}>{item.payload.nutrition.summary}</p>
                          <NutritionDisclaimer />
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
