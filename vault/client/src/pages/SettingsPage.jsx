import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSettingsStore from '../store/settingsStore';
import useAuthStore from '../store/authStore';
import { themes, fontOptions, iconPackOptions } from '../themes';
import { useIcon } from '../providers/IconProvider';
import { MODELS as DEFAULT_MODELS } from '../utils/models';
import api from '../utils/apiClient';
import { useModels } from '../hooks/useModels';
import GmailConnect from '../components/GmailConnect';
import CalendarConnect from '../components/CalendarConnect';
import DriveConnect from '../components/DriveConnect';
import { startGoalsTour, TOUR_KEY } from '../utils/tours/goalsTour';
import { startTasksTour, TOUR_KEY as TASKS_TOUR_KEY } from '../utils/tours/tasksTour';
import { startChainsTour, TOUR_KEY as CHAINS_TOUR_KEY } from '../utils/tours/chainsTour';
import { startRagTour, TOUR_KEY as RAG_TOUR_KEY } from '../utils/tours/ragTour';
import { startIntegrationsTour, TOUR_KEY as INTEGRATIONS_TOUR_KEY } from '../utils/tours/integrationsTour';
import { startGettingStartedTour, TOUR_KEY as GETTING_STARTED_TOUR_KEY } from '../utils/tours/gettingStartedTour';
import { startMilestonesTour, TOUR_KEY as MILESTONES_TOUR_KEY } from '../utils/tours/milestonesTour';
import { startFinanceTour, TOUR_KEY as FINANCE_TOUR_KEY } from '../utils/tours/financeTour';
import { startMoodTour, TOUR_KEY as MOOD_TOUR_KEY } from '../utils/tours/moodTour';
import { startNewsDigestTour, TOUR_KEY as NEWS_DIGEST_TOUR_KEY } from '../utils/tours/newsDigestTour';
import { startCalendarTour, TOUR_KEY as CALENDAR_TOUR_KEY } from '../utils/tours/calendarTour';
import { startGraphTour, TOUR_KEY as GRAPH_TOUR_KEY } from '../utils/tours/graphTour';
import ConfirmModal from '../components/ConfirmModal';

