import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSettingsStore from '../store/settingsStore';
import useAuthStore from '../store/authStore';
import { themes, fontOptions, iconPackOptions } from '../themes';
import { useIcon } from '../providers/IconProvider';
import { formatModelSelectLabel } from '../utils/models';
import api from '../utils/apiClient';
import { useModels } from '../hooks/useModels';
import { LANGUAGES as TRANSLATE_LANGUAGES, orderLanguages } from '../utils/translateLanguages';
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
import { startProductScoutTour, TOUR_KEY as PRODUCT_SCOUT_TOUR_KEY } from '../utils/tours/productScoutTour';
import { startRecipesTour, TOUR_KEY as RECIPES_TOUR_KEY } from '../utils/tours/recipesTour';
import { startPropertyScenarioTour, TOUR_KEY as PROPERTY_SCENARIO_TOUR_KEY } from '../utils/tours/propertyScenarioTour';
import ConfirmModal from '../components/ConfirmModal';
import UsersAdminPanel from '../components/UsersAdminPanel';
import { DEFAULT_TILES, DEFAULT_NAV_ITEMS, mergeWithDefaults } from '../utils/mobileConfig';
import { DEFAULT_FEATURE_ACCESS, FEATURE_ACCESS_GROUPS } from '../utils/featureAccess';
import { LOCAL_CLONE_VOICE_URI } from '../hooks/useVoice';

