import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const RECIPE_TAG_OPTIONS = [
  'breakfast', 'lunch', 'dinner', 'snack', 'curry', 'pasta', 'rice', 'soup',
  'salad', 'fast', 'slow', 'vegetarian', 'vegan', 'leftovers', 'comfort', 'healthy',
];

const TOOL_GROUPS = [
  {
    id: 'create',
    label: 'Create',
    tools: [
      { id: 'leftovers', label: 'Leftover recipes', desc: 'Ingredients in → four ideas out' },
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

function formatMinutes(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function RecipeCard({ recipe, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(recipe)}
      className="text-left rounded-xl border p-4 space-y-2 transition-opacity hover:opacity-80 w-full"
      style={{
        borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
        background: selected ? 'var(--color-surface)' : 'var(--color-bg)',
      }}
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

export default function RecipesPage() {
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

  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryTagFilter, setLibraryTagFilter] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [viewingSaved, setViewingSaved] = useState(null);

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
    if (!canUse || tool !== 'saved') return;
    loadLibrary();
  }, [canUse, tool, loadLibrary]);

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
      const res = await api.post('/api/recipes/suggest', { ingredients, notes });
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
    setSaveTags([...(card.tags || []), card.mealType].filter(Boolean));
    startProcessing('Building recipe…', 'Writing steps, nutrition notes, and finding links.');
    try {
      const res = await api.post('/api/recipes/expand', {
        recipe: card,
        ingredients: suggestions?.ingredients || ingredients,
        notes: suggestions?.notes || notes,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not expand recipe');
      setExpanded(data);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleGenerateImage = async () => {
    if (!expanded) return;
    startProcessing('Generating dish photo…', 'This uses the same image engine as Graphics.');
    try {
      const res = await api.post('/api/recipes/image', {
        title: expanded.title,
        imagePrompt: expanded.imagePrompt,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image failed');
      setDishImage(data.imageDataUrl);
      addToast('Dish image ready', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleSaveRecipe = async () => {
    if (!expanded) return;
    startProcessing('Saving recipe…', '');
    try {
      const payload = {
        ...expanded,
        card: selectedCard,
        links: expanded.links,
      };
      const res = await api.post('/api/recipes/library', {
        title: expanded.title || selectedCard?.title,
        tags: saveTags,
        source: 'generated',
        payload,
        imageDataUrl: dishImage,
        transaction: {
          ingredients: suggestions?.ingredients || ingredients,
          notes: suggestions?.notes || notes,
        },
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
            Add an AI API key in Railway for recipe text generation.
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
              <textarea
                value={ingredients}
                onChange={(e) => setIngredients(e.target.value)}
                rows={4}
                placeholder="canned tuna, mushrooms, pasta, milk, rice, eggplant…"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Notes (optional)</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. feeding two, prefer something warm, no oven"
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </label>

            <button
              type="button"
              onClick={handleSuggest}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Suggest four recipes
            </button>

            {suggestions?.recipes?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Pick a recipe</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {suggestions.recipes.map((r) => (
                    <RecipeCard
                      key={r.id}
                      recipe={r}
                      selected={selectedCard?.id === r.id}
                      onSelect={handleSelectCard}
                    />
                  ))}
                </div>
              </div>
            )}

            {expanded && (
              <div className="rounded-xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{expanded.title}</h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                    Serves {expanded.servings || '—'} · prep {formatMinutes(expanded.prepMinutes)} · cook {formatMinutes(expanded.cookMinutes)}
                  </p>
                </div>

                {(dishImage || expanded.imageDataUrl) && (
                  <img src={dishImage || expanded.imageDataUrl} alt="" className="w-full max-h-56 object-cover rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                )}

                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Ingredients</p>
                  <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-muted)' }}>
                    {(expanded.ingredients || []).map((ing, i) => (
                      <li key={i}>{ing.amount ? `${ing.amount} ` : ''}{ing.item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Steps</p>
                  <ol className="text-xs space-y-2 list-decimal pl-4" style={{ color: 'var(--color-text)' }}>
                    {(expanded.steps || []).map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
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

                <div className="flex flex-wrap gap-2">
                  {status?.imageGen && (
                    <button
                      type="button"
                      onClick={handleGenerateImage}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      {dishImage ? 'Regenerate photo' : 'Generate dish photo'}
                    </button>
                  )}
                </div>

                <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Categories</p>
                  <TagPicker selected={saveTags} onChange={setSaveTags} />
                  <button
                    type="button"
                    onClick={handleSaveRecipe}
                    className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    Save to my recipes
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {tool === 'saved' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>My recipes</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Favourites you saved from leftover suggestions.</p>
              </div>
              <button type="button" onClick={loadLibrary} disabled={libraryLoading} className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                {libraryLoading ? 'Refreshing…' : 'Refresh'}
              </button>
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
                No saved recipes yet. Generate from leftovers and tap <strong>Save to my recipes</strong>.
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
                        <button type="button" onClick={() => setDeleteConfirmId(item.id)} className="text-xs" style={{ color: '#ef4444' }}>Delete</button>
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
                        <p style={{ color: 'var(--color-muted)' }}>{item.payload.nutrition.summary}</p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