function SettingsPage() {
  const navigate = useNavigate();
  const {
    font, theme, iconPack, setFont, setTheme, setIconPack,
    sessionBudget, setSessionBudget,
    budgetAlertThreshold, setBudgetAlertThreshold,
    budgetCriticalThreshold, setBudgetCriticalThreshold,
    budgetReAlertFrequency, setBudgetReAlertFrequency,
    allowedFileTypes, setAllowedFileTypes,
    taskReminderTimes, setTaskReminderTimes,
    taskRemindersPaused, setTaskRemindersPaused,
  } = useSettingsStore();
  const [customBudget, setCustomBudget] = useState(
    sessionBudget && ![0.10, 0.25, 0.50, 1.00, 5.00].includes(sessionBudget)
      ? String(sessionBudget)
      : ''
  );

  // Mood & Reflection reminder settings
  const [inquiryFrequency, setInquiryFrequency] = useState('off');  // 'off' | 'daily' | 'weekly'
  const [inquiryTime,      setInquiryTime]      = useState('09:00');
  const [inquiryDays,      setInquiryDays]      = useState([1, 3, 5]); // Mon/Wed/Fri default
  const [inquirySaved,     setInquirySaved]     = useState(false);

  // News Digest settings
  const DEFAULT_DIGEST_SOURCES = [
    { name: 'ABC News',           url: 'https://www.abc.net.au/news/feed/51120/rss.xml',    enabled: true },
    { name: 'Guardian Australia', url: 'https://www.theguardian.com/australia-news/rss',    enabled: true },
    { name: 'Reuters',            url: 'https://feeds.reuters.com/reuters/topNews',          enabled: true },
    { name: 'Sky News',           url: 'https://feeds.skynews.com/feeds/rss/world.xml',     enabled: true },
    { name: 'Google News',        url: '__google_news__',                                    enabled: true },
  ];
  const [digestTime,    setDigestTime]    = useState('07:00');
  const [digestDays,    setDigestDays]    = useState([0, 1, 2, 3, 4, 5, 6]);
  const [digestSources, setDigestSources] = useState(DEFAULT_DIGEST_SOURCES);
  const [digestSaved,   setDigestSaved]   = useState(false);
  const [newFeedName,   setNewFeedName]   = useState('');
  const [newFeedUrl,    setNewFeedUrl]    = useState('');

  const BUDGET_PRESETS = [0.10, 0.25, 0.50, 1.00, 5.00];
  const { token } = useAuthStore();
  const getIcon = useIcon();

  const [profileName, setProfileName] = useState('');
  const [profileCity, setProfileCity] = useState('');
  const [profileState, setProfileState] = useState('');
  const [profileCountry, setProfileCountry] = useState('');

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwStatus, setPwStatus] = useState(null);
  const [fileTypesSaved, setFileTypesSaved] = useState(false);
  const [showPwFields, setShowPwFields] = useState({ current: false, next: false, confirm: false });
  const [modelStatus, setModelStatus] = useState(null);
  const { models, saveModels } = useModels();
  const [editingModel, setEditingModel] = useState(null); // model object being edited, or 'new'
  const [modelForm, setModelForm] = useState({});
  const [showReopenWizardConfirm, setShowReopenWizardConfirm] = useState(false);
  const [showResetGoalsConfirm, setShowResetGoalsConfirm] = useState(false);
  const [tab, setTab] = useState(() => localStorage.getItem('settingsTab') || 'Appearance');
  const [missionReviewFreq, setMissionReviewFreq] = useState('off');
  const [missionLastReviewed, setMissionLastReviewed] = useState(null);
  const [missionSnoozedUntil, setMissionSnoozedUntil] = useState(null);

  const TABS = ['Appearance', 'Profile', 'AI & Chat', 'Tasks', 'Goals', 'Integrations', 'News Digest', 'Tours'];

  function selectTab(t) {
    setTab(t);
    localStorage.setItem('settingsTab', t);
  }

  useEffect(() => {
    api.get('/api/chat/model-status').then(r => r.json()).then(setModelStatus).catch(() => {});
    // Load allowedFileTypes from DB. If no DB value exists yet, seed it with the
    // current comprehensive default (also fixes stale localStorage values from older builds).
    const DEFAULT_FILE_TYPES = '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.css,.html,.sql,.sh,.env.example,image/*';
    api.get('/api/settings').then(r => r.json()).then(data => {
      if (data.allowedFileTypes) {
        setAllowedFileTypes(data.allowedFileTypes);
      } else {
        setAllowedFileTypes(DEFAULT_FILE_TYPES);
        api.post('/api/settings', { key: 'allowedFileTypes', value: DEFAULT_FILE_TYPES }).catch(() => {});
      }
      if (data.budgetAlertThreshold) setBudgetAlertThreshold(Number(data.budgetAlertThreshold));
      if (data.budgetCriticalThreshold) setBudgetCriticalThreshold(Number(data.budgetCriticalThreshold));
      if (data.budgetReAlertFrequency) setBudgetReAlertFrequency(data.budgetReAlertFrequency);
      if (data.task_reminder_times) {
        try { setTaskReminderTimes(JSON.parse(data.task_reminder_times)); } catch {}
      }
      if (data.task_reminders_paused !== undefined) {
        setTaskRemindersPaused(data.task_reminders_paused === 'true');
      }
      if (data.user_name) setProfileName(data.user_name);
      if (data.user_city) setProfileCity(data.user_city);
      if (data.user_state) setProfileState(data.user_state);
      if (data.user_country) setProfileCountry(data.user_country);
      if (data.inquiry_reminder_frequency) setInquiryFrequency(data.inquiry_reminder_frequency);
      if (data.inquiry_reminder_time)      setInquiryTime(data.inquiry_reminder_time);
      if (data.inquiry_reminder_days)      { try { setInquiryDays(JSON.parse(data.inquiry_reminder_days)); } catch {} }
      if (data.mission_review_frequency)   setMissionReviewFreq(data.mission_review_frequency);
      setMissionLastReviewed(data.mission_last_reviewed_at || null);
      setMissionSnoozedUntil(data.mission_review_snoozed_until || null);
    }).catch(() => {});

    api.get('/api/news-digest/settings').then(r => r.json()).then(data => {
      if (data.time)    setDigestTime(data.time);
      if (data.days)    setDigestDays(data.days);
      if (data.sources) setDigestSources(data.sources);
    }).catch(() => {});
  }, []);

  const EMPTY_MODEL = { emoji: '🤖', name: '', label: '', id: '', provider: 'anthropic', tagline: '', desc: '' };

  function openAdd() { setModelForm(EMPTY_MODEL); setEditingModel('new'); }
  function openEdit(m) { setModelForm({ ...m }); setEditingModel(m.id); }
  function cancelEdit() { setEditingModel(null); setModelForm({}); }

  async function saveModel() {
    if (!modelForm.id.trim() || !modelForm.name.trim()) return;
    let updated;
    if (editingModel === 'new') {
      updated = [...models, { ...modelForm, id: modelForm.id.trim() }];
    } else {
      updated = models.map(m => m.id === editingModel ? { ...modelForm, id: modelForm.id.trim() } : m);
    }
    await saveModels(updated);
    cancelEdit();
  }

  async function deleteModel(id) {
    await saveModels(models.filter(m => m.id !== id));
  }

  async function resetModels() {
    await saveModels(DEFAULT_MODELS);
  }

  const [testResults, setTestResults] = useState({}); // { [modelId]: { status: 'testing'|'ok'|'error', message } }

  async function testModel(modelId) {
    setTestResults(r => ({ ...r, [modelId]: { status: 'testing' } }));
    try {
      const res = await api.post('/api/chat/test-model', { modelId });
      const data = await res.json();
      if (data.ok) {
        setTestResults(r => ({ ...r, [modelId]: { status: 'ok', message: data.response } }));
      } else {
        setTestResults(r => ({ ...r, [modelId]: { status: 'error', message: data.error, hint: data.hint } }));
      }
    } catch {
      setTestResults(r => ({ ...r, [modelId]: { status: 'error', message: 'Connection error.' } }));
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwStatus(null);
    if (pwForm.next !== pwForm.confirm) return setPwStatus({ ok: false, msg: 'New passwords do not match' });
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const data = await res.json();
      if (!res.ok) return setPwStatus({ ok: false, msg: data.error });
      setPwStatus({ ok: true, msg: 'Password updated' });
      setPwForm({ current: '', next: '', confirm: '' });
    } catch {
      setPwStatus({ ok: false, msg: 'Network error' });
    }
  }

  const DEFAULT_FILE_TYPES = '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.css,.html,.sql,.sh,.env.example,image/*';

  async function saveFileTypes() {
    await api.post('/api/settings', { key: 'allowedFileTypes', value: allowedFileTypes }).catch(() => {});
    setFileTypesSaved(true);
    setTimeout(() => setFileTypesSaved(false), 2000);
  }

  async function resetFileTypes() {
    setAllowedFileTypes(DEFAULT_FILE_TYPES);
    await api.post('/api/settings', { key: 'allowedFileTypes', value: DEFAULT_FILE_TYPES }).catch(() => {});
    setFileTypesSaved(true);
    setTimeout(() => setFileTypesSaved(false), 2000);
  }

  async function saveInquiryReminder() {
    await Promise.all([
      api.post('/api/settings', { key: 'inquiry_reminder_frequency', value: inquiryFrequency }).catch(() => {}),
      api.post('/api/settings', { key: 'inquiry_reminder_time',      value: inquiryTime      }).catch(() => {}),
      api.post('/api/settings', { key: 'inquiry_reminder_days',      value: JSON.stringify(inquiryDays) }).catch(() => {}),
    ]);
    setInquirySaved(true);
    setTimeout(() => setInquirySaved(false), 2000);
  }

  async function saveDigestSettings() {
    try {
      await api.post('/api/news-digest/settings', { time: digestTime, days: digestDays, sources: digestSources });
      setDigestSaved(true);
      setTimeout(() => setDigestSaved(false), 2000);
    } catch {
      // silent — toast not imported in scope here, server errors will show on next load
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
        Settings
      </h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginTop: 16, marginBottom: 28, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => selectTab(t)}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? 'var(--color-primary)' : 'var(--color-muted)',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${tab === t ? 'var(--color-primary)' : 'transparent'}`,
              marginBottom: -1,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-10">

      {/* Profile Section */}
      {tab === 'Profile' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Profile
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>First name</label>
            <input
              type="text"
              value={profileName}
              onChange={e => setProfileName(e.target.value)}
              onBlur={() => api.post('/api/settings', { key: 'user_name', value: profileName }).catch(() => {})}
              placeholder="e.g. James"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>City</label>
              <input
                type="text"
                value={profileCity}
                onChange={e => setProfileCity(e.target.value)}
                onBlur={() => api.post('/api/settings', { key: 'user_city', value: profileCity }).catch(() => {})}
                placeholder="e.g. Sydney"
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>State / Region</label>
              <input
                type="text"
                value={profileState}
                onChange={e => setProfileState(e.target.value)}
                onBlur={() => api.post('/api/settings', { key: 'user_state', value: profileState }).catch(() => {})}
                placeholder="e.g. NSW"
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Country</label>
            <select
              value={profileCountry}
              onChange={e => {
                setProfileCountry(e.target.value);
                api.post('/api/settings', { key: 'user_country', value: e.target.value }).catch(() => {});
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Select country…</option>
              {[
                'Afghanistan','Albania','Algeria','Argentina','Armenia','Australia','Austria',
                'Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Bolivia','Bosnia and Herzegovina',
                'Brazil','Bulgaria','Cambodia','Cameroon','Canada','Chile','China','Colombia',
                'Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Dominican Republic',
                'Ecuador','Egypt','El Salvador','Estonia','Ethiopia','Finland','France','Georgia',
                'Germany','Ghana','Greece','Guatemala','Honduras','Hong Kong','Hungary','India',
                'Indonesia','Iran','Iraq','Ireland','Israel','Italy','Japan','Jordan','Kazakhstan',
                'Kenya','Kuwait','Latvia','Lebanon','Libya','Lithuania','Luxembourg','Malaysia',
                'Mexico','Morocco','Myanmar','Nepal','Netherlands','New Zealand','Nigeria','North Korea',
                'Norway','Oman','Pakistan','Panama','Paraguay','Peru','Philippines','Poland',
                'Portugal','Qatar','Romania','Russia','Saudi Arabia','Serbia','Singapore',
                'Slovakia','Slovenia','South Africa','South Korea','Spain','Sri Lanka','Sudan',
                'Sweden','Switzerland','Syria','Taiwan','Thailand','Tunisia','Turkey','Ukraine',
                'United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan',
                'Venezuela','Vietnam','Yemen','Zimbabwe',
              ].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </section>
      )}

      {/* Theme, Font, Icon Pack — Appearance tab */}
      {tab === 'Appearance' && (<>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Theme
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(themes).map(([key, t]) => (
            <button
              key={key}
              onClick={() => setTheme(key)}
              className="p-3 rounded-lg border-2 text-left transition-all"
              style={{
                background: t.bg,
                borderColor: theme === key ? t.primary : t.border,
                boxShadow: theme === key ? `0 0 0 2px ${t.primary}33` : 'none',
              }}
            >
              <div className="flex gap-1 mb-2">
                {[t.bg, t.surface, t.primary, t.text].map((c, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 rounded-full border"
                    style={{ background: c, borderColor: t.border }}
                  />
                ))}
              </div>
              <span className="text-xs font-medium" style={{ color: t.text }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Font Section */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Font
        </h2>
        <div className="space-y-2">
          {fontOptions.map((f) => (
            <button
              key={f.value}
              onClick={() => setFont(f.value)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all"
              style={{
                background: font === f.value ? 'var(--color-surface)' : 'transparent',
                borderColor: font === f.value ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              <span style={{ fontFamily: f.style, fontSize: '1rem' }}>{f.label}</span>
              <span className="text-xs" style={{ fontFamily: f.style, color: 'var(--color-muted)' }}>
                The quick brown fox
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Icon Pack Section */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Icon Pack
        </h2>
        <div className="flex gap-3">
          {iconPackOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setIconPack(opt.value)}
              className="flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-all"
              style={{
                background: iconPack === opt.value ? 'var(--color-surface)' : 'transparent',
                borderColor: iconPack === opt.value ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>
      </>)}

      {/* Session Budget, Token Budget, File Types, AI Models — AI & Chat tab */}
      {tab === 'AI & Chat' && (<>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Session Budget
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Show a warning when a single chat session approaches or exceeds a cost limit.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => { setSessionBudget(null); setCustomBudget(''); }}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
            style={{
              background: sessionBudget === null ? 'var(--color-primary)' : 'var(--color-surface)',
              borderColor: sessionBudget === null ? 'var(--color-primary)' : 'var(--color-border)',
              color: sessionBudget === null ? '#fff' : 'var(--color-text)',
            }}
          >
            Off
          </button>
          {BUDGET_PRESETS.map(v => (
            <button
              key={v}
              onClick={() => { setSessionBudget(v); setCustomBudget(''); }}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
              style={{
                background: sessionBudget === v ? 'var(--color-primary)' : 'var(--color-surface)',
                borderColor: sessionBudget === v ? 'var(--color-primary)' : 'var(--color-border)',
                color: sessionBudget === v ? '#fff' : 'var(--color-text)',
              }}
            >
              ${v.toFixed(2)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Custom ($)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="e.g. 2.50"
            value={customBudget}
            onChange={e => {
              setCustomBudget(e.target.value);
              const v = parseFloat(e.target.value);
              if (v > 0) setSessionBudget(v);
            }}
            className="w-28 px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{
              background: 'var(--color-surface)',
              borderColor: customBudget && !BUDGET_PRESETS.includes(sessionBudget) && sessionBudget !== null
                ? 'var(--color-primary)'
                : 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          {sessionBudget !== null && (
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Warn at ${(sessionBudget * (budgetAlertThreshold / 100)).toFixed(3)} ({budgetAlertThreshold}%) and ${(sessionBudget * (budgetCriticalThreshold / 100)).toFixed(3)} ({budgetCriticalThreshold}%)
            </span>
          )}
        </div>
      </section>

      {/* Token Budget Alert Controls */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Token Budget Alerts
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Control when and how often budget alerts appear in the chat interface.
        </p>

        <div className="space-y-4">
          {/* Initial alert threshold */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>Initial alert threshold</p>
            <div className="flex flex-wrap gap-2">
              {[50, 60, 70, 80, 90].map(pct => (
                <button
                  key={pct}
                  onClick={() => { setBudgetAlertThreshold(pct); api.post('/api/settings', { key: 'budgetAlertThreshold', value: String(pct) }).catch(() => {}); }}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                  style={{
                    background: budgetAlertThreshold === pct ? 'var(--color-primary)' : 'var(--color-surface)',
                    borderColor: budgetAlertThreshold === pct ? 'var(--color-primary)' : 'var(--color-border)',
                    color: budgetAlertThreshold === pct ? '#fff' : 'var(--color-text)',
                  }}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Critical threshold */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>Critical threshold</p>
            <div className="flex flex-wrap gap-2">
              {[90, 95, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => { setBudgetCriticalThreshold(pct); api.post('/api/settings', { key: 'budgetCriticalThreshold', value: String(pct) }).catch(() => {}); }}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                  style={{
                    background: budgetCriticalThreshold === pct ? '#ef4444' : 'var(--color-surface)',
                    borderColor: budgetCriticalThreshold === pct ? '#ef4444' : 'var(--color-border)',
                    color: budgetCriticalThreshold === pct ? '#fff' : 'var(--color-text)',
                  }}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Re-alert frequency */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>Re-alert frequency after dismissal</p>
            <div className="flex flex-col gap-1.5">
              {[
                { value: 'session', label: "Don't show again this session" },
                { value: 'every10', label: 'Every 10 messages' },
                { value: 'every20', label: 'Every 20 messages' },
                { value: 'at95', label: 'When I hit 95%' },
              ].map(opt => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="reAlertFreq"
                    value={opt.value}
                    checked={budgetReAlertFrequency === opt.value}
                    onChange={() => { setBudgetReAlertFrequency(opt.value); api.post('/api/settings', { key: 'budgetReAlertFrequency', value: opt.value }).catch(() => {}); }}
                    className="accent-current"
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Upload File Types */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Upload File Types
        </h2>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          Comma-separated list of accepted file extensions and MIME types for all file upload inputs.
        </p>
        <input
          type="text"
          value={allowedFileTypes}
          onChange={(e) => setAllowedFileTypes(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          placeholder=".pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.css,.html,.sql,.sh,.env.example,image/*"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={saveFileTypes}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Save
          </button>
          <button
            onClick={resetFileTypes}
            className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
          >
            Reset to defaults
          </button>
          {fileTypesSaved && (
            <span className="text-xs" style={{ color: 'var(--color-primary)' }}>Saved ✓</span>
          )}
        </div>
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
          Examples: <code>.pdf,.docx,.xlsx</code> or <code>image/*</code> or <code>.pdf,image/*,.txt</code>
        </p>
      </section>

      {/* AI Models */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
            AI Models
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={resetModels}
              className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
              title="Reset to defaults"
            >
              Reset defaults
            </button>
            <button
              onClick={openAdd}
              className="text-xs px-2 py-1 rounded-lg text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              + Add model
            </button>
          </div>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Add, edit, or remove models. The model ID must match the exact API identifier (e.g. <code>claude-sonnet-4-6</code>).
        </p>

        {/* Add / Edit form */}
        {editingModel && (
          <div className="rounded-xl border p-4 mb-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
              {editingModel === 'new' ? 'Add model' : 'Edit model'}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Model API ID *</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none font-mono"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. claude-haiku-4-5-20251001"
                  value={modelForm.id}
                  onChange={e => setModelForm(f => ({ ...f, id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Display name *</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. Haiku 4.5"
                  value={modelForm.name}
                  onChange={e => setModelForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Label</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. Economy"
                  value={modelForm.label}
                  onChange={e => setModelForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Provider</label>
                <select
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  value={modelForm.provider}
                  onChange={e => setModelForm(f => ({ ...f, provider: e.target.value }))}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Emoji</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="⚡"
                  value={modelForm.emoji}
                  onChange={e => setModelForm(f => ({ ...f, emoji: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Tagline</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. Fast & affordable"
                  value={modelForm.tagline}
                  onChange={e => setModelForm(f => ({ ...f, tagline: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Description</label>
              <input
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                placeholder="e.g. Best for quick tasks, drafts, and simple Q&A"
                value={modelForm.desc}
                onChange={e => setModelForm(f => ({ ...f, desc: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveModel}
                disabled={!modelForm.id.trim() || !modelForm.name.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {editingModel === 'new' ? 'Add' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Model list */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {models.map((m, i) => {
            const configured = modelStatus ? modelStatus[m.provider] : null;
            return (
              <div
                key={m.id}
                className="flex flex-col px-4 py-3"
                style={{
                  background: 'var(--color-surface)',
                  borderBottom: i < models.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl flex-shrink-0">{m.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{m.name}</span>
                      {m.label && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>{m.label}</span>}
                    </div>
                    <div className="text-xs font-mono mt-0.5 truncate" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>{m.id}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {configured === true && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>✓ Key set</span>
                    )}
                    {configured === false && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" title={m.provider === 'gemini' ? 'GEMINI_API_KEY not set' : m.provider === 'deepseek' ? 'DEEPSEEK_API_KEY not set' : 'ANTHROPIC_API_KEY not set'} style={{ background: '#fef3c7', color: '#b45309' }}>⚠️ Key missing</span>
                    )}
                    <button
                      onClick={() => testModel(m.id)}
                      disabled={testResults[m.id]?.status === 'testing'}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70 disabled:opacity-50"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      {testResults[m.id]?.status === 'testing' ? 'Testing…' : 'Test'}
                    </button>
                    <button
                      onClick={() => openEdit(m)}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteModel(m.id)}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70"
                      style={{ borderColor: '#fca5a5', color: '#991b1b' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {testResults[m.id] && testResults[m.id].status !== 'testing' && (
                  <div
                    className="mt-2 px-3 py-2 rounded-lg text-xs flex items-start gap-2"
                    style={{
                      background: testResults[m.id].status === 'ok' ? '#f0fdf4' : '#fff1f2',
                      color: testResults[m.id].status === 'ok' ? '#16a34a' : '#991b1b',
                    }}
                  >
                    <span className="flex-shrink-0">{testResults[m.id].status === 'ok' ? '✓' : '✗'}</span>
                    <span className="flex-1">{testResults[m.id].message}{testResults[m.id].hint ? ` — ${testResults[m.id].hint}` : ''}</span>
                    <button onClick={() => setTestResults(r => { const n = { ...r }; delete n[m.id]; return n; })} className="flex-shrink-0 opacity-50 hover:opacity-100">✕</button>
                  </div>
                )}
              </div>
            );
          })}
          {models.length === 0 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--color-muted)' }}>
              No models configured. Add one above or reset to defaults.
            </div>
          )}
        </div>
      </section>
      </>)}

      {/* Change Password — Profile tab */}
      {tab === 'Profile' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Change Password
        </h2>
        <form
          onSubmit={handleChangePassword}
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {[
            { label: 'Current Password', key: 'current' },
            { label: 'New Password', key: 'next' },
            { label: 'Confirm New Password', key: 'confirm' },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                {label}
              </label>
              <div className="relative">
                <input
                  type={showPwFields[key] ? 'text' : 'password'}
                  value={pwForm[key]}
                  onChange={e => setPwForm(f => ({ ...f, [key]: e.target.value }))}
                  required
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwFields((prev) => ({ ...prev, [key]: !prev[key] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {getIcon(showPwFields[key] ? 'eye-off' : 'eye', { size: 14 })}
                </button>
              </div>
            </div>
          ))}
          {pwStatus && (
            <p className="text-xs" style={{ color: pwStatus.ok ? 'var(--color-primary)' : '#ef4444' }}>
              {pwStatus.msg}
            </p>
          )}
          <button
            type="submit"
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Update Password
          </button>
        </form>
      </section>
      )}

      {/* Live Preview — Appearance tab */}
      {tab === 'Appearance' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Preview
        </h2>
        <div
          className="p-4 rounded-lg border space-y-3"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            {getIcon('folder', { size: 16 })}
            <span className="text-sm">Sample Project</span>
          </div>
          <div className="flex items-center gap-2">
            {getIcon('chat', { size: 16 })}
            <span className="text-sm">Chat Session</span>
          </div>
          <div className="flex items-center gap-2">
            {getIcon('settings', { size: 16 })}
            <span className="text-sm">Settings & Preferences</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            The quick brown fox jumps over the lazy dog
          </p>
          <button
            className="px-3 py-1 rounded text-xs text-white font-medium"
            style={{ background: 'var(--color-primary)' }}
          >
            Primary Action
          </button>
        </div>
      </section>
      )}

      {/* Task Reminders — Tasks tab */}
      {tab === 'Tasks' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Task Reminders
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Show a reminder popup at selected times of day if you have overdue or today's tasks.
        </p>

        {taskRemindersPaused && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
            ⏸ Reminders are currently paused
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { value: '05:00', label: '5 AM' },
            { value: '08:00', label: '8 AM' },
            { value: '10:00', label: '10 AM' },
            { value: '12:00', label: '12 PM' },
            { value: '14:00', label: '2 PM' },
            { value: '17:00', label: '5 PM' },
            { value: '20:00', label: '8 PM' },
          ].map(({ value, label }) => {
            const active = taskReminderTimes.includes(value);
            return (
              <button
                key={value}
                onClick={() => {
                  const updated = active
                    ? taskReminderTimes.filter(t => t !== value)
                    : [...taskReminderTimes, value].sort();
                  setTaskReminderTimes(updated);
                  api.post('/api/settings', { key: 'task_reminder_times', value: JSON.stringify(updated) }).catch(() => {});
                }}
                className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                style={{
                  background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                  borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                  color: active ? '#fff' : 'var(--color-text)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <div
            onClick={() => {
              const next = !taskRemindersPaused;
              setTaskRemindersPaused(next);
              api.post('/api/settings', { key: 'task_reminders_paused', value: String(next) }).catch(() => {});
            }}
            className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
            style={{ background: taskRemindersPaused ? 'var(--color-border)' : 'var(--color-primary)', cursor: 'pointer' }}
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: taskRemindersPaused ? 'translateX(1px)' : 'translateX(17px)' }}
            />
          </div>
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Pause all reminders</span>
        </label>
      </section>
      )}

      {/* Mood & Reflection — Tasks tab */}
      {tab === 'Tasks' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Mood &amp; Reflection
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Remind yourself to pause for a guided emotional inquiry.
        </p>

        {/* Frequency */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
            Guided inquiry reminder
          </label>
          <div className="flex gap-2">
            {['off', 'daily', 'weekly'].map(opt => (
              <button
                key={opt}
                onClick={() => setInquiryFrequency(opt)}
                className="px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all"
                style={{
                  background:  inquiryFrequency === opt ? 'var(--color-primary)' : 'var(--color-surface)',
                  borderColor: inquiryFrequency === opt ? 'var(--color-primary)' : 'var(--color-border)',
                  color:       inquiryFrequency === opt ? '#fff' : 'var(--color-text)',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Reminder time — visible when daily or weekly */}
        {(inquiryFrequency === 'daily' || inquiryFrequency === 'weekly') && (
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Reminder time
            </label>
            <input
              type="time"
              value={inquiryTime}
              onChange={e => setInquiryTime(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
        )}

        {/* Reminder days — visible when weekly */}
        {inquiryFrequency === 'weekly' && (
          <div className="mb-4">
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
              Reminder days
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { day: 1, label: 'Mon' }, { day: 2, label: 'Tue' }, { day: 3, label: 'Wed' },
                { day: 4, label: 'Thu' }, { day: 5, label: 'Fri' }, { day: 6, label: 'Sat' },
                { day: 0, label: 'Sun' },
              ].map(({ day, label }) => {
                const active = inquiryDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => setInquiryDays(prev =>
                      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
                    )}
                    className="px-2.5 py-1 rounded-lg border text-xs font-medium transition-all"
                    style={{
                      background:  active ? 'var(--color-primary)' : 'var(--color-surface)',
                      borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                      color:       active ? '#fff' : 'var(--color-text)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          onClick={saveInquiryReminder}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: inquirySaved ? '#22c55e' : 'var(--color-primary)' }}
        >
          {inquirySaved ? 'Saved ✓' : 'Save'}
        </button>
      </section>
      )}

      {/* News Digest tab */}
      {tab === 'News Digest' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Schedule
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          When the daily digest runs automatically. Uses Australia/Sydney time.
        </p>

        <div className="mb-5">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Time
          </label>
          <input
            type="time"
            value={digestTime}
            onChange={e => setDigestTime(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>

        <div className="mb-6">
          <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
            Days
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { day: 1, label: 'Mon' }, { day: 2, label: 'Tue' }, { day: 3, label: 'Wed' },
              { day: 4, label: 'Thu' }, { day: 5, label: 'Fri' }, { day: 6, label: 'Sat' },
              { day: 0, label: 'Sun' },
            ].map(({ day, label }) => {
              const active = digestDays.includes(day);
              return (
                <button
                  key={day}
                  onClick={() => setDigestDays(prev =>
                    prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
                  )}
                  className="px-2.5 py-1 rounded-lg border text-xs font-medium transition-all"
                  style={{
                    background:  active ? 'var(--color-primary)' : 'var(--color-surface)',
                    borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                    color:       active ? '#fff' : 'var(--color-text)',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Sources
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Toggle sources on or off, or add custom RSS feeds.
        </p>

        <div className="space-y-2 mb-4">
          {digestSources.map((source, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: source.enabled !== false ? 'var(--color-text)' : 'var(--color-muted)' }}>
                  {source.name}
                </p>
                {source.url !== '__google_news__' && (
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>{source.url}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div
                  onClick={() => setDigestSources(prev => prev.map((s, idx) =>
                    idx === i ? { ...s, enabled: s.enabled === false } : s
                  ))}
                  className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                  style={{ background: source.enabled !== false ? 'var(--color-primary)' : 'var(--color-border)', cursor: 'pointer' }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                    style={{ transform: source.enabled !== false ? 'translateX(17px)' : 'translateX(1px)' }}
                  />
                </div>
                {/* Only allow deleting custom (non-default) sources */}
                {!['ABC News', 'Guardian Australia', 'Reuters', 'Sky News', 'Google News'].includes(source.name) && (
                  <button
                    onClick={() => setDigestSources(prev => prev.filter((_, idx) => idx !== i))}
                    className="w-6 h-6 flex items-center justify-center rounded text-xs hover:opacity-60"
                    style={{ color: '#ef4444' }}
                    title="Remove"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add custom RSS feed */}
        <div
          className="p-3 rounded-xl border space-y-2 mb-5"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Add custom RSS feed</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newFeedName}
              onChange={e => setNewFeedName(e.target.value)}
              placeholder="Name (e.g. BBC News)"
              className="flex-1 px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <input
              type="url"
              value={newFeedUrl}
              onChange={e => setNewFeedUrl(e.target.value)}
              placeholder="RSS URL"
              className="flex-1 px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <button
              onClick={() => {
                if (!newFeedName.trim() || !newFeedUrl.trim()) return;
                setDigestSources(prev => [...prev, { name: newFeedName.trim(), url: newFeedUrl.trim(), enabled: true }]);
                setNewFeedName('');
                setNewFeedUrl('');
              }}
              disabled={!newFeedName.trim() || !newFeedUrl.trim()}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Add
            </button>
          </div>
        </div>

        <button
          onClick={saveDigestSettings}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: digestSaved ? '#22c55e' : 'var(--color-primary)' }}
        >
          {digestSaved ? 'Saved ✓' : 'Save'}
        </button>
      </section>
      )}

      {/* Integrations tab */}
      {tab === 'Integrations' && (
      <section data-tour="integrations-section">
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Integrations</h2>
        <div className="space-y-3">
          <div data-tour="gmail-connect"><GmailConnect /></div>
          <div data-tour="calendar-connect"><CalendarConnect /></div>
          <DriveConnect />
        </div>
      </section>
      )}

      {/* Product Tours — Tours tab */}
      {tab === 'Tours' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Product Tours
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Getting Started Wizard Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                6-step preparation tour — understand the wizard, the 7 Habits framework, and what gets created before you begin
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(GETTING_STARTED_TOUR_KEY);
                navigate('/goals');
                setTimeout(() => startGettingStartedTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(GETTING_STARTED_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Goals &amp; 7 Habits Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                8-step walkthrough of Mission Statement, Renewal Balance, OKRs, and Eisenhower Matrix
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(TOUR_KEY);
                navigate('/goals');
                setTimeout(() => startGoalsTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              Retake Tour
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Milestones Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                6-step walkthrough of milestone flags, Calendar diamonds, Goals timeline, and Weekly Review awareness
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(MILESTONES_TOUR_KEY);
                navigate('/tasks');
                setTimeout(() => startMilestonesTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(MILESTONES_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Finance Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                7-step walkthrough of invoicing, expenses, GST auto-calc, BAS workflow, and the double-entry journal
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(FINANCE_TOUR_KEY);
                navigate('/finance');
                setTimeout(() => startFinanceTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(FINANCE_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Getting Started Wizard</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                7-step guided setup for your mission, objectives, key results, and renewal balance
              </p>
            </div>
            <button
              onClick={async () => {
                await fetch('/api/goals/wizard/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }).catch(() => {});
                navigate('/goals');
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              Redo Setup
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Task Manager Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                10-step walkthrough of views, Quick Capture, Focus Mode, templates, and Weekly Review
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(TASKS_TOUR_KEY);
                navigate('/tasks');
                setTimeout(() => startTasksTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              Retake Tour
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Prompt Chains Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                6-step walkthrough of building, editing, and running multi-step AI pipelines
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(CHAINS_TOUR_KEY);
                navigate('/chains');
                setTimeout(() => startChainsTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              Retake Tour
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Project Context & RAG Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                6-step walkthrough of project context fields, AI model selection, pinned URLs, and file uploads
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(RAG_TOUR_KEY);
                navigate('/');
                setTimeout(() => startRagTour(navigate, null), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              Retake Tour
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Gmail & Calendar Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                7-step walkthrough of connecting Google, using @gmail and @calendar in chat
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(INTEGRATIONS_TOUR_KEY);
                navigate('/settings');
                setTimeout(() => startIntegrationsTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              Retake Tour
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Mood Tracking Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                7-step tour — check-ins, guided inquiry, overview, sessions, pattern insights
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(MOOD_TOUR_KEY);
                setTimeout(() => startMoodTour(navigate), 200);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(MOOD_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>News Digest Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                7-step tour — topics, generating digests, AI analysis, commentary, follow-up chat
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(NEWS_DIGEST_TOUR_KEY);
                setTimeout(() => startNewsDigestTour(navigate), 200);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(NEWS_DIGEST_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Task Calendar Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                6-step tour — day/week/month/agenda views, drag to reschedule, resize for effort
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(CALENDAR_TOUR_KEY);
                setTimeout(() => startCalendarTour(navigate), 200);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(CALENDAR_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Knowledge Graph Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                7-step tour — navigation, semantic connections, AI insights, node types, project focus
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(GRAPH_TOUR_KEY);
                setTimeout(() => startGraphTour(navigate), 200);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(GRAPH_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
        </div>
      </section>
      )}

      {/* Goals Setup — Goals tab */}
      {tab === 'Goals' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>Mission Review Reminders</h2>
        <div className="space-y-3 mb-8">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Get a periodic nudge to revisit your mission statement. A badge appears on the Goals icon when a review is due.
          </p>
          <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>Review frequency</p>
            <div className="flex flex-wrap gap-2">
              {['off', 'weekly', 'monthly', 'quarterly'].map(freq => (
                <button
                  key={freq}
                  onClick={async () => {
                    setMissionReviewFreq(freq);
                    await api.post('/api/settings', { key: 'mission_review_frequency', value: freq }).catch(() => {});
                    window.dispatchEvent(new CustomEvent('vault:mission-reminder-cleared'));
                  }}
                  className="px-3 py-1.5 rounded-lg border text-sm transition-all"
                  style={{
                    borderColor: missionReviewFreq === freq ? 'var(--color-primary)' : 'var(--color-border)',
                    background: missionReviewFreq === freq ? 'var(--color-primary)' : 'transparent',
                    color: missionReviewFreq === freq ? '#fff' : 'var(--color-muted)',
                    fontWeight: missionReviewFreq === freq ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {freq.charAt(0).toUpperCase() + freq.slice(1)}
                </button>
              ))}
            </div>
            {missionLastReviewed && (
              <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                Last reviewed: {new Date(missionLastReviewed).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
            {missionSnoozedUntil && new Date(missionSnoozedUntil) > new Date() && (
              <p className="text-xs mt-1" style={{ color: '#f59e0b' }}>
                Snoozed until: {new Date(missionSnoozedUntil).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
          </div>
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>Goals Setup</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Reopen Setup Wizard</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                Reopen the Getting Started Wizard — your existing goals and tasks will not be affected
              </p>
            </div>
            <button
              onClick={() => setShowReopenWizardConfirm(true)}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: '#f59e0b', color: '#f59e0b', background: 'transparent' }}
            >
              Reopen Wizard
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: '#ef444433', background: '#ef44440a' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: '#ef4444' }}>Reset Goals & Rerun Setup</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                Permanently delete all objectives and key results, then rerun the wizard. Tasks are never deleted.
              </p>
            </div>
            <button
              onClick={() => setShowResetGoalsConfirm(true)}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: '#ef4444', color: '#ef4444', background: 'transparent' }}
            >
              Reset Goals
            </button>
          </div>
        </div>
      </section>
      )}

      </div>{/* end space-y-10 content area */}

      {showReopenWizardConfirm && (
        <ConfirmModal
          title="Reopen Setup Wizard?"
          message="This will reopen the Getting Started Wizard. Your existing goals and tasks will not be affected."
          confirmLabel="Reopen Wizard"
          onConfirm={async () => {
            setShowReopenWizardConfirm(false);
            await fetch('/api/goals/reset-setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ deleteObjectives: false }) }).catch(() => {});
            navigate('/goals?wizard=true');
          }}
          onCancel={() => setShowReopenWizardConfirm(false)}
        />
      )}

      {showResetGoalsConfirm && (
        <ConfirmModal
          title="Reset Goals & Rerun Setup?"
          message="This will permanently delete all your objectives and key results. Your tasks will not be deleted but will be unlinked from any goals. This cannot be undone."
          confirmLabel="Delete & Reset"
          danger
          confirmText="RESET"
          onConfirm={async () => {
            setShowResetGoalsConfirm(false);
            await fetch('/api/goals/reset-setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ deleteObjectives: true }) }).catch(() => {});
            navigate('/goals?wizard=true');
          }}
          onCancel={() => setShowResetGoalsConfirm(false)}
        />
      )}
    </div>
  );
}

export default SettingsPage;