const AUDIO_VOICE_SETTING_KEY = 'audio_voice_uri';
const AUDIO_VOICE_STORAGE_KEY = 'vault:chat:selected-voice-uri';

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
  const [digestTime,        setDigestTime]        = useState('07:00');
  const [digestDays,        setDigestDays]        = useState([0, 1, 2, 3, 4, 5, 6]);
  const [digestSources,     setDigestSources]     = useState(DEFAULT_DIGEST_SOURCES);
  const [digestSaved,       setDigestSaved]       = useState(false);
  const [newFeedName,   setNewFeedName]   = useState('');
  const [newFeedUrl,    setNewFeedUrl]    = useState('');

  const BUDGET_PRESETS = [0.10, 0.25, 0.50, 1.00, 5.00];
  const { token, user } = useAuthStore();
  const getIcon = useIcon();

  const [profileName,     setProfileName]     = useState('');
  const [profileCity,     setProfileCity]     = useState('');
  const [profileState,    setProfileState]    = useState('');
  const [profileCountry,  setProfileCountry]  = useState('');
  const [profileTimezone, setProfileTimezone] = useState('');
  const [audioVoices, setAudioVoices] = useState([]);
  const [audioVoiceURI, setAudioVoiceURI] = useState('');
  const [previewingVoiceURI, setPreviewingVoiceURI] = useState('');
  const voicePreviewRef = useRef(null);
  const [localVoiceStatus, setLocalVoiceStatus] = useState(null);
  const [localVoiceAvailable, setLocalVoiceAvailable] = useState(false);
  const [localVoiceRefText, setLocalVoiceRefText] = useState('');
  const [localVoiceFile, setLocalVoiceFile] = useState(null);
  const [localVoiceSaving, setLocalVoiceSaving] = useState(false);
  const [localVoiceMessage, setLocalVoiceMessage] = useState('');

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwStatus, setPwStatus] = useState(null);
  const [fileTypesSaved, setFileTypesSaved] = useState(false);
  const [showPwFields, setShowPwFields] = useState({ current: false, next: false, confirm: false });
  const [modelStatus, setModelStatus] = useState(null);
  const modelFormCardRef = useRef(null);
  const modelIdInputRef = useRef(null);
  const {
    models,
    setModels,
    saveModels,
    defaultModel,
    saveDefaultModel,
    branchEvalModel,
    saveBranchEvalModel,
    graphicsModel,
    saveGraphicsModel,
    embeddingModel,
    saveEmbeddingModel,
    embeddingConfig,
    documentRedactionLocalModel,
    documentRedactionFrontierModel,
    saveDocumentRedactionLocalModel,
    saveDocumentRedactionFrontierModel,
    translateModel,
    translateReviewModel,
    saveTranslateModel,
    saveTranslateReviewModel,
    translateTargetLanguage,
    saveTranslateTargetLanguage,
    reload: reloadModels,
  } = useModels();
  // Admin-only display order for the Translate agent's target-language dropdown. Defaults to
  // the base LANGUAGES order until an admin saves a custom one (translate_language_order).
  const [translateLanguageOrder, setTranslateLanguageOrder] = useState(TRANSLATE_LANGUAGES);
  const [savingLanguageOrder, setSavingLanguageOrder] = useState(false);
  const [editingModel, setEditingModel] = useState(null); // model object being edited, or 'new'
  const [modelForm, setModelForm] = useState({});
  const [modelInventoryError, setModelInventoryError] = useState('');
  const [modelInventorySaving, setModelInventorySaving] = useState(false);
  const [modelInventoryDirty, setModelInventoryDirty] = useState(false);
  const [docRedactionSlotError, setDocRedactionSlotError] = useState('');
  const [showReopenWizardConfirm, setShowReopenWizardConfirm] = useState(false);
  const [showResetGoalsConfirm, setShowResetGoalsConfirm] = useState(false);
  const [tab, setTab] = useState(() => {
    const saved = localStorage.getItem('settingsTab') || 'Appearance';
    return saved === 'Product Scout' ? 'Amazon Search' : saved;
  });
  const [missionReviewFreq, setMissionReviewFreq] = useState('off');
  const [missionLastReviewed, setMissionLastReviewed] = useState(null);
  const [missionSnoozedUntil, setMissionSnoozedUntil] = useState(null);

  // Inbox Intel settings
  const [gmailIntelRefreshInterval, setGmailIntelRefreshInterval] = useState('10');
  const [gmailIntelEmailCount, setGmailIntelEmailCount]           = useState('100');
  const [gmailPdfModel, setGmailPdfModel]                         = useState('');

  // Shares alerts
  const [sharesDropAlertPct, setSharesDropAlertPct] = useState('0');

  // Amazon Search
  const [productScoutAmazonDomain, setProductScoutAmazonDomain] = useState('amazon.com.au');
  const [productScoutAmazonSaved, setProductScoutAmazonSaved] = useState(false);
  const [productScoutMarketplaces, setProductScoutMarketplaces] = useState([]);
  const [productScoutDomainFromEnv, setProductScoutDomainFromEnv] = useState(false);

  const [mobileTiles, setMobileTiles] = useState(() => DEFAULT_TILES.map(t => ({ ...t })));
  const [mobileNavItems, setMobileNavItems] = useState(() => DEFAULT_NAV_ITEMS.map(i => ({ ...i })));
  const [mobileSaved, setMobileSaved] = useState(false);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [featureAccessSaved, setFeatureAccessSaved] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState(null);
  const [contentRestrictions, setContentRestrictions] = useState([]);
  const [contentRestrictionsSaved, setContentRestrictionsSaved] = useState(false);
  const [wellbeingInviteSubject, setWellbeingInviteSubject] = useState('');
  const [wellbeingInviteBody, setWellbeingInviteBody] = useState('');
  const [wellbeingInvitePlaceholders, setWellbeingInvitePlaceholders] = useState(['{{link}}', '{{email}}']);
  const [wellbeingInviteSaved, setWellbeingInviteSaved] = useState(false);
  const [wellbeingInviteError, setWellbeingInviteError] = useState('');
  const [toolMaintenancePlan, setToolMaintenancePlan] = useState(null);
  const [toolMaintenanceLoading, setToolMaintenanceLoading] = useState(false);
  const [toolMaintenanceError, setToolMaintenanceError] = useState('');
  const [themeBuilderDesignModel, setThemeBuilderDesignModel] = useState('');
  const [themeBuilderDesignMeta, setThemeBuilderDesignMeta] = useState(null);
  const [themeBuilderDesignSaved, setThemeBuilderDesignSaved] = useState(false);

  const TABS = user?.isAdmin
    ? [
        'Appearance',
        'Profile',
        'AI & Chat',
        'Tasks',
        'Goals',
        'Integrations',
        'News Digest',
        'Shares',
        'Amazon Search',
        'Mobile',
        'Members',
        'Feature Access',
        'Wellbeing Invites',
        'Content Restrictions',
        'Tool Maintenance',
        'Environment',
        'Tours',
      ]
    : ['Appearance', 'Profile', 'Tasks'];

  function selectTab(t) {
    setTab(t);
    localStorage.setItem('settingsTab', t);
  }

  useEffect(() => {
    const allowedTabs = user?.isAdmin
      ? [
          'Appearance',
          'Profile',
          'AI & Chat',
          'Tasks',
          'Goals',
          'Integrations',
          'News Digest',
          'Shares',
          'Amazon Search',
          'Mobile',
          'Members',
          'Feature Access',
          'Wellbeing Invites',
          'Content Restrictions',
          'Tool Maintenance',
          'Environment',
          'Tours',
        ]
      : ['Appearance', 'Profile', 'Tasks'];
    if (!allowedTabs.includes(tab)) {
      setTab('Appearance');
      localStorage.setItem('settingsTab', 'Appearance');
    }
  }, [tab, user?.isAdmin]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;

    const loadVoices = () => {
      setAudioVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === loadVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  function previewAudioVoice(voice = null) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const previewId = voice?.voiceURI || '__default__';
    if (previewingVoiceURI === previewId) {
      window.speechSynthesis.cancel();
      setPreviewingVoiceURI('');
      voicePreviewRef.current = null;
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('This is a preview of this chat audio voice.');
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.pitch = 1;
    voicePreviewRef.current = utterance;
    setPreviewingVoiceURI(previewId);
    utterance.onend = () => {
      if (voicePreviewRef.current === utterance) {
        setPreviewingVoiceURI('');
        voicePreviewRef.current = null;
      }
    };
    utterance.onerror = utterance.onend;
    window.speechSynthesis.speak(utterance);
  }

  function saveAudioVoice(voiceURI) {
    const next = voiceURI || '';
    setAudioVoiceURI(next);
    try {
      if (next) window.localStorage.setItem(AUDIO_VOICE_STORAGE_KEY, next);
      else window.localStorage.removeItem(AUDIO_VOICE_STORAGE_KEY);
    } catch {
      /* browser storage may be unavailable */
    }
    api.post('/api/settings', { key: AUDIO_VOICE_SETTING_KEY, value: next }).catch(() => {});
  }

  async function saveLocalVoiceProfile() {
    setLocalVoiceSaving(true);
    setLocalVoiceMessage('');
    try {
      const formData = new FormData();
      if (localVoiceFile) formData.append('audio', localVoiceFile);
      if (localVoiceRefText.trim()) formData.append('refText', localVoiceRefText.trim());
      const res = await api.postForm('/api/local-audio/tts/profile', formData);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save local voice profile');
      setLocalVoiceStatus(data);
      setLocalVoiceFile(null);
      setLocalVoiceMessage('Local voice profile saved. Select "My voice (local clone)" in Chat.');
      saveAudioVoice(LOCAL_CLONE_VOICE_URI);
    } catch (err) {
      setLocalVoiceMessage(err.message || 'Could not save local voice profile');
    } finally {
      setLocalVoiceSaving(false);
    }
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
      if (data.user_name)     setProfileName(data.user_name);
      if (data.user_city)     setProfileCity(data.user_city);
      if (data.user_state)    setProfileState(data.user_state);
      if (data.user_country)  setProfileCountry(data.user_country);
      if (data.user_timezone) setProfileTimezone(data.user_timezone);
      if (data[AUDIO_VOICE_SETTING_KEY]) setAudioVoiceURI(data[AUDIO_VOICE_SETTING_KEY]);
      if (data.inquiry_reminder_frequency) setInquiryFrequency(data.inquiry_reminder_frequency);
      if (data.inquiry_reminder_time)      setInquiryTime(data.inquiry_reminder_time);
      if (data.inquiry_reminder_days)      { try { setInquiryDays(JSON.parse(data.inquiry_reminder_days)); } catch {} }
      if (data.mission_review_frequency)   setMissionReviewFreq(data.mission_review_frequency);
      setMissionLastReviewed(data.mission_last_reviewed_at || null);
      setMissionSnoozedUntil(data.mission_review_snoozed_until || null);
      if (data.gmail_intel_refresh_interval) setGmailIntelRefreshInterval(data.gmail_intel_refresh_interval);
      if (data.gmail_intel_email_count)      setGmailIntelEmailCount(data.gmail_intel_email_count);
      if (data.gmail_pdf_model)              setGmailPdfModel(data.gmail_pdf_model);
      if (data.shares_daily_drop_alert_pct != null) setSharesDropAlertPct(String(data.shares_daily_drop_alert_pct));
      if (data.translate_language_order) {
        try {
          const parsed = JSON.parse(data.translate_language_order);
          if (Array.isArray(parsed) && parsed.length) setTranslateLanguageOrder(orderLanguages(parsed));
        } catch {}
      }
    }).catch(() => {});

    api.get('/api/settings/mobile').then(r => r.json()).then(data => {
      if (data.mobile_dashboard_tiles) {
        try { setMobileTiles(mergeWithDefaults(JSON.parse(data.mobile_dashboard_tiles), DEFAULT_TILES)); } catch {}
      }
      if (data.mobile_nav_items) {
        try { setMobileNavItems(mergeWithDefaults(JSON.parse(data.mobile_nav_items), DEFAULT_NAV_ITEMS)); } catch {}
      }
    }).catch(() => {});

    api.get('/api/product-scout/settings').then(r => r.json()).then((data) => {
      if (data?.amazonDomain) setProductScoutAmazonDomain(data.amazonDomain);
      if (Array.isArray(data?.marketplaces)) setProductScoutMarketplaces(data.marketplaces);
      if (data?.amazonDomainFromEnv) setProductScoutDomainFromEnv(true);
    }).catch(() => {});

    api.get('/api/news-digest/settings').then(r => r.json()).then(data => {
      if (data.time)    setDigestTime(data.time);
      if (data.days)    setDigestDays(data.days);
      if (data.sources) setDigestSources(data.sources);
    }).catch(() => {});


    api.get('/api/settings/feature-access').then(r => r.json()).then(data => {
      if (data?.flags && typeof data.flags === 'object') {
        setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
      }
    }).catch(() => {});

    api.get('/api/settings/content-restrictions').then(r => r.json()).then(data => {
      if (Array.isArray(data?.restrictions)) {
        setContentRestrictions(data.restrictions.length ? data.restrictions : ['']);
      }
    }).catch(() => {});

    api.get('/api/settings/wellbeing-invite-template').then(r => r.json()).then(data => {
      if (data?.subject) setWellbeingInviteSubject(data.subject);
      if (data?.body) setWellbeingInviteBody(data.body);
      if (Array.isArray(data?.placeholders)) setWellbeingInvitePlaceholders(data.placeholders);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user?.isAdmin) return;
    api.get('/api/settings/runtime')
      .then(r => r.json())
      .then(setRuntimeInfo)
      .catch(() => {});
    api.get('/api/settings/theme-builder-design-model')
      .then(r => r.json())
      .then((data) => {
        setThemeBuilderDesignModel(data.model || '');
        setThemeBuilderDesignMeta(data);
      })
      .catch(() => {});
  }, [user?.isAdmin]);

  useEffect(() => {
    api.get('/api/local-audio/tts/status')
      .then(async (r) => {
        if (!r.ok) {
          setLocalVoiceAvailable(false);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        if (data.localOnly) {
          setLocalVoiceAvailable(false);
          return;
        }
        setLocalVoiceAvailable(true);
        setLocalVoiceStatus(data);
        if (data?.refText) setLocalVoiceRefText(data.refText);
        else if (data?.refTextPreview) setLocalVoiceRefText(data.refTextPreview);
      })
      .catch(() => setLocalVoiceAvailable(false));
  }, []);

  const EMPTY_MODEL = {
    emoji: '🤖', name: '', label: '', id: '', provider: 'anthropic', tagline: '', desc: '',
  };

  function focusModelFormCard() {
    requestAnimationFrame(() => {
      modelFormCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        modelIdInputRef.current?.focus({ preventScroll: true });
      }, 280);
    });
  }

  function openAdd() {
    setModelForm(EMPTY_MODEL);
    setEditingModel('new');
    setModelInventoryError('');
  }
  function openEdit(m) {
    setModelForm({ ...m });
    setEditingModel(m.id);
    setModelInventoryError('');
  }
  function cancelEdit() { setEditingModel(null); setModelForm({}); }

  useEffect(() => {
    if (!editingModel) return undefined;
    focusModelFormCard();
    return undefined;
  }, [editingModel]);

  async function persistModelInventory(nextModels) {
    setModelInventorySaving(true);
    setModelInventoryError('');
    try {
      // Drop legacy Local/Hosted designation if present on older inventory rows.
      const cleaned = (nextModels || []).map(({ execution: _ignored, ...rest }) => rest);
      await saveModels(cleaned);
      setModelInventoryDirty(false);
    } catch (err) {
      setModelInventoryError(err.message || 'Could not save model inventory');
      throw err;
    } finally {
      setModelInventorySaving(false);
    }
  }

  async function saveModel() {
    if (!modelForm.id.trim() || !modelForm.name.trim()) return;
    let updated;
    if (editingModel === 'new') {
      updated = [...models, { ...modelForm, id: modelForm.id.trim() }];
    } else {
      updated = models.map((m) => (
        m.id === editingModel
          ? { ...modelForm, id: modelForm.id.trim() }
          : m
      ));
    }
    try {
      await persistModelInventory(updated);
      if (modelForm.provider === 'serper' || modelForm.provider === 'serpapi') {
        await api.post('/api/settings', { key: 'shopping_search_provider', value: modelForm.provider }).catch(() => {});
      }
      cancelEdit();
    } catch {
      /* error already set */
    }
  }

  async function deleteModel(id) {
    const next = models.filter((m) => m.id !== id);
    setModels(next);
    setModelInventoryDirty(true);
    try {
      await persistModelInventory(next);
    } catch {
      /* error already set */
    }
  }

  async function resetModels() {
    // Discard local draft and reload saved inventory — never inject a hardcoded catalog.
    setModelInventoryError('');
    setModelInventoryDirty(false);
    cancelEdit();
    await reloadModels();
  }


  async function saveInventoryAfterConfirm() {
    try {
      await persistModelInventory(models);
    } catch {
      /* error already set */
    }
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
      // silent
    }
  }

  function updateContentRestriction(index, value) {
    setContentRestrictions(prev => prev.map((item, i) => (i === index ? value : item)));
  }

  function addContentRestriction() {
    setContentRestrictions(prev => [...prev, '']);
  }

  function removeContentRestriction(index) {
    setContentRestrictions(prev => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [''];
    });
  }

  async function saveContentRestrictions() {
    const restrictions = contentRestrictions
      .map(item => item.trim())
      .filter(Boolean);
    const res = await api.post('/api/settings/content-restrictions', { restrictions }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => ({ restrictions }));
      setContentRestrictions(data.restrictions?.length ? data.restrictions : ['']);
      setContentRestrictionsSaved(true);
      setTimeout(() => setContentRestrictionsSaved(false), 2000);
    }
  }

  async function saveWellbeingInviteTemplate() {
    setWellbeingInviteError('');
    const res = await api.post('/api/settings/wellbeing-invite-template', {
      subject: wellbeingInviteSubject,
      body: wellbeingInviteBody,
    }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json?.().catch(() => ({}));
      setWellbeingInviteError(data?.error || 'Could not save wellbeing invite template');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.subject) setWellbeingInviteSubject(data.subject);
    if (data.body) setWellbeingInviteBody(data.body);
    setWellbeingInviteSaved(true);
    setTimeout(() => setWellbeingInviteSaved(false), 2000);
  }

  async function readToolMaintenanceJson(res, fallbackMessage) {
    const text = await res.text();
    if (!text.trim()) {
      throw new Error(`${fallbackMessage}. The server returned an empty response; restart the dev server if this was after a recent code change.`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${fallbackMessage}. The server returned a non-JSON response.`);
    }
  }

  async function saveThemeBuilderDesignModel(model) {
    setThemeBuilderDesignSaved(false);
    const res = await api.post('/api/settings/theme-builder-design-model', { model }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setThemeBuilderDesignModel(data.model || '');
    setThemeBuilderDesignMeta((prev) => ({
      ...(prev || {}),
      model: data.model || '',
      effectiveModel: data.effectiveModel,
      source: data.source,
    }));
    setThemeBuilderDesignSaved(true);
    setTimeout(() => setThemeBuilderDesignSaved(false), 2000);
  }

  async function scanToolMaintenance() {
    setToolMaintenanceLoading(true);
    setToolMaintenanceError('');
    try {
      const res = await api.get('/api/settings/tool-maintenance/scan');
      const data = await readToolMaintenanceJson(res, 'Could not scan local tools');
      if (!res.ok) throw new Error(data.error || 'Could not scan local tools');
      setToolMaintenancePlan(data);
    } catch (err) {
      setToolMaintenanceError(err.message || 'Could not scan local tools');
    } finally {
      setToolMaintenanceLoading(false);
    }
  }

  function toolMaintenanceItemDetail(item) {
    if (item?.willUpdate) {
      return item.latest ? `Available: ${item.latest}` : (item.status || 'Update available');
    }
    return item?.status || 'No update reported';
  }

  const runtimeRows = runtimeInfo ? [
    ['Application environment', runtimeInfo.appEnv || 'unknown'],
    ['Database source', runtimeInfo.databaseUrlSource || 'not configured'],
    ['Database URL', runtimeInfo.safeDatabaseUrl || 'not configured'],
    ['App URL', runtimeInfo.appUrl || 'not configured'],
    ['Model provider', runtimeInfo.modelProvider || 'not configured'],
    ['Ollama base URL', runtimeInfo.ollamaBaseUrl || 'not configured'],
    ['Default local model', runtimeInfo.defaultLocalModel || 'not configured'],
    ['Image provider', runtimeInfo.imageProvider || 'not configured'],
    ['Local image API URL', runtimeInfo.localImageApiUrl || 'not configured'],
    ['Local image model', runtimeInfo.localImageModel || 'not configured'],
  ] : [];

  const safetyRows = runtimeInfo ? [
    ['Email disabled', runtimeInfo.disableEmail],
    ['External cron disabled', runtimeInfo.disableExternalCron],
    ['Web search disabled', runtimeInfo.disableWebSearch],
  ] : [];

  const NON_CHAT_PROVIDERS = ['fal', 'seedance', 'serper', 'serpapi'];
  const textModelChoices = models.filter(m => !NON_CHAT_PROVIDERS.includes(m.provider));
  const graphicsModelChoices = models.filter(m => m.provider === 'fal');
  const graphicsModelOptions = graphicsModel && !graphicsModelChoices.some(m => m.id === graphicsModel)
    ? [{ id: graphicsModel, name: graphicsModel, emoji: '🎨', provider: 'fal' }, ...graphicsModelChoices]
    : graphicsModelChoices;


  function modelProviderStatusKey(provider) {
    if (provider === 'serpapi') return 'search';
    return provider;
  }

  function modelProviderKeyHint(provider) {
    if (provider === 'gemini') return 'GEMINI_API_KEY not set';
    if (provider === 'deepseek') return 'DEEPSEEK_API_KEY not set';
    if (provider === 'ollama') return 'Ollama local server unavailable';
    if (provider === 'fal') return 'FAL_API_KEY not set';
    if (provider === 'serper') return 'SERPER_SEARCH_API_KEY not set';
    if (provider === 'serpapi') return 'SEARCH_API_KEY not set (SerpAPI)';
    return 'ANTHROPIC_API_KEY not set';
  }

  return (
    <div className={((['Members', 'Environment', 'Wellbeing Invites', 'Tool Maintenance'].includes(tab)) && user?.isAdmin ? 'max-w-4xl' : 'max-w-2xl') + ' mx-auto p-6'}>
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
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Timezone</label>
            <select
              value={profileTimezone}
              onChange={e => {
                setProfileTimezone(e.target.value);
                api.post('/api/settings', { key: 'user_timezone', value: e.target.value }).catch(() => {});
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Select timezone…</option>
              <optgroup label="Australia">
                <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
                <option value="Australia/Melbourne">Australia/Melbourne (AEST/AEDT)</option>
                <option value="Australia/Brisbane">Australia/Brisbane (AEST)</option>
                <option value="Australia/Adelaide">Australia/Adelaide (ACST/ACDT)</option>
                <option value="Australia/Perth">Australia/Perth (AWST)</option>
                <option value="Australia/Darwin">Australia/Darwin (ACST)</option>
                <option value="Australia/Hobart">Australia/Hobart (AEST/AEDT)</option>
              </optgroup>
              <optgroup label="Pacific">
                <option value="Pacific/Auckland">Pacific/Auckland (NZST/NZDT)</option>
              </optgroup>
              <optgroup label="Asia">
                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong (HKT)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              </optgroup>
              <optgroup label="Europe">
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
              </optgroup>
              <optgroup label="Americas">
                <option value="America/New_York">America/New_York (ET)</option>
                <option value="America/Chicago">America/Chicago (CT)</option>
                <option value="America/Denver">America/Denver (MT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
                <option value="America/Toronto">America/Toronto (ET)</option>
                <option value="America/Vancouver">America/Vancouver (PT)</option>
              </optgroup>
              <optgroup label="Other">
                <option value="UTC">UTC</option>
              </optgroup>
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              Used by automated schedules (news, shares). Admin's timezone is the system default.
            </p>
          </div>
          {localVoiceAvailable && (
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>My cloned voice (F5-TTS)</label>
              <div className="rounded-lg border p-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  This is separate from the Mac/browser voice list below. Upload a 20–30 second recording of your voice here first, then choose <strong>My voice (local clone)</strong> in Chat.
                </p>
                <p className="text-xs" style={{ color: localVoiceStatus?.configured ? '#166534' : '#b45309' }}>
                  {localVoiceStatus?.configured
                    ? 'Voice profile ready.'
                    : 'Not set up yet — upload a recording below.'}
                </p>
                <label className="block">
                  <span className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Reference recording</span>
                  <input
                    type="file"
                    accept="audio/*,.m4a,.wav,.mp3,.webm"
                    onChange={(e) => setLocalVoiceFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>What you said in the recording</span>
                  <textarea
                    value={localVoiceRefText}
                    onChange={(e) => setLocalVoiceRefText(e.target.value)}
                    rows={4}
                    placeholder="Paste the exact words spoken, or leave blank when uploading new audio to auto-transcribe."
                    className="w-full px-3 py-2 rounded-xl border text-sm outline-none resize-y"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </label>
                {localVoiceMessage && (
                  <p className="text-xs" style={{ color: localVoiceMessage.includes('saved') ? '#166534' : '#dc2626' }}>
                    {localVoiceMessage}
                  </p>
                )}
                <button
                  type="button"
                  onClick={saveLocalVoiceProfile}
                  disabled={localVoiceSaving || (!localVoiceFile && !localVoiceStatus?.refAudioExists)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {localVoiceSaving ? 'Saving…' : 'Save my cloned voice'}
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Mac / browser voices (fallback)</label>
            <div
              className="rounded-lg border overflow-hidden"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div className="flex items-center gap-3 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  type="button"
                  onClick={() => previewAudioVoice(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border transition-opacity hover:opacity-75"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}
                  title={previewingVoiceURI === '__default__' ? 'Stop preview' : 'Preview system default voice'}
                >
                  {getIcon(previewingVoiceURI === '__default__' ? 'square' : 'play', { size: 13 })}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: !audioVoiceURI ? 'var(--color-primary)' : 'var(--color-text)' }}>
                    System default voice
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Use the browser/device default voice</p>
                </div>
                <button
                  type="button"
                  onClick={() => saveAudioVoice('')}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-opacity hover:opacity-75"
                  style={{
                    borderColor: !audioVoiceURI ? 'var(--color-primary)' : 'var(--color-border)',
                    color: !audioVoiceURI ? 'var(--color-primary)' : 'var(--color-muted)',
                    background: !audioVoiceURI ? 'var(--color-primary)10' : 'var(--color-bg)',
                  }}
                >
                  {!audioVoiceURI ? 'Selected' : 'Use'}
                </button>
              </div>
              {localVoiceAvailable && (
                <div className="flex items-center gap-3 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <div className="w-8 h-8 flex items-center justify-center rounded-lg border text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>★</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: audioVoiceURI === LOCAL_CLONE_VOICE_URI ? 'var(--color-primary)' : 'var(--color-text)' }}>
                      My voice (local clone)
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {localVoiceStatus?.configured ? 'F5-TTS · configured above' : 'Set up in the section above first'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => saveAudioVoice(LOCAL_CLONE_VOICE_URI)}
                    disabled={!localVoiceStatus?.configured}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-opacity hover:opacity-75 disabled:opacity-40"
                    style={{
                      borderColor: audioVoiceURI === LOCAL_CLONE_VOICE_URI ? 'var(--color-primary)' : 'var(--color-border)',
                      color: audioVoiceURI === LOCAL_CLONE_VOICE_URI ? 'var(--color-primary)' : 'var(--color-muted)',
                      background: audioVoiceURI === LOCAL_CLONE_VOICE_URI ? 'var(--color-primary)10' : 'var(--color-surface)',
                    }}
                  >
                    {audioVoiceURI === LOCAL_CLONE_VOICE_URI ? 'Selected' : 'Use'}
                  </button>
                </div>
              )}
              <div className="max-h-72 overflow-y-auto">
                {audioVoices.map((voice) => {
                  const selected = audioVoiceURI === voice.voiceURI;
                  const previewing = previewingVoiceURI === voice.voiceURI;
                  return (
                    <div
                      key={voice.voiceURI}
                      className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0"
                      style={{ borderColor: 'var(--color-border)' }}
                    >
                      <button
                        type="button"
                        onClick={() => previewAudioVoice(voice)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border transition-opacity hover:opacity-75"
                        style={{ borderColor: 'var(--color-border)', color: previewing ? 'var(--color-primary)' : 'var(--color-muted)', background: 'var(--color-bg)' }}
                        title={previewing ? 'Stop preview' : `Preview ${voice.name}`}
                      >
                        {getIcon(previewing ? 'square' : 'play', { size: 13 })}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: selected ? 'var(--color-primary)' : 'var(--color-text)' }}>
                          {voice.name}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {voice.lang}{voice.localService ? ' - local/offline capable' : ' - browser/network voice'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => saveAudioVoice(voice.voiceURI)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-opacity hover:opacity-75"
                        style={{
                          borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                          color: selected ? 'var(--color-primary)' : 'var(--color-muted)',
                          background: selected ? 'var(--color-primary)10' : 'var(--color-bg)',
                        }}
                      >
                        {selected ? 'Selected' : 'Use'}
                      </button>
                    </div>
                  );
                })}
                {audioVoices.length === 0 && (
                  <p className="px-3 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                    No browser voices reported yet. Try refreshing after the page loads.
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              Only used when you pick a Mac/browser voice. For your own cloned voice, use the F5-TTS section above.
            </p>
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
              title="Reload saved inventory from the server"
            >
              Reload inventory
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
          Manage your model inventory, then assign models on the agent cards below. Dropdowns only list models you have configured.
        </p>

        {(modelInventoryError || modelInventoryDirty) && (
          <div
            className="mb-4 p-4 rounded-xl border space-y-3"
            style={{ background: '#FFFBEB', borderColor: '#F59E0B' }}
          >
            {modelInventoryError && (
              <p className="text-xs" style={{ color: '#b45309' }}>{modelInventoryError}</p>
            )}
            {modelInventoryDirty && !modelInventoryError && (
              <p className="text-xs" style={{ color: '#92400e' }}>
                Inventory updated locally — Save inventory to persist.
              </p>
            )}
            <button
              type="button"
              onClick={saveInventoryAfterConfirm}
              disabled={modelInventorySaving || !modelInventoryDirty}
              className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
              title="Save model inventory"
            >
              {modelInventorySaving ? 'Saving…' : 'Save inventory'}
            </button>
          </div>
        )}

        {/* Add / Edit form — placed near "+ Add model" so it scrolls into focus immediately */}
        {editingModel && (
          <div
            ref={modelFormCardRef}
            className="rounded-xl border p-4 mb-4 space-y-3"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
              {editingModel === 'new' ? 'Add model' : 'Edit model'}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Provider</label>
                <select
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  value={modelForm.provider}
                  onChange={(e) => setModelForm((f) => ({ ...f, provider: e.target.value }))}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="ollama">Ollama local</option>
                  <option value="fal">FAL</option>
                  <option value="serper">Serper (Google Shopping)</option>
                  <option value="serpapi">SerpAPI (Google Shopping)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Model API ID *</label>
                <input
                  ref={modelIdInputRef}
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none font-mono"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="Exact provider model id"
                  value={modelForm.id}
                  onChange={e => setModelForm(f => ({ ...f, id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Display name *</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="Display name"
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
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Emoji</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="⚡"
                  value={modelForm.emoji}
                  onChange={e => setModelForm(f => ({ ...f, emoji: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
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

        {/* Default model selector */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Default model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Used for general chat and as the default for new projects when you can pick a model. Clearing the selection removes the explicit default so the first entry in your configured model list is used (same rules as the server model resolver).
          </p>
          <select
            value={defaultModel}
            onChange={e => saveDefaultModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="">No default selected</option>
            {textModelChoices.map(m => (
              <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
            ))}
          </select>
        </div>

        {/* Branch evaluation model selector */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Branch evaluation model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Used to evaluate whether a response warrants branch suggestions. Set to a capable model — flash/economy models will not trigger branches.
          </p>
          <select
            value={branchEvalModel}
            onChange={e => saveBranchEvalModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="">Use current chat model</option>
            {textModelChoices.map(m => (
              <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
            ))}
          </select>
        </div>

        {/* Document redaction agent — two model slots */}
        <div className="mb-4 p-4 rounded-xl border space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
              Document redaction agent
            </label>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Pick any models from your inventory. <strong style={{ color: 'var(--color-text)' }}>Candidate / apply</strong> runs extract,
              resuggest, coherence, and Realistic synthetics — DeepSeek (or any connected model) is fine here and explains long waits if Fast extract is off.
              <strong style={{ color: 'var(--color-text)' }}> Residual-risk / frontier</strong> only sees the sanitized PDF after local apply.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Candidate / apply model
            </label>
            <select
              value={documentRedactionLocalModel}
              onChange={async (e) => {
                setDocRedactionSlotError('');
                try {
                  await saveDocumentRedactionLocalModel(e.target.value);
                } catch (err) {
                  setDocRedactionSlotError(err.message || 'Could not save model');
                }
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Select model…</option>
              {textModelChoices.map((m) => (
                <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Residual-risk / frontier model
            </label>
            <select
              value={documentRedactionFrontierModel}
              onChange={async (e) => {
                setDocRedactionSlotError('');
                try {
                  await saveDocumentRedactionFrontierModel(e.target.value);
                } catch (err) {
                  setDocRedactionSlotError(err.message || 'Could not save model');
                }
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Select model…</option>
              {textModelChoices.map((m) => (
                <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
              ))}
            </select>
          </div>

          {docRedactionSlotError && (
            <p className="text-xs" style={{ color: '#b45309' }}>{docRedactionSlotError}</p>
          )}
        </div>

        {/* Translate agent — translate + review model slots */}
        <div className="mb-4 p-4 rounded-xl border space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
              Translate agent
            </label>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <strong style={{ color: 'var(--color-text)' }}>Translate</strong> does glossary prep and the document translation.
              <strong style={{ color: 'var(--color-text)' }}> Review</strong> runs the QA pass (polarity, terminology, auditor flags).
              Leave blank to use your vault default model and a different secondary tier when available.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Target language
            </label>
            <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>
              Default target language for new translation jobs — the job intake dropdown can still override it for a one-off document.
            </p>
            <select
              value={translateTargetLanguage}
              onChange={async (e) => {
                try { await saveTranslateTargetLanguage(e.target.value); }
                catch (err) { /* ignore */ }
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {translateLanguageOrder.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>

          {user?.isAdmin && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                Language dropdown order
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
                Order the choices shown in every target-language dropdown (job intake and this setting) — for every member, not just you.
              </p>
              <div className="rounded-lg border divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {translateLanguageOrder.map((l, i) => (
                  <div key={l.code} className="flex items-center justify-between px-3 py-1.5 text-sm"
                    style={{ color: 'var(--color-text)' }}>
                    <span>{l.label}</span>
                    <div className="flex gap-1">
                      <button type="button" disabled={i === 0}
                        onClick={() => {
                          const next = [...translateLanguageOrder];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          setTranslateLanguageOrder(next);
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 disabled:opacity-25"
                        style={{ color: 'var(--color-muted)' }} aria-label={`Move ${l.label} up`}>
                        {getIcon('chevron-up', { size: 14 })}
                      </button>
                      <button type="button" disabled={i === translateLanguageOrder.length - 1}
                        onClick={() => {
                          const next = [...translateLanguageOrder];
                          [next[i + 1], next[i]] = [next[i], next[i + 1]];
                          setTranslateLanguageOrder(next);
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 disabled:opacity-25"
                        style={{ color: 'var(--color-muted)' }} aria-label={`Move ${l.label} down`}>
                        {getIcon('chevron-down', { size: 14 })}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" disabled={savingLanguageOrder}
                onClick={async () => {
                  setSavingLanguageOrder(true);
                  try {
                    await api.post('/api/settings', {
                      key: 'translate_language_order',
                      value: JSON.stringify(translateLanguageOrder.map((l) => l.code)),
                    });
                  } finally { setSavingLanguageOrder(false); }
                }}
                className="mt-2 text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {savingLanguageOrder ? 'Saving…' : 'Save order'}
              </button>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Translate model
            </label>
            <select
              value={translateModel}
              onChange={async (e) => {
                try { await saveTranslateModel(e.target.value); }
                catch (err) { /* toast handled elsewhere if needed */ }
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Use vault default / standard tier</option>
              {textModelChoices.map((m) => (
                <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Review model
            </label>
            <select
              value={translateReviewModel}
              onChange={async (e) => {
                try { await saveTranslateReviewModel(e.target.value); }
                catch (err) { /* ignore */ }
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Use vault secondary (or same as translate)</option>
              {textModelChoices.map((m) => (
                <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Theme builder design model */}
        {user?.isAdmin && (
          <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
              Theme builder design model
            </label>
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
              Used for wireframes, homepage design, and structural iterations in WP Theme Builder. CSS-only style tweaks still use your local Qwen model. Leave blank in production to use the default model above; in local dev, set <code>THEME_BUILDER_DEV_DESIGN_MODEL</code> in <code>.env</code> (e.g. <code>ollama:qwen2.5-coder:14b</code>).
            </p>
            <select
              value={themeBuilderDesignModel}
              onChange={(e) => saveThemeBuilderDesignModel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Use default model / local dev env</option>
              {textModelChoices.map(m => (
                <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
              ))}
            </select>
            {themeBuilderDesignMeta?.effectiveModel && (
              <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                Currently resolves to <code>{themeBuilderDesignMeta.effectiveModel}</code>
                {themeBuilderDesignMeta.source ? ` (${themeBuilderDesignMeta.source.replace(/-/g, ' ')})` : ''}
                {themeBuilderDesignMeta.devEnvOverride ? `. Dev env override: ${themeBuilderDesignMeta.devEnvOverride}` : ''}
                {themeBuilderDesignMeta.envOverride ? `. Env override: ${themeBuilderDesignMeta.envOverride}` : ''}
              </p>
            )}
            {themeBuilderDesignSaved && (
              <p className="text-xs mt-2" style={{ color: '#16a34a' }}>Saved</p>
            )}
          </div>
        )}

        {/* Embedding model — memory + file RAG */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Embedding model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Powers semantic memory, file RAG, and related-chat recall. Local Mac testing uses Ollama automatically; production uses Gemini from this setting.
          </p>
          {embeddingConfig?.provider === 'ollama' ? (
            <div className="text-sm space-y-1" style={{ color: 'var(--color-text)' }}>
              <p>
                <strong>Local:</strong> Ollama <code>{embeddingConfig.model}</code>
                {embeddingConfig.available ? ' — connected' : ' — not running'}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Run <code>ollama pull {embeddingConfig.model}</code> if needed. Requires pgvector on Postgres for storage.
              </p>
            </div>
          ) : (
            <>
              <select
                value={embeddingModel || embeddingConfig?.model || 'embedding-001'}
                onChange={(e) => saveEmbeddingModel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {(embeddingConfig?.options || [{ id: 'embedding-001', label: 'Gemini embedding-001' }]).map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs mt-2" style={{ color: embeddingConfig?.available ? 'var(--color-muted)' : '#b45309' }}>
                {embeddingConfig?.available
                  ? `Production: ${embeddingConfig.hint}`
                  : (embeddingConfig?.hint || 'GEMINI_API_KEY required on Railway')}
              </p>
            </>
          )}
        </div>

        {/* Graphics model selector */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Graphics model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Used by the Graphics agent in production. Local development uses `LOCAL_IMAGE_MODEL` from the environment for ComfyUI.
          </p>
          <select
            value={graphicsModel}
            onChange={e => saveGraphicsModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none font-mono"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="">No graphics model selected</option>
            {graphicsModelOptions.map(m => (
              <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
            ))}
          </select>
          <p className="text-[11px] mt-2" style={{ color: 'var(--color-muted)' }}>
            This dropdown lists models configured below with provider `fal`. Leave blank to use the server fallback.
          </p>
          {graphicsModelChoices.length === 0 && (
            <p className="text-[11px] mt-2" style={{ color: '#b45309' }}>
              No FAL models are configured yet. Add one below and choose `FAL` as the provider.
            </p>
          )}
        </div>

        {/* Model list */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {models.map((m, i) => {
            const configured = modelStatus ? modelStatus[modelProviderStatusKey(m.provider)] : null;
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
                    <div className="flex items-center gap-2 flex-wrap">
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
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" title={modelProviderKeyHint(m.provider)} style={{ background: '#fef3c7', color: '#b45309' }}>⚠️ Key missing</span>
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
              No models configured. Add one above.
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
          When the daily digest runs automatically. Uses the timezone set in your Profile.
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

        {/* Inbox Intel settings */}
        <h3 className="text-sm font-semibold mt-8 mb-3" style={{ color: 'var(--color-text)' }}>Inbox Intel</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Auto-refresh interval</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>How often Inbox Intel polls for new emails</p>
            </div>
            <select
              value={gmailIntelRefreshInterval}
              onChange={e => {
                setGmailIntelRefreshInterval(e.target.value);
                api.post('/api/settings', { key: 'gmail_intel_refresh_interval', value: e.target.value }).catch(() => {});
              }}
              className="ml-4 px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="off">Off</option>
              <option value="5">Every 5 min</option>
              <option value="10">Every 10 min</option>
              <option value="15">Every 15 min</option>
              <option value="30">Every 30 min</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Emails to fetch</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Number of inbox threads fetched and classified</p>
            </div>
            <select
              value={gmailIntelEmailCount}
              onChange={e => {
                setGmailIntelEmailCount(e.target.value);
                api.post('/api/settings', { key: 'gmail_intel_email_count', value: e.target.value }).catch(() => {});
              }}
              className="ml-4 px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="25">25 emails</option>
              <option value="50">50 emails</option>
              <option value="100">100 emails</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>PDF invoice model</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Model used to read PDF attachments on invoice emails — must be an Anthropic model</p>
            </div>
            <select
              value={gmailPdfModel}
              onChange={e => {
                setGmailPdfModel(e.target.value);
                api.post('/api/settings', { key: 'gmail_pdf_model', value: e.target.value }).catch(() => {});
              }}
              className="ml-4 px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="">(auto — uses branch eval model if Claude)</option>
              {[
                ...models.filter(m => m.id.startsWith('claude-')),
                ...(branchEvalModel && branchEvalModel.startsWith('claude-') && !models.find(m => m.id === branchEvalModel)
                  ? [{ id: branchEvalModel, name: branchEvalModel }]
                  : []),
              ].map(m => (
                <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
              ))}
            </select>
          </div>
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
                9-step walkthrough of invoices, quotes, expenses, recurring schedules, BAS, double-entry journal, exports, and Monday reminders
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
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Amazon Search Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                6-step tour — search input, value scoring, feature comparison table, cross-market alternatives, history
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(PRODUCT_SCOUT_TOUR_KEY);
                setTimeout(() => startProductScoutTour(navigate), 200);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(PRODUCT_SCOUT_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Recipes Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                7-step tour — leftover recipes, recipe by name, skill levels, live grocery prices, library
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(RECIPES_TOUR_KEY);
                setTimeout(() => startRecipesTour(navigate), 200);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(RECIPES_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Property Scenario Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                8-step tour — NLP parse, pre-extraction, clarifying form, calc results, CDR live rates, T&Cs insights
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(PROPERTY_SCENARIO_TOUR_KEY);
                setTimeout(() => startPropertyScenarioTour(navigate), 200);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              {localStorage.getItem(PROPERTY_SCENARIO_TOUR_KEY) ? 'Retake Tour' : 'Take Tour'}
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

      {tab === 'Shares' && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Daily Drop Alert
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Email the admin address when the portfolio's holdings fall by at least this
          percent versus the previous close, checked on each hourly market poll.
          Set to <strong>0</strong> to email the daily movement after every poll (test mode).
        </p>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Daily drop threshold (%)
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={sharesDropAlertPct}
            onChange={(e) => setSharesDropAlertPct(e.target.value)}
            onBlur={() => {
              const n = Math.min(100, Math.max(0, Number(sharesDropAlertPct) || 0));
              setSharesDropAlertPct(String(n));
              api.post('/api/settings', { key: 'shares_daily_drop_alert_pct', value: String(n) }).catch(() => {});
            }}
            className="w-28 px-3 py-1.5 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {Number(sharesDropAlertPct) > 0
              ? `Alert when holdings drop ${Number(sharesDropAlertPct)}% or more in a day`
              : 'Test mode — email after every poll'}
          </span>
        </div>
      </section>
      )}

      {tab === 'Amazon Search' && (
      <>
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Amazon marketplace
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Which Amazon country Amazon Search uses. Applies to all workspace users.
        </p>
        {productScoutDomainFromEnv && (
          <p className="text-xs mb-3" style={{ color: '#f59e0b' }}>
            Overridden by <strong>AMAZON_DOMAIN</strong> in Railway — remove that env var to use this setting.
          </p>
        )}
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Country
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={productScoutAmazonDomain}
            disabled={productScoutDomainFromEnv}
            onChange={async (e) => {
              const domain = e.target.value;
              setProductScoutAmazonDomain(domain);
              setProductScoutAmazonSaved(false);
              try {
                await api.post('/api/product-scout/settings', { amazonDomain: domain });
                setProductScoutAmazonSaved(true);
                setTimeout(() => setProductScoutAmazonSaved(false), 2000);
              } catch { /* ignore */ }
            }}
            className="px-3 py-1.5 rounded-lg border text-sm outline-none min-w-[200px]"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {(productScoutMarketplaces.length ? productScoutMarketplaces : [{ domain: 'amazon.com.au', label: 'Australia' }]).map((m) => (
              <option key={m.domain} value={m.domain}>{m.label}</option>
            ))}
          </select>
          <span className="text-xs" style={{ color: productScoutAmazonSaved ? '#22c55e' : 'var(--color-muted)' }}>
            {productScoutAmazonSaved ? 'Saved ✓' : productScoutAmazonDomain}
          </span>
        </div>
      </section>
      </>
      )}

      {/* Mobile tab */}
      {tab === 'Mobile' && (
      <>
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
            Dashboard Tiles
          </h2>
          <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
            Choose which tiles appear on the mobile dashboard for everyone. Member access is still controlled by Feature Access.
          </p>
          <div className="space-y-2">
            {mobileTiles.map((tile, idx) => (
              <div
                key={tile.id}
                className="flex items-center gap-3 p-3 rounded-xl border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', opacity: tile.enabled === false ? 0.5 : 1 }}
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => {
                      if (idx === 0) return;
                      const next = [...mobileTiles];
                      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                      setMobileTiles(next);
                    }}
                    disabled={idx === 0}
                    className="w-5 h-5 flex items-center justify-center rounded text-xs hover:opacity-60 disabled:opacity-20 transition-opacity"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => {
                      if (idx === mobileTiles.length - 1) return;
                      const next = [...mobileTiles];
                      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                      setMobileTiles(next);
                    }}
                    disabled={idx === mobileTiles.length - 1}
                    className="w-5 h-5 flex items-center justify-center rounded text-xs hover:opacity-60 disabled:opacity-20 transition-opacity"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    ▼
                  </button>
                </div>
                <span className="flex-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {tile.label}
                </span>
                <button
                  onClick={() => {
                    setMobileTiles(prev => prev.map((t, i) => i === idx ? { ...t, enabled: t.enabled === false ? true : false } : t));
                  }}
                  className="text-xs px-3 py-1 rounded-lg border font-medium transition-all hover:opacity-80"
                  style={{
                    borderColor: tile.enabled === false ? 'var(--color-border)' : 'var(--color-primary)',
                    color: tile.enabled === false ? 'var(--color-muted)' : 'var(--color-primary)',
                    background: 'transparent',
                  }}
                >
                  {tile.enabled === false ? 'Off' : 'On'}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
            Navigation Menu
          </h2>
          <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
            Choose which features appear in the mobile navigation dropdown for everyone. Admins always retain access to enabled routes; members also need Feature Access enabled.
          </p>
          <div className="space-y-1.5">
            {mobileNavItems.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', opacity: item.enabled === false ? 0.5 : 1 }}
              >
                <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{item.label}</span>
                <button
                  onClick={() => {
                    setMobileNavItems(prev => prev.map((n, i) => i === idx ? { ...n, enabled: n.enabled === false ? true : false } : n));
                  }}
                  className="text-xs px-3 py-1 rounded-lg border font-medium transition-all hover:opacity-80"
                  style={{
                    borderColor: item.enabled === false ? 'var(--color-border)' : 'var(--color-primary)',
                    color: item.enabled === false ? 'var(--color-muted)' : 'var(--color-primary)',
                    background: 'transparent',
                  }}
                >
                  {item.enabled === false ? 'Off' : 'On'}
                </button>
              </div>
            ))}
          </div>
        </section>

        <button
          onClick={async () => {
            await api.post('/api/settings/mobile', {
              mobile_dashboard_tiles: mobileTiles,
              mobile_nav_items: mobileNavItems,
            }).catch(() => {});
            setMobileSaved(true);
            setTimeout(() => setMobileSaved(false), 2000);
          }}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: mobileSaved ? '#22c55e' : 'var(--color-primary)' }}
        >
          {mobileSaved ? 'Saved ✓' : 'Save Mobile Settings'}
        </button>
      </>
      )}

      {/* Members (admin) */}
      {tab === 'Members' && user?.isAdmin && (
      <section>
        <UsersAdminPanel />
      </section>
      )}

      {/* Feature Access tab */}
      {tab === 'Feature Access' && user?.isAdmin && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Member Feature Access
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Toggle features for all non-admin member accounts. Admins always retain access.
        </p>

        <div className="space-y-6">
          {FEATURE_ACCESS_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
                {group.label}
              </h3>
              {group.items.map((opt) => {
                const enabled = featureAccess[opt.key] !== false;
                return (
                  <div
                    key={opt.key}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', opacity: enabled ? 1 : 0.55 }}
                  >
                    <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>
                      {opt.label}
                    </span>
                    <button
                      onClick={() => setFeatureAccess((prev) => ({ ...prev, [opt.key]: !enabled }))}
                      className="text-xs px-3 py-1 rounded-lg border font-medium transition-all hover:opacity-80"
                      style={{
                        borderColor: enabled ? 'var(--color-primary)' : 'var(--color-border)',
                        color: enabled ? 'var(--color-primary)' : 'var(--color-muted)',
                        background: 'transparent',
                      }}
                    >
                      {enabled ? 'On' : 'Off'}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <button
          onClick={async () => {
            await api.post('/api/settings/feature-access', { flags: featureAccess }).catch(() => {});
            setFeatureAccessSaved(true);
            setTimeout(() => setFeatureAccessSaved(false), 2000);
          }}
          className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: featureAccessSaved ? '#22c55e' : 'var(--color-primary)' }}
        >
          {featureAccessSaved ? 'Saved ✓' : 'Save Feature Access'}
        </button>
      </section>
      )}

      {/* Wellbeing Invites tab */}
      {tab === 'Wellbeing Invites' && user?.isAdmin && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Wellbeing Invite Email Template
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          This template is used when an admin invites someone to complete the Wellbeing & Personality Checks. The login link takes the participant directly to the wellbeing area after sign-in.
        </p>

        <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Available placeholders</p>
          <div className="flex flex-wrap gap-2">
            {wellbeingInvitePlaceholders.map((placeholder) => (
              <code key={placeholder} className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
                {placeholder}
              </code>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
            Keep these placeholders in the body if you want the email to include the participant's secure setup link and email address.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Email subject</span>
            <input
              type="text"
              value={wellbeingInviteSubject}
              onChange={(e) => setWellbeingInviteSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </label>

          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Email body</span>
            <textarea
              value={wellbeingInviteBody}
              onChange={(e) => setWellbeingInviteBody(e.target.value)}
              rows={22}
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none resize-y"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}
            />
          </label>
        </div>

        {wellbeingInviteError && (
          <p className="text-sm mt-3" style={{ color: '#dc2626' }}>{wellbeingInviteError}</p>
        )}

        <button
          type="button"
          onClick={saveWellbeingInviteTemplate}
          className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: wellbeingInviteSaved ? '#22c55e' : 'var(--color-primary)' }}
        >
          {wellbeingInviteSaved ? 'Saved ✓' : 'Save Wellbeing Invite Template'}
        </button>
      </section>
      )}

      {/* Content Restrictions tab */}
      {tab === 'Content Restrictions' && user?.isAdmin && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Graphics Content Restrictions
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Add content that graphics generation should avoid. These rows are injected into prompt refinement and the image model's negative prompt.
        </p>

        <div className="space-y-2">
          {(contentRestrictions.length ? contentRestrictions : ['']).map((restriction, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={restriction}
                onChange={e => updateContentRestriction(index, e.target.value)}
                placeholder="e.g. graphic nudity, gore, realistic violence"
                className="flex-1 px-3 py-2 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <button
                type="button"
                onClick={() => removeContentRestriction(index)}
                className="px-3 py-2 rounded-xl border text-xs hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: '#ef4444' }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addContentRestriction}
            className="px-4 py-2 rounded-xl text-sm font-medium border hover:opacity-80"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            + Add restriction
          </button>
          <button
            type="button"
            onClick={saveContentRestrictions}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: contentRestrictionsSaved ? '#22c55e' : 'var(--color-primary)' }}
          >
            {contentRestrictionsSaved ? 'Saved ✓' : 'Save Restrictions'}
          </button>
        </div>

        <p className="text-xs mt-4" style={{ color: 'var(--color-muted)' }}>
          This is prompt-based protection for local image generation. Keep rows short and explicit, such as "graphic nudity" or "gore".
        </p>
      </section>
      )}

      {/* Tool Maintenance tab */}
      {tab === 'Tool Maintenance' && user?.isAdmin && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Tool Update Report
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Review local developer tools that may need attention. This page only scans and lists updates; it does not run system commands.
        </p>

        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Review local tool updates</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Scans Homebrew utilities, Python/pipx packages, local speech model files, and selected Ollama models, then lists suggested manual commands.
              </p>
            </div>
            <button
              type="button"
              onClick={scanToolMaintenance}
              disabled={toolMaintenanceLoading}
              className="px-4 py-2 rounded-xl text-sm font-semibold border disabled:opacity-50 hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-bg)' }}
            >
              {toolMaintenanceLoading ? 'Scanning...' : 'Scan tools'}
            </button>
          </div>

          {toolMaintenanceError && (
            <div className="rounded-xl border p-3 text-sm" style={{ borderColor: '#fecaca', background: '#fff1f2', color: '#991b1b' }}>
              {toolMaintenanceError}
            </div>
          )}

          {toolMaintenancePlan && (
            <div className="space-y-4">
              <div className="rounded-xl border p-3" style={{ borderColor: toolMaintenancePlan.enabled ? '#bbf7d0' : '#f59e0b', background: toolMaintenancePlan.enabled ? '#f0fdf4' : '#fffbeb' }}>
                <p className="text-sm font-semibold" style={{ color: toolMaintenancePlan.enabled ? '#15803d' : '#92400e' }}>
                  Estimated manual update time: {toolMaintenancePlan.estimatedTotal}
                </p>
                <p className="text-xs mt-1" style={{ color: toolMaintenancePlan.enabled ? '#166534' : '#92400e' }}>
                  {toolMaintenancePlan.warning}
                </p>
              </div>

              {toolMaintenancePlan.groups?.map(group => (
                <div key={group.key} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{group.label}</p>
                      <span className="text-xs font-semibold" style={{ color: group.available ? '#15803d' : '#b45309' }}>
                        {group.available
                          ? `${(group.items || []).filter(item => item.willUpdate).length} update${(group.items || []).filter(item => item.willUpdate).length === 1 ? '' : 's'} found`
                          : 'Unavailable'}
                      </span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Estimated manual update time: {group.estimatedMinutes} minutes</p>
                  </div>
                  {group.items?.length ? (
                    <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                      {group.items.slice(0, 18).map(item => (
                        <div key={`${group.key}-${item.name}`} className="grid md:grid-cols-[1.2fr_1fr_1fr] gap-2 px-4 py-3 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                          <span style={{ color: 'var(--color-text)' }}>{item.name}</span>
                          <span style={{ color: 'var(--color-muted)' }}>Current: {item.current || 'unknown'}</span>
                          <span style={{ color: item.willUpdate ? 'var(--color-primary)' : 'var(--color-muted)' }}>{toolMaintenanceItemDetail(item)}</span>
                        </div>
                      ))}
                      {group.items.length > 18 && (
                        <p className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>+ {group.items.length - 18} more items in this group.</p>
                      )}
                    </div>
                  ) : (
                    <p className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>{group.error || 'No updates reported for this group.'}</p>
                  )}
                  <p className="px-4 py-3 text-xs border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
                    Notes: {group.restoreNotes}
                  </p>
                  {group.key === 'ollama' && group.cleanupCandidates?.length > 0 && (
                    <div className="px-4 py-3 text-xs border-t space-y-1" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
                      <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Older same-family model tags you could remove manually after confirming newer pulls work:</p>
                      <p>{group.cleanupCandidates.map(model => model.name).join(', ')}</p>
                    </div>
                  )}
                </div>
              ))}

              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-muted)' }}>Suggested manual commands</p>
                <div className="rounded-xl border p-3 space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  {toolMaintenancePlan.commands?.map(command => (
                    <code key={command} className="block text-xs break-all" style={{ color: 'var(--color-text)' }}>{command}</code>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
      )}

      {/* Environment tab */}
      {tab === 'Environment' && user?.isAdmin && (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Runtime Environment
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Runtime mode is read from server environment variables, not the database, so a restored production backup cannot accidentally flip local mode.
        </p>

        {!runtimeInfo ? (
          <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading runtime config...</div>
        ) : (
          <div className="space-y-4">
            <div
              className="rounded-xl border px-4 py-3"
              style={{ borderColor: 'var(--color-border)', background: runtimeInfo.isLocal ? '#ecfdf5' : 'var(--color-surface)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--color-muted)' }}>
                    Current mode
                  </p>
                  <p className="text-lg font-semibold mt-1" style={{ color: runtimeInfo.isLocal ? '#047857' : 'var(--color-text)' }}>
                    {runtimeInfo.isLocal ? 'Local Mac Mini' : 'Production'}
                  </p>
                </div>
                <span
                  className="text-xs px-3 py-1 rounded-full font-semibold"
                  style={{
                    color: runtimeInfo.isLocal ? '#047857' : 'var(--color-primary)',
                    background: runtimeInfo.isLocal ? '#d1fae5' : 'var(--color-bg)',
                  }}
                >
                  APP_ENV={runtimeInfo.appEnv}
                </span>
              </div>
            </div>

            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              {runtimeRows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-4 px-4 py-3 border-b last:border-b-0"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
                  <span className="text-sm text-right break-all" style={{ color: 'var(--color-text)' }}>{value}</span>
                </div>
              ))}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-muted)' }}>
                Local safety flags
              </h3>
              <div className="grid sm:grid-cols-3 gap-2">
                {safetyRows.map(([label, enabled]) => (
                  <div
                    key={label}
                    className="rounded-xl border px-3 py-2"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  >
                    <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
                    <p className="text-sm font-semibold" style={{ color: enabled ? '#047857' : '#b45309' }}>
                      {enabled ? 'On' : 'Off'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              To change runtime mode, update APP_ENV and the matching database URL in the server .env, then restart the app.
            </p>
          </div>
        )}
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
