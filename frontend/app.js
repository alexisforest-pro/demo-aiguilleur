(() => {
  'use strict';

  const MODEL = 'mistral-large-4';
  const main = document.getElementById('main');
  const dialog = document.getElementById('dialog');
  const dialogContent = document.getElementById('dialog-content');
  const state = {
    incidents: new Map(), stamps: new Map(), drafts: new Map(), chats: new Map(),
    callDrafts: new Map(), busy: new Set(), errors: new Map(), config: null,
    configError: '', loadError: '', connectionError: '',
    view: 'overview', activeId: null, mainKey: '', modal: null, recording: null,
    sequence: 0, navigation: 0, pollTimer: null, polling: false, booting: false,
    toastTimer: null, refreshPending: false, dataLoaded: false
  };
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    route: '<path d="M5 3v18M19 3v18M5 7h14M5 17h14M9 3v4M15 17v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5"/>',
    alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    phone: '<path d="m7 3 3 5-3 3c1 3 3 5 6 6l3-3 5 3c0 3-2 5-5 4C9 19 5 15 3 8 2 5 4 3 7 3Z"/>',
    message: '<path d="M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z"/><path d="M7 8h10M7 12h7"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/>',
    link: '<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l6-6M16 8l2-2a4 4 0 0 1 6 6l-6 6" transform="translate(1 0) scale(.9)"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4"/>',
    history: '<path d="M3 3v6h6M3 9a9 9 0 1 1 0 6M12 7v5l4 2"/>',
    send: '<path d="m3 3 18 9-18 9 4-9-4-9ZM7 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    file: '<path d="M14 2H5v20h14V7l-5-5ZM14 2v5h5M8 12h8M8 16h8"/>',
    external: '<path d="M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7"/>',
    check: '<path d="m5 12 4 4L19 6"/>'
  };
  let KPI = [];

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }
  const e = escapeHTML;
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  const spinner = '<span class="spinner" aria-hidden="true"></span>';
  const incidentPath = id => `/api/incidents/${encodeURIComponent(id)}`;
  const callPath = (id, callId) => `${incidentPath(id)}/calls/${encodeURIComponent(callId)}`;
  const callKey = (id, callId) => `${id}|${callId}`;
  const chatKey = (id, callId = '') => `chat|${id}|${callId}`;
  const messageKey = id => `message|${id}`;
  const isBusy = key => state.busy.has(key);
  const getIncident = id => state.incidents.get(id);
  const getCall = (id, callId) => getIncident(id)?.events?.find(event => event.type === 'call' && event.id === callId);
  const allIncidents = () => [...state.incidents.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const aiAllowed = () => state.config?.ai_available === true && state.config.model === MODEL;

  function formatted(value, full = false) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return 'Non renseigné';
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'UTC', ...(full ? {day: '2-digit', month: 'short', year: 'numeric'} : {}),
      hour: '2-digit', minute: '2-digit'
    }).format(date) + ' UTC';
  }
  function archiveDate(value) {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? String(value || 'Date inconnue') :
      new Intl.DateTimeFormat('fr-FR', {timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric'}).format(date) + ' UTC';
  }
  function duration(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min` :
      seconds >= 60 ? `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`;
  }
  function rich(value) {
    return String(value || '').split(/\n\s*\n/).filter(Boolean)
      .map(paragraph => `<p>${e(paragraph).replace(/\n/g, '<br>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`).join('');
  }
  const SEVERITIES = [
    {value: 'G3', label: 'SEV1', description: 'Sévérité majeure', tone: 'sev1'},
    {value: 'G2', label: 'SEV2', description: 'Sévérité significative', tone: 'sev2'},
    {value: 'G1', label: 'SEV3', description: 'Sévérité modérée', tone: 'sev3'}
  ];
  function severityBadge(value) {
    const level = SEVERITIES.find(item => item.value === value);
    return `<span class="badge ${level?.tone || ''}" title="${e(level?.description || 'Sévérité non renseignée')}">${e(level?.label || value)}</span>`;
  }
  function callStatus(call, incidentId = '') {
    const labels = {en_cours: 'En cours', termine: 'Terminé', processing: 'Traitement en cours', error: 'Erreur', annule: 'Annulé'};
    const tones = {en_cours: 'amber', termine: 'green', error: 'red', processing: 'purple'};
    const content = `${call.status === 'processing' ? spinner : ''}${e(labels[call.status] || 'Statut inconnu')}`;
    if (incidentId && call.status === 'en_cours') return `<button class="badge amber call-status-action" type="button" data-action="end-call" data-id="${e(incidentId)}" data-call="${e(call.id)}" title="Relire la transcription et terminer l’appel" aria-label="En cours — terminer l’appel ${e(call.title)}" ${recordingLocked() || modalBusy() ? 'disabled' : ''}>${content}</button>`;
    return `<span class="badge ${tones[call.status] || ''}">${content}</span>`;
  }
  function aiNotice() {
    if (!state.config) return 'Configuration IA indisponible. Actualisez la connexion pour réessayer.';
    if (state.config.model !== MODEL) return 'Modèle serveur inattendu. L’IA est désactivée dans cette démonstration.';
    if (!state.config.ai_available) return `IA non configurée sur le serveur. Les données de démonstration restent consultables ; les requêtes IA ne sont pas simulées.`;
    return '';
  }
  function draft(key) {
    if (!state.drafts.has(key)) state.drafts.set(key, {value: '', version: 0});
    return state.drafts.get(key);
  }
  function setDraft(key, value) {
    const current = draft(key);
    current.value = value;
    current.version += 1;
    return current;
  }
  function clearSubmittedDraft(key, snapshot) {
    const current = draft(key);
    if (current.version !== snapshot.version || current.value !== snapshot.value) return;
    setDraft(key, '');
    document.querySelectorAll('[data-draft]').forEach(field => {
      if (field.dataset.draft === key) field.value = '';
    });
  }
  function hydrateDrafts(root) {
    root.querySelectorAll('[data-draft]').forEach(field => { field.value = draft(field.dataset.draft).value; });
  }
  function replaceSlot(id, html) {
    const element = document.getElementById(id);
    if (!element || element._markup === html) return;
    const focused = element.contains(document.activeElement) ? document.activeElement : null;
    const action = focused?.dataset.action;
    const focusId = focused?.dataset.id;
    const scroll = element.scrollTop;
    element.innerHTML = html;
    element._markup = html;
    element.scrollTop = scroll;
    if (action) {
      const replacement = [...element.querySelectorAll('[data-action]')].find(button => button.dataset.action === action && button.dataset.id === focusId);
      replacement?.focus({preventScroll: true});
    }
  }
  function setText(id, value) {
    const node = document.getElementById(id);
    if (node && node.textContent !== String(value || '')) node.textContent = value || '';
  }
  function toast(message, error = false) {
    clearTimeout(state.toastTimer);
    const region = document.getElementById('toast-region');
    region.innerHTML = `<div class="toast${error ? ' error' : ''}" role="${error ? 'alert' : 'status'}"><span>${e(message)}</span><button data-action="dismiss-toast" aria-label="Fermer la notification">${icon('close')}</button></div>`;
    state.toastTimer = setTimeout(() => { region.replaceChildren(); }, error ? 11000 : 6000);
  }

  class RequestError extends Error {
    constructor(message, status = 0, uncertain = false) {
      super(message); this.status = status; this.uncertain = uncertain;
    }
  }
  async function api(path, body, timeout = body === undefined ? 15000 : 90000) {
    const ticket = ++state.sequence;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: body === undefined ? {Accept: 'application/json'} : {'Content-Type': 'application/json', Accept: 'application/json'},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: controller.signal
      });
      let data;
      try { data = await response.json(); } catch (_) { throw new RequestError('Réponse du serveur illisible.', response.status, body !== undefined); }
      if (!response.ok) {
        const detail = Array.isArray(data.detail) ? data.detail.map(item => item.msg || 'Donnée invalide').join(' · ') : data.detail;
        throw new RequestError(typeof detail === 'string' ? detail : `Le serveur a refusé la requête (${response.status}).`, response.status);
      }
      state.connectionError = '';
      return {data, ticket};
    } catch (error) {
      if (error instanceof RequestError) throw error;
      state.connectionError = error.name === 'AbortError' ? 'Le serveur met trop de temps à répondre.' : 'Connexion au serveur interrompue.';
      throw new RequestError(state.connectionError + (body !== undefined ? ' La réception n’est pas confirmée : vérifiez les données avant de réessayer.' : ' Réessayez dans quelques instants.'), 0, body !== undefined);
    } finally {
      clearTimeout(timer);
      updateStatus();
    }
  }
  function cacheIncident(incoming, ticket) {
    if (!incoming?.id || !Array.isArray(incoming.events)) return false;
    const previous = getIncident(incoming.id);
    if (previous && Number(incoming.revision) < Number(previous.revision)) return false;
    let next = !previous || Number(incoming.revision) > Number(previous.revision) || ticket >= (state.stamps.get(incoming.id) || 0) ? incoming : {...previous};
    if (previous) {
      if (String(previous.summary_updated_at || '') > String(incoming.summary_updated_at || '')) {
        next = {...next, summary: previous.summary, summary_updated_at: previous.summary_updated_at,
          summary_revision: previous.summary_revision, summary_source: previous.summary_source};
      } else if (String(incoming.summary_updated_at || '') > String(previous.summary_updated_at || '')) {
        next = {...next, summary: incoming.summary, summary_updated_at: incoming.summary_updated_at,
          summary_revision: incoming.summary_revision, summary_source: incoming.summary_source};
      }
      if (Number(previous.impact?.revision) > Number(next.impact?.revision) ||
          (Number(previous.impact?.revision) === Number(next.impact?.revision) && String(previous.impact?.updated_at || '') > String(next.impact?.updated_at || ''))) {
        next = {...next, impact: previous.impact};
      }
    }
    state.incidents.set(next.id, next);
    state.stamps.set(next.id, Math.max(ticket, state.stamps.get(next.id) || 0));
    return true;
  }
  function cacheIncidents(incidents, ticket) {
    const identifiers = new Set(incidents.map(item => item.id));
    state.incidents.forEach((_, id) => {
      if (!identifiers.has(id) && ticket >= (state.stamps.get(id) || 0)) {
        state.incidents.delete(id); state.stamps.delete(id);
      }
    });
    incidents.forEach(item => cacheIncident(item, ticket));
    state.dataLoaded = true;
  }
  function updateStatus() {
    setText('connection-status', state.connectionError ? `Connexion dégradée · ${state.connectionError}` : state.dataLoaded ? 'Backend connecté · stockage JSON' : 'Connexion au backend…');
    setText('config-status', state.configError ? `Configuration : ${state.configError}` : state.config ?
      (state.config.model !== MODEL ? 'IA · modèle serveur incompatible' : !state.config.ai_available ? 'IA non configurée' : '') : 'Configuration IA en attente');
    setText('nav-count', state.dataLoaded ? String(allIncidents().filter(item => item.status === 'En cours').length) : '—');
    document.querySelectorAll('.rail-link').forEach(button => {
      const selected = button.dataset.action === (state.view === 'overview' ? 'overview' : 'incidents');
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
  }
  function hasBackgroundWork() {
    return allIncidents().some(item => item.impact?.status === 'running' || item.events.some(event => event.type === 'call' && event.status === 'processing'));
  }
  function schedulePoll() {
    clearTimeout(state.pollTimer);
    if (!hasBackgroundWork() || state.polling) return;
    state.pollTimer = setTimeout(poll, state.connectionError ? 6000 : 2800);
  }
  async function poll() {
    if (state.polling) return;
    state.polling = true;
    try {
      const {data, ticket} = await api('/api/incidents');
      if (!Array.isArray(data.incidents)) throw new RequestError('Liste d’incidents invalide.');
      cacheIncidents(data.incidents, ticket);
      refreshUI();
    } catch (error) {
      state.connectionError = error.message;
      updateStatus();
    } finally { state.polling = false; schedulePoll(); }
  }
  async function load(force = false) {
    if (state.booting) return;
    state.booting = true;
    state.loadError = '';
    document.querySelector('[data-action="reload-config"]').disabled = true;
    const results = await Promise.allSettled([api('/api/config'), api('/api/incidents')]);
    if (results[0].status === 'fulfilled') {
      state.config = results[0].value.data; state.configError = '';
      KPI = (state.config.kpi_definitions || []).map(item => [item.key, item.label]);
    } else { state.configError = results[0].reason.message; }
    if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.data.incidents)) {
      cacheIncidents(results[1].value.data.incidents, results[1].value.ticket);
    } else { state.loadError = results[1].status === 'rejected' ? results[1].reason.message : 'Liste d’incidents invalide.'; }
    state.booting = false;
    document.querySelector('[data-action="reload-config"]').disabled = false;
    if (!state.incidents.size) state.mainKey = '';
    refreshUI();
    if (state.mainKey === '' && state.incidents.size) await routeFromHash();
    else if (force && !state.loadError && !state.configError) toast('Connexion et données actualisées.');
  }
  function recordingLocked() {
    return !!state.recording || state.modal?.starting === true;
  }
  async function navigate(view, id = null, writeHash = true) {
    if (recordingLocked()) { toast('Arrêtez puis confirmez l’appel, ou annulez-le explicitement, avant de naviguer.', true); return false; }
    if (dialog.open && !closeDialog()) return false;
    state.view = view; state.activeId = id;
    const token = ++state.navigation;
    if (writeHash) history.replaceState(null, '', view === 'detail' ? `#incident/${encodeURIComponent(id)}` : `#${view}`);
    refreshUI();
    main.focus({preventScroll: true});
    if (view === 'detail') {
      try {
        const {data, ticket} = await api(incidentPath(id));
        cacheIncident(data, ticket);
        if (token === state.navigation && state.activeId === id) { state.loadError = ''; refreshUI(); }
        schedulePoll();
      } catch (error) {
        if (token !== state.navigation || state.activeId !== id) return true;
        state.loadError = error.message; refreshUI();
      }
    }
    return true;
  }
  async function routeFromHash() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('incident/')) {
      let id;
      try { id = decodeURIComponent(hash.slice(9)); } catch (_) { id = ''; }
      if (id) return navigate('detail', id, false);
    }
    return navigate(hash === 'incidents' ? 'incidents' : 'overview', null, false);
  }

  function overviewRow(incident) {
    const calls = incident.events.filter(event => event.type === 'call');
    return `<tr class="incident-row ${e(SEVERITIES.find(level => level.value === incident.severity)?.tone || '')}" data-incident-row>
      <th scope="row" class="incident-reference">${e(incident.id)}</th>
      <td><div class="incident-state">${severityBadge(incident.severity)}<span class="badge${incident.status === 'En cours' ? ' teal' : ''}">${e(incident.status)}</span></div></td>
      <td><time datetime="${e(incident.started_at)}">${e(formatted(incident.started_at, true))}</time></td>
      <td class="incident-event"><button class="incident-title" data-action="open-incident" data-id="${e(incident.id)}" aria-label="Ouvrir ${e(incident.title)}" title="${e(incident.title)} — ${e(incident.description)}">${e(incident.title)}</button><span class="incident-location" title="${e(incident.location)}">${e(incident.location)}</span></td>
      <td class="incident-sector"><strong>${e(incident.region)}</strong><span>${e(incident.line)}</span></td>
      <td class="incident-recovery">${e(incident.estimated_end)}</td>
      <td class="incident-communications"><strong>${e(incident.events.length)} échanges</strong><span>${e(calls.length)} appels</span></td>
    </tr>`;
  }
  function overviewMarkup() {
    return `<div class="page-heading"><div><div class="eyebrow">SUPERVISION EN TEMPS RÉEL</div><h1>${state.view === 'incidents' ? 'Incidents en cours' : 'Vue d’ensemble'}</h1><p>Une lecture commune de la situation, des communications et des impacts.</p></div><button class="btn" data-action="refresh-data">${icon('refresh')}Actualiser</button></div>
      <div id="overview-stats" class="overview-stats"></div><div id="overview-error"></div>
      <div class="section-heading overview-heading"><h2>${icon('route')}Situation opérationnelle <span id="overview-count" class="count"></span></h2><span class="badge synthetic">Données fictives de démonstration</span></div>
      <div class="overview-tools"><div class="search-field">${icon('search')}<input type="search" data-draft="overview-search" aria-label="Rechercher un incident" placeholder="Rechercher un lieu, une ligne, un incident…"></div><select data-draft="overview-severity" aria-label="Filtrer par sévérité"><option value="">Toutes les sévérités</option>${SEVERITIES.map(level => `<option value="${e(level.value)}">${e(level.label)} · ${e(level.description)}</option>`).join('')}</select></div>
      <div class="incident-table-scroll" role="region" aria-label="Liste des événements, défilement horizontal" tabindex="0"><table class="incident-table" aria-label="Situation opérationnelle"><colgroup><col class="reference-column"><col class="state-column"><col class="started-column"><col><col class="sector-column"><col class="recovery-column"><col class="communications-column"></colgroup><thead><tr><th scope="col">Référence</th><th scope="col">Sévérité / statut</th><th scope="col">Début · UTC</th><th scope="col">Événement / localisation</th><th scope="col">Secteur / ligne</th><th scope="col">Reprise estimée</th><th scope="col">Communications</th></tr></thead><tbody id="incident-rows"></tbody></table></div>`;
  }
  function updateOverview() {
    const incidents = allIncidents();
    const ongoing = incidents.filter(item => item.status === 'En cours');
    const stats = [
      [ongoing.length, 'Incidents en cours', 'route', ''],
      ...SEVERITIES.map(level => [ongoing.filter(item => item.severity === level.value).length, `${level.label} · ${level.description}`, 'alert', level.tone])
    ];
    replaceSlot('overview-stats', stats.map(([value, label, name, tone]) => `<div class="stat-card ${tone}"><span class="stat-icon ${tone}">${icon(name)}</span><div><strong>${e(value)}</strong><p>${e(label)}</p></div></div>`).join(''));
    replaceSlot('overview-error', state.loadError ? `<div class="error-box" role="alert">${e(state.loadError)}<br><button class="btn small" data-action="refresh-data">Réessayer</button></div>` : '');
    const search = draft('overview-search').value.trim().toLocaleLowerCase('fr');
    const severity = draft('overview-severity').value;
    const filtered = incidents.filter(item => (!severity || item.severity === severity) && (!search || [item.id, item.title, item.location, item.line, item.region, item.category].join(' ').toLocaleLowerCase('fr').includes(search)));
    setText('overview-count', `${filtered.length} / ${incidents.length}`);
    replaceSlot('incident-rows', filtered.length ? filtered.map(overviewRow).join('') : '<tr><td colspan="7" class="empty">Aucun incident ne correspond aux filtres.</td></tr>');
  }
  function detailMarkup(incident) {
    return `<div class="detail-body"><div id="detail-error"></div><header id="incident-head" class="incident-head"></header><div class="operations-grid situation-grid"><section id="incident-summary" class="summary-panel" aria-label="Résumé de la situation"></section><section id="impact-panel" class="panel"></section></div><div id="incident-related" class="related-bar"></div>
      <div class="operations-grid"><section class="panel timeline-panel" aria-labelledby="communications-title"><div class="section-heading"><h2 id="communications-title">${icon('message')}Communications <span id="event-count" class="count"></span></h2></div>
      <form class="message-form" data-form="message" data-incident="${e(incident.id)}"><label for="message-content">Écrivez votre message</label><textarea id="message-content" data-draft="${e(messageKey(incident.id))}" maxlength="6000" required placeholder="Partagez un bilan, une décision ou une information terrain…"></textarea><div class="form-bottom"><small>Information enregistrée dans le fil.<br>Les impacts sont recalculés en arrière-plan.</small><div class="button-row"><button id="message-submit" class="btn primary" type="submit">${icon('send')}Envoyer le message</button><button class="btn purple" type="button" data-action="new-call" data-id="${e(incident.id)}">${icon('phone')}Démarrer un appel</button></div></div><div id="message-error" class="inline-error" role="alert"></div></form><div id="timeline-events" class="timeline" aria-label="Fil des communications, les plus récentes en premier"></div></section>
      <aside class="right-column" aria-label="Aide à la décision"><section class="panel" aria-labelledby="assistant-title"><div class="panel-heading"><h2 id="assistant-title">${icon('spark')}Assistant incident</h2><span class="badge teal">IA</span></div>${chatMarkup(incident.id)}<p id="assistant-config-note" class="impact-note"></p></section><section id="history-panel" class="panel history-panel"></section></aside></div></div>`;
  }
  function timelineEvent(event, incident) {
    const meta = `<div class="event-meta"><strong>${e(event.author || 'Coordination')}</strong><span>${e(event.role)}</span><time datetime="${e(event.created_at)}" title="${e(formatted(event.created_at, true))}">${e(formatted(event.created_at))}</time></div>`;
    if (event.type !== 'call') return `<article class="event"><span class="event-dot">${icon('message')}</span>${meta}<p class="event-message">${e(event.content)}</p></article>`;
    const local = state.callDrafts.get(callKey(incident.id, event.id));
    return `<article class="event call-event${event.status === 'termine' ? ' call-finished' : ''}"><span class="event-dot">${icon('phone')}</span>${meta}<div class="call-card"><div class="call-header"><button class="call-title" data-action="open-call" data-id="${e(incident.id)}" data-call="${e(event.id)}">${icon('phone')}${e(event.title)}</button>${callStatus(event, incident.id)}</div><div class="call-info"><span>${e((event.participants || []).join(' · '))}</span><span>${event.duration_seconds ? e(duration(event.duration_seconds)) : 'Durée non renseignée'}</span>${event.synthetic ? '<span class="badge synthetic">Appel synthétique</span>' : '<span>Microphone navigateur</span>'}${local?.url ? '<span>Audio local disponible</span>' : ''}</div>${event.status === 'termine' && event.summary ? `<div class="call-summary structured">${rich(event.summary)}</div>` : ''}${event.status === 'processing' ? '<p class="small muted">Résumé en préparation, puis recalcul des impacts…</p>' : ''}${event.status === 'error' ? `<p class="inline-error">${e(event.error || 'Le traitement a échoué. La transcription reste disponible.')}</p>` : ''}${local?.phase === 'review' && ['en_cours', 'error'].includes(event.status) ? '<p class="small muted">Transcription à confirmer · brouillon conservé dans cette page.</p>' : ''}<div class="call-actions">${event.status === 'en_cours' ? `<button data-action="join-call" data-id="${e(incident.id)}" data-call="${e(event.id)}" ${recordingLocked() || modalBusy() ? 'disabled' : ''}>Rejoindre l’appel ${icon('phone')}</button>` : ''}<button data-action="open-call" data-id="${e(incident.id)}" data-call="${e(event.id)}">${event.status === 'error' ? 'Ouvrir et réessayer' : local?.phase === 'review' ? 'Reprendre le brouillon' : 'Résumé, transcription et chat'} ${icon('arrow')}</button></div></div></article>`;
  }
  function impactMarkup(incident) {
    const impact = incident.impact || {};
    const statusLabels = {confirmed: 'Confirmé', estimated: 'Estimé', unknown: 'Non renseigné'};
    return `<div class="panel-heading"><h2>${icon('users')}Impact opérationnel</h2>${impact.status === 'running' ? `<span class="badge teal">${spinner}Calcul en cours</span>` : '<span class="badge">6 indicateurs</span>'}</div>
      <div class="impact-grid">${KPI.map(([key, fallback]) => {
        const item = (impact.items || []).find(candidate => candidate.key === key) || {key, label: fallback, value: null, status: 'unknown', source: ''};
        const source = item.source === 'header' ? 'En-tête de l’incident' : item.source ? incident.events.find(event => event.id === item.source) : null;
        const sourceLabel = typeof source === 'string' ? source : source ? `${source.type === 'call' ? 'Appel' : 'Message'} · ${formatted(source.created_at)}` : 'Source non renseignée';
        return `<div class="kpi"><div class="kpi-label">${e(fallback || item.label)}</div><div class="kpi-value">${e(item.value == null || item.value === '' ? '—' : item.value)}</div><span class="badge ${item.status === 'confirmed' ? 'teal' : item.status === 'estimated' ? 'amber' : ''}">${e(statusLabels[item.status] || statusLabels.unknown)}</span><div class="kpi-source" title="${e(item.source)}">${e(sourceLabel)}</div></div>`;
      }).join('')}</div><div class="impact-note">${impact.status === 'error' ? `<div class="inline-error" role="alert">${e(impact.error || 'Impossible de recalculer les impacts. Les derniers chiffres sont conservés.')}</div>` : ''}${Number(impact.revision) < Number(incident.revision) ? 'Le bilan affiché ne couvre pas encore toutes les dernières communications.' : 'Valeurs extraites des informations disponibles, sans extrapolation.'}</div><div class="impact-foot"><span>${impact.origin === 'mistral' ? 'Mis à jour :' : 'Bilan synthétique initial ·'} ${e(formatted(impact.updated_at))}</span><button class="text-button" data-action="retry-impact" data-id="${e(incident.id)}" ${impact.status === 'running' || isBusy(`impact|${incident.id}`) || !aiAllowed() ? 'disabled' : ''}>${impact.status === 'error' ? 'Réessayer' : 'Recalculer'}</button></div>`;
  }
  function historyMarkup(incident) {
    return `<div class="panel-heading"><h2>${icon('history')}Incidents similaires</h2><span class="badge synthetic">REX fictifs</span></div><div class="history-list">${(incident.history || []).map(item => `<article class="history-item"><div class="history-item-top"><span>${e(item.id)} · ${e(archiveDate(item.date))}</span><span class="confidence">${e(item.confidence)} %</span></div><button data-action="open-history" data-id="${e(incident.id)}" data-history="${e(item.id)}">${e(item.title)}</button><p>${e(item.location)} · ${e(item.category)}</p></article>`).join('') || '<div class="empty">Aucun historique disponible.</div>'}</div><p class="impact-note">Similarité de démonstration, non calculée sur une base d’archives réelle.</p>`;
  }
  function updateDetail(incident) {
    replaceSlot('detail-error', state.loadError ? `<div class="error-box" role="alert">${e(state.loadError)}<br><button class="btn small" data-action="refresh-data">Réessayer</button></div>` : '');
    replaceSlot('incident-head', `<div class="incident-kicker"><span class="eyebrow">${e(incident.id)}</span>${severityBadge(incident.severity)}<span class="badge teal">${e(incident.status)}</span><span class="badge synthetic">Incident de démonstration</span></div><div class="heading-row"><h1>${e(incident.title)}</h1><button class="btn" data-action="summary" data-id="${e(incident.id)}" ${isBusy(`summary|${incident.id}`) || !aiAllowed() ? 'disabled' : ''}>${isBusy(`summary|${incident.id}`) ? spinner : icon('refresh')}${isBusy(`summary|${incident.id}`) ? 'Génération en cours…' : 'Régénérer le résumé'}</button></div><div class="metadata"><span>${icon('route')}Ligne impactée : ${e(incident.line)}</span><span>${icon('clock')}Début : ${e(formatted(incident.started_at, true))}</span><span>Reprise estimée : ${e(incident.estimated_end)}</span></div>`);
    replaceSlot('incident-summary', `<div class="section-heading"><h2>${icon('spark')}Résumé de la situation</h2><span class="badge ${incident.summary_source === 'mistral' ? 'teal' : 'synthetic'}">${incident.summary_source === 'mistral' ? 'Synthèse IA' : 'Synthèse initiale fictive'}</span></div>${isBusy(`summary|${incident.id}`) ? `<div class="loading-bar" role="status">${spinner}Analyse des communications en cours. Cela peut prendre une minute.</div>` : ''}<div class="summary-copy structured">${rich(incident.summary) || '<p>Résumé non disponible.</p>'}</div><div class="summary-foot">${icon('clock')}Mis à jour : ${e(formatted(incident.summary_updated_at))}${Number(incident.summary_revision) < Number(incident.revision) ? '<span class="badge amber">De nouvelles informations sont disponibles</span>' : ''}</div>${state.errors.get(`summary|${incident.id}`) ? `<div class="inline-error" role="alert">${e(state.errors.get(`summary|${incident.id}`))} <button class="text-button" data-action="summary" data-id="${e(incident.id)}" ${!aiAllowed() ? 'disabled' : ''}>Réessayer</button></div>` : ''}`);
    replaceSlot('incident-related', `<span>${icon('link')}Incidents liés</span>${(incident.related_ids || []).map(id => `<button class="related-chip" data-action="open-incident" data-id="${e(id)}" title="${e(getIncident(id)?.title || id)}">${icon('link')}${e(id)}</button>`).join('') || '<span>Aucun</span>'}<button class="text-button" data-action="related" data-id="${e(incident.id)}">Modifier les liens</button>`);
    setText('event-count', String(incident.events.length));
    replaceSlot('timeline-events', [...incident.events].reverse().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(event => timelineEvent(event, incident)).join('') || '<div class="empty">Aucune communication.</div>');
    const sending = isBusy(`message|${incident.id}`);
    const button = document.getElementById('message-submit');
    button.disabled = sending;
    button.innerHTML = sending ? `${spinner}Envoi…` : `${icon('send')}Envoyer le message`;
    setText('message-error', state.errors.get(`message|${incident.id}`));
    replaceSlot('impact-panel', impactMarkup(incident));
    replaceSlot('history-panel', historyMarkup(incident));
    setText('assistant-config-note', aiNotice());
    updateChat(chatKey(incident.id));
  }
  function refreshUI() {
    if (state.composing) { state.refreshPending = true; return; }
    updateStatus();
    if (!state.incidents.size) {
      main.innerHTML = state.loadError ? `<div class="error-box" role="alert"><h2>Connexion impossible</h2><p>${e(state.loadError)}</p><button class="btn primary" data-action="refresh-data">Réessayer</button></div>` : state.dataLoaded ? '<div class="empty"><h2>Aucun incident</h2><p>Ajoutez un incident dans le fichier JSON, puis actualisez les données.</p><button class="btn" data-action="refresh-data">Actualiser</button></div>' : `<div class="initial-loading" role="status">${spinner}Connexion au centre de supervision…</div>`;
      return;
    }
    const key = state.view === 'detail' ? `detail|${state.activeId}` : state.view;
    const incident = getIncident(state.activeId);
    if (state.mainKey !== key) {
      main.innerHTML = state.view === 'detail' ? incident ? detailMarkup(incident) : `<div class="error-box" role="alert">Incident introuvable ou inaccessible.<p>${e(state.loadError)}</p><button class="btn" data-action="overview">Revenir à la vue d’ensemble</button></div>` : overviewMarkup();
      state.mainKey = key;
      hydrateDrafts(main);
    }
    setText('breadcrumb-label', state.view === 'detail' ? state.activeId : state.view === 'incidents' ? 'Incidents en cours' : 'Vue d’ensemble');
    if (state.view === 'detail' && incident) updateDetail(incident);
    else if (state.view !== 'detail') updateOverview();
    updateModal();
    schedulePoll();
  }

  function chatSession(key) {
    if (!state.chats.has(key)) state.chats.set(key, {messages: [], pending: false, failed: null});
    return state.chats.get(key);
  }
  function chatMarkup(id, callId = '') {
    const key = chatKey(id, callId);
    return `<div data-chat="${e(key)}"><p class="chat-intro">${callId ? 'Interrogez la transcription confirmée de cet appel. Le brouillon et l’audio ne sont pas envoyés au chat.' : 'Questions sur la situation, les décisions et les incidents liés. Les réponses ne remplacent pas les consignes opérationnelles.'}</p>${!callId ? `<div class="chat-suggestions"><button class="suggestion" data-action="suggestion" data-id="${e(id)}" data-question="Quelles sont les priorités et les points à confirmer ?">Priorités et points à confirmer</button><button class="suggestion" data-action="suggestion" data-id="${e(id)}" data-question="Résume les dernières décisions et l’impact voyageurs.">Décisions et impact voyageurs</button></div>` : ''}<div class="chat-messages" data-chat-messages aria-live="polite" aria-relevant="additions text"></div><div class="inline-error" data-chat-error role="alert"></div><form class="chat-form" data-form="chat" data-incident="${e(id)}" data-call="${e(callId)}"><label class="eyebrow" for="${callId ? 'call-question' : 'incident-question'}">Votre question</label><div class="input-row"><textarea id="${callId ? 'call-question' : 'incident-question'}" data-draft="${e(key)}" maxlength="3000" required placeholder="Posez une question…" rows="2"></textarea><button class="btn primary" type="submit" aria-label="Envoyer la question">${icon('send')}</button></div></form></div>`;
  }
  function updateChat(key) {
    const session = chatSession(key);
    document.querySelectorAll('[data-chat]').forEach(root => {
      if (root.dataset.chat !== key) return;
      const messages = root.querySelector('[data-chat-messages]');
      const nearBottom = messages.scrollHeight - messages.clientHeight - messages.scrollTop < 45;
      const html = session.messages.map(item => `<div class="chat-message ${item.role === 'user' ? 'user' : 'assistant'}"><div class="chat-role">${item.role === 'user' ? 'Vous' : 'Assistant'}</div><div class="structured">${rich(item.content)}</div>${item.status === 'failed' ? '<p class="inline-error">Question non traitée.</p>' : ''}</div>`).join('') + (session.pending ? `<div class="chat-message assistant" role="status">${spinner}L’assistant analyse les informations…</div>` : '');
      if (messages._markup !== html) { messages.innerHTML = html; messages._markup = html; if (nearBottom) messages.scrollTop = messages.scrollHeight; }
      const error = root.querySelector('[data-chat-error]');
      error.innerHTML = session.failed ? `${e(session.failed.error)} <button class="text-button" data-action="retry-chat" data-chat-key="${e(key)}">Réessayer cette question</button>` : '';
      const callId = root.querySelector('form').dataset.call;
      const id = root.querySelector('form').dataset.incident;
      const allowed = aiAllowed() && (!callId || !!getCall(id, callId)?.transcript?.trim());
      const submit = root.querySelector('button[type="submit"]');
      submit.disabled = session.pending || !allowed;
      submit.innerHTML = session.pending ? spinner : icon('send');
      submit.setAttribute('aria-label', session.pending ? 'Réponse en cours' : 'Envoyer la question');
      root.querySelectorAll('[data-action="retry-chat"]').forEach(button => { button.disabled = session.pending || !allowed; });
    });
  }
  async function sendChat(id, callId = '', retry = false) {
    const key = chatKey(id, callId);
    const session = chatSession(key);
    if (session.pending || !aiAllowed()) return;
    const snapshot = {...draft(key)};
    const previousFailure = retry ? session.failed : null;
    const question = (previousFailure ? previousFailure.question : snapshot.value).trim();
    if (!question || question.length > 3000) { toast('Saisissez une question de 1 à 3 000 caractères.', true); return; }
    if (callId && !getCall(id, callId)?.transcript?.trim()) { toast('Confirmez la transcription avant d’interroger cet appel.', true); return; }
    const historyTurns = previousFailure ? previousFailure.history : session.messages.filter(item => item.status === 'sent').slice(-20).map(item => ({role: item.role, content: item.content.slice(0, 8000)}));
    const userTurn = previousFailure ? session.messages.find(item => item.id === previousFailure.turnId) : {id: ++state.sequence, role: 'user', content: question, status: 'pending'};
    if (!previousFailure) session.messages.push(userTurn); else userTurn.status = 'pending';
    session.pending = true; session.failed = null; updateChat(key);
    try {
      const {data} = await api(`${callId ? callPath(id, callId) : incidentPath(id)}/chat`, {question, history: historyTurns});
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new RequestError('L’assistant a retourné une réponse vide.');
      userTurn.status = 'sent';
      session.messages.push({id: ++state.sequence, role: 'assistant', content: data.answer, status: 'sent'});
      if (!retry) clearSubmittedDraft(key, snapshot);
    } catch (error) {
      userTurn.status = 'failed'; session.failed = {question, history: historyTurns, turnId: userTurn.id, error: error.message};
    } finally { session.pending = false; updateChat(key); updateStatus(); }
  }
  async function sendMessage(id) {
    const key = messageKey(id);
    if (isBusy(key)) return;
    const snapshot = {...draft(key)};
    const content = snapshot.value.trim();
    if (!content || content.length > 6000) { toast('Saisissez un message de 1 à 6 000 caractères.', true); return; }
    state.busy.add(key); state.errors.delete(key); refreshUI();
    try {
      const {data, ticket} = await api(`${incidentPath(id)}/messages`, {content});
      cacheIncident(data, ticket); clearSubmittedDraft(key, snapshot); toast('Message ajouté. Les impacts sont en cours de recalcul.');
    } catch (error) { state.errors.set(key, error.message); if (error.uncertain) void reconcile(id); }
    finally { state.busy.delete(key); refreshUI(); }
  }
  async function reconcile(id) {
    try { const {data, ticket} = await api(incidentPath(id)); cacheIncident(data, ticket); refreshUI(); } catch (_) { updateStatus(); }
  }
  async function incidentAI(id, kind) {
    const key = `${kind}|${id}`;
    if (isBusy(key) || !aiAllowed()) return;
    state.busy.add(key); state.errors.delete(key); refreshUI();
    try {
      const {data, ticket} = await api(`${incidentPath(id)}/${kind}`, {});
      cacheIncident(kind === 'summary' ? data.incident : data, ticket);
      if (kind === 'summary') { toast('Résumé actualisé à partir des informations de l’incident.'); }
      else toast('Recalcul des impacts démarré.');
    } catch (error) { state.errors.set(key, error.message); toast(error.message, true); if (error.status === 409 || error.uncertain) void reconcile(id); }
    finally { state.busy.delete(key); refreshUI(); }
  }

  function modalBusy() {
    const modal = state.modal;
    return !!modal && (modal.starting || modal.saving || modal.canceling || modal.relatedSaving);
  }
  function dialogHeader(title, subtitle, eyebrow = 'COMMUNICATIONS') {
    return `<header class="dialog-header"><div><div class="eyebrow">${e(eyebrow)}</div><h2 id="dialog-title" tabindex="-1">${e(title)}</h2><p>${e(subtitle)}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Fermer le dialogue">${icon('close')}</button></header>`;
  }
  function openModal(modal, html, internal = false) {
    if (!internal && (recordingLocked() || modalBusy())) { toast('Terminez ou annulez l’action en cours avant d’ouvrir un autre dialogue.', true); return false; }
    const returnFocus = state.modal?.returnFocus || document.activeElement;
    state.modal = {...modal, returnFocus};
    dialogContent.innerHTML = html;
    hydrateDrafts(dialogContent);
    document.body.classList.add('dialog-open');
    if (!dialog.open) dialog.showModal();
    dialogContent.querySelector('[autofocus], #dialog-title')?.focus({preventScroll: true});
    return true;
  }
  function closeDialog() {
    if (recordingLocked() || modalBusy()) { toast('Arrêtez l’enregistrement ou annulez explicitement l’appel. Une sauvegarde en cours doit se terminer.', true); return false; }
    const modal = state.modal;
    if (modal?.kind === 'call') {
      const local = state.callDrafts.get(callKey(modal.id, modal.callId));
      if (local?.phase === 'review') toast('Audio et transcription conservés dans cette page. Rouvrez l’appel pour les confirmer.');
    }
    state.modal = null;
    dialog.close();
    document.body.classList.remove('dialog-open');
    if (modal?.returnFocus?.isConnected) modal.returnFocus.focus({preventScroll: true});
    else main.focus({preventScroll: true});
    return true;
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('close', () => {
    if (state.modal && recordingLocked()) { dialog.showModal(); return; }
    state.modal = null; document.body.classList.remove('dialog-open');
  });
  dialog.addEventListener('keydown', event => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...dialog.querySelectorAll('[role="tab"]')].filter(item => !item.disabled);
    const current = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    if (tabs[next]) { tabs[next].click(); tabs[next].focus(); }
  });

  function openRelated(id) {
    const incident = getIncident(id);
    if (!incident) return;
    const key = `related|${id}`;
    if (!state.relatedDrafts) state.relatedDrafts = new Map();
    if (!state.relatedDrafts.has(id)) state.relatedDrafts.set(id, new Set(incident.related_ids || []));
    const selection = state.relatedDrafts.get(id);
    openModal({kind: 'related', id, key}, `${dialogHeader('Lier des incidents', incident.title, 'SITUATION PARTAGÉE')}<div class="dialog-body"><p class="notice">Choisissez les incidents en cours à prendre en compte dans le contexte de cet incident. L’enregistrement remplace ses liens ; les liens inverses ne sont pas modifiés.</p><form id="related-form" data-form="related" data-incident="${e(id)}"><div class="related-options">${allIncidents().filter(item => item.id !== id && item.status === 'En cours').map(item => `<label class="related-option"><input type="checkbox" data-related-id="${e(item.id)}" ${selection.has(item.id) ? 'checked' : ''}><span><strong>${e(item.title)}</strong><small>${e(item.id)} · ${e(item.location)} · ${severityBadge(item.severity)}</small></span></label>`).join('') || '<p class="muted">Aucun autre incident en cours.</p>'}</div><div id="related-error" class="inline-error" role="alert"></div></form></div><footer class="dialog-footer"><button class="btn" data-action="close-dialog">Fermer</button><button class="btn primary" type="submit" form="related-form" id="related-submit">Enregistrer les liens</button></footer>`);
  }
  function syncRelatedDraft() {
    if (state.modal?.kind !== 'related') return;
    const selection = new Set([...dialog.querySelectorAll('[data-related-id]:checked')].map(input => input.dataset.relatedId));
    state.relatedDrafts.set(state.modal.id, selection);
  }
  async function saveRelated(id) {
    const modal = state.modal;
    if (!modal || modal.kind !== 'related' || modal.id !== id || modal.relatedSaving) return;
    syncRelatedDraft();
    const submitted = [...state.relatedDrafts.get(id)];
    modal.relatedSaving = true; setText('related-error', ''); updateModal();
    try {
      const {data, ticket} = await api(`${incidentPath(id)}/related`, {related_ids: submitted});
      cacheIncident(data, ticket); state.relatedDrafts.delete(id);
      modal.relatedSaving = false;
      if (state.modal === modal) closeDialog();
      toast('Liens enregistrés. Le contexte et les impacts seront actualisés.');
    } catch (error) { if (state.modal === modal) setText('related-error', error.message); if (error.uncertain) void reconcile(id); }
    finally { modal.relatedSaving = false; refreshUI(); }
  }
  function safeArchiveURL(item) {
    const fallback = `/archives/${encodeURIComponent(item.id)}`;
    try {
      const url = new URL(item.url || fallback, location.origin);
      return url.origin === location.origin && url.pathname === fallback && !url.search && !url.hash ? url.pathname : fallback;
    } catch (_) { return fallback; }
  }
  function openHistory(id, historyId) {
    const incident = getIncident(id);
    const item = incident?.history?.find(entry => entry.id === historyId);
    if (!item) { toast('Historique introuvable.', true); return; }
    openModal({kind: 'history', id}, `${dialogHeader(item.title, `${item.id} · ${archiveDate(item.date)}`, 'RETOUR D’EXPÉRIENCE FICTIF')}<div class="dialog-body"><div class="notice amber">Archive synthétique et score de similarité fictif. Le lien ci-dessous ouvre une page de démonstration, pas une source externe.</div><div class="archive-meta">${severityBadge(item.severity)}<span class="badge">${e(item.category)}</span><span class="badge teal">Similarité ${e(item.confidence)} %</span><span class="badge">${e(item.location)}</span></div><div class="structured">${rich(item.summary)}</div></div><footer class="dialog-footer"><button class="btn" data-action="close-dialog">Fermer</button><a class="btn primary" href="${e(safeArchiveURL(item))}" target="_blank" rel="noopener noreferrer">Ouvrir l’archive de démonstration ${icon('external')}</a></footer>`);
  }
  function openNewCall(id) {
    const incident = getIncident(id);
    if (!incident) return;
    const blocker = allIncidents().flatMap(item => item.events.filter(event => event.type === 'call' && event.status === 'en_cours' && !event.synthetic).map(call => ({id: item.id, call})))[0];
    const mode = draft(`call-mode|${id}`).value || 'microphone';
    const supported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && window.isSecureContext;
    openModal({kind: 'new-call', id}, `${dialogHeader('Ajouter un appel', incident.title, 'COORDINATION OPÉRATIONNELLE')}<div class="dialog-body">${blocker ? `<div class="notice amber">Un appel microphone est déjà ouvert. Terminez-le ou annulez-le avant d’en créer un autre.<br><button class="text-button" data-action="open-call" data-id="${e(blocker.id)}" data-call="${e(blocker.call.id)}">Ouvrir ${e(blocker.call.title)}</button></div>` : ''}<form id="new-call-form" class="new-call-form" data-form="new-call" data-incident="${e(id)}"><div class="field"><label for="call-title">Titre de l’appel</label><input id="call-title" type="text" maxlength="180" data-draft="call-title|${e(id)}" placeholder="Appel de coordination" autofocus></div><fieldset class="record-options"><legend>Origine de la transcription</legend><label class="record-option"><input type="radio" name="call-mode" value="microphone" ${mode === 'microphone' ? 'checked' : ''}><span><strong>${icon('mic')}Microphone réel</strong><span>Enregistrement local et, si disponible, reconnaissance vocale du navigateur en français (fr-FR). La transcription doit être relue avant envoi. Seul votre microphone est capturé, pas un appel téléphonique externe.</span></span></label><label class="record-option"><input type="radio" name="call-mode" value="synthetic" ${mode === 'synthetic' ? 'checked' : ''}><span><strong>${icon('file')}Appel synthétique de démonstration</strong><span>Transcription fictive fournie par le backend. Aucun microphone, aucun audio généré et aucune fausse reconnaissance vocale.</span></span></label></fieldset><div class="notice">L’audio n’est jamais téléversé. La transcription confirmée est enregistrée localement par le serveur. La reconnaissance du navigateur peut utiliser son propre service vocal ; elle est distincte de Mistral.</div>${!supported ? '<div class="notice amber">Le microphone nécessite HTTPS ou localhost, MediaRecorder et l’autorisation du navigateur. Utilisez un navigateur compatible ou l’option synthétique clairement identifiée.</div>' : ''}<div id="new-call-error" class="inline-error" role="alert"></div></form></div><footer class="dialog-footer"><button class="btn" data-action="close-dialog">Fermer</button><button id="cancel-start" class="btn danger" data-action="cancel-start" hidden>Annuler le démarrage</button><button id="new-call-submit" class="btn primary" type="submit" form="new-call-form" ${blocker ? 'disabled' : ''}>${icon(mode === 'synthetic' ? 'file' : 'mic')}${mode === 'synthetic' ? 'Créer l’appel synthétique' : 'Démarrer le microphone'}</button></footer>`);
    if (state.modal?.kind === 'new-call') state.modal.blocked = !!blocker;
  }
  function syncNewCallMode() {
    const modal = state.modal;
    if (modal?.kind !== 'new-call') return;
    const mode = dialog.querySelector('[name="call-mode"]:checked')?.value || 'microphone';
    setDraft(`call-mode|${modal.id}`, mode);
    const button = document.getElementById('new-call-submit');
    if (button && !modal.starting) button.innerHTML = `${icon(mode === 'synthetic' ? 'file' : 'mic')}${mode === 'synthetic' ? 'Créer l’appel synthétique' : 'Démarrer le microphone'}`;
  }
  function ensureCallDraft(id, call) {
    const key = callKey(id, call.id);
    if (!state.callDrafts.has(key)) {
      const transcriptKey = `transcript|${id}|${call.id}`;
      if (!state.drafts.has(transcriptKey)) setDraft(transcriptKey, call.transcript || '');
      state.callDrafts.set(key, {id, callId: call.id, transcriptKey, duration: call.duration_seconds || 0,
        phase: ['en_cours', 'error'].includes(call.status) ? 'review' : 'saved',
        confirmed: false, blob: null, url: '', mime: '', note: '', error: ''});
    }
    return state.callDrafts.get(key);
  }
  function openCall(id, callId, tab = 'summary', internal = false) {
    const call = getCall(id, callId);
    if (!call) { toast('Appel introuvable. Actualisez les données.', true); return; }
    ensureCallDraft(id, call);
    const opened = openModal({kind: 'call', id, callId, tab}, `${dialogHeader(call.title, `${id} · ${formatted(call.created_at, true)}`, 'APPEL DE COORDINATION')}<div id="call-dialog-meta" class="dialog-details" style="padding:0 26px 16px"></div><div class="dialog-tabs" role="tablist" aria-label="Informations de l’appel">${[['summary', 'Résumé', 'file'], ['transcription', 'Transcription', 'message'], ['chat', 'Chat', 'spark']].map(([key, label, name]) => `<button id="call-tab-${key}" role="tab" data-action="call-tab" data-tab="${key}" aria-controls="call-tab-content" aria-selected="${key === tab}" tabindex="${key === tab ? 0 : -1}">${icon(name)}${label}</button>`).join('')}</div><div class="dialog-body"><div id="call-dialog-notice"></div><div id="call-audio"></div><section id="call-tab-content" role="tabpanel" aria-labelledby="call-tab-${e(tab)}"></section><div id="call-dialog-error" class="inline-error" role="alert"></div></div><footer id="call-dialog-footer" class="dialog-footer"></footer>`, internal);
    if (opened) { renderCallTab(); updateModal(); }
  }
  function renderCallTab() {
    const modal = state.modal;
    if (modal?.kind !== 'call' || state.recording) return;
    const call = getCall(modal.id, modal.callId);
    if (!call) return;
    const local = ensureCallDraft(modal.id, call);
    const panel = document.getElementById('call-tab-content');
    panel.setAttribute('aria-labelledby', `call-tab-${modal.tab}`);
    if (modal.tab === 'summary') {
      panel.innerHTML = '<div id="call-summary-copy" class="structured"></div>';
    } else if (modal.tab === 'chat') {
      panel.innerHTML = chatMarkup(modal.id, modal.callId) + (aiNotice() ? `<p class="recognition-note">${e(aiNotice())}</p>` : '');
    } else if (['en_cours', 'error'].includes(call.status)) {
      panel.innerHTML = `<form id="call-finish-form" data-form="finish-call" data-incident="${e(modal.id)}" data-call="${e(modal.callId)}"><label for="call-transcript">Transcription à relire et corriger</label><textarea id="call-transcript" class="transcript-editor" data-draft="${e(local.transcriptKey)}" maxlength="60000" required placeholder="Saisissez ou collez ici la transcription réelle de l’appel. Aucun texte n’est inventé."></textarea><p class="draft-note">Ce brouillon et l’audio éventuel sont conservés tant que cette page reste ouverte, même si vous fermez ce dialogue. Seule la transcription confirmée sera envoyée.</p><label class="related-option"><input id="transcript-confirmed" type="checkbox" ${local.confirmed ? 'checked' : ''}><span>J’ai relu la transcription et je confirme son enregistrement.</span></label></form>`;
    } else {
      panel.innerHTML = `<h3>Transcription enregistrée</h3><p id="saved-transcript" class="transcript-text">${e(call.transcript || 'Aucune transcription enregistrée pour cet appel.')}</p>`;
    }
    hydrateDrafts(panel);
    modal.renderedTab = modal.tab;
    modal.renderedStatus = call.status;
    updateModal();
  }
  function syncTranscriptDraft(key) {
    const [, id, callId] = key.split('|');
    const local = state.callDrafts.get(callKey(id, callId));
    if (!local) return;
    local.confirmed = false;
    const checkbox = document.getElementById('transcript-confirmed');
    if (checkbox && state.modal?.id === id && state.modal?.callId === callId) checkbox.checked = false;
    updateModal();
  }
  function callFooter(modal, call, local) {
    const locked = recordingLocked();
    const pending = modal.saving || modal.canceling;
    const editable = ['en_cours', 'error'].includes(call.status);
    const recording = state.recording && state.recording.id === modal.id && state.recording.callId === modal.callId;
    return `${recording ? `<button class="btn danger" data-action="cancel-call" ${pending ? 'disabled' : ''}>${icon('close')}Annuler et supprimer l’enregistrement</button><button id="stop-recording" class="btn primary" data-action="stop-recording" ${state.recording.stopping || pending ? 'disabled' : ''}>${state.recording.stopping ? spinner : icon('stop')}${state.recording.stopping ? 'Finalisation de la transcription…' : 'Arrêter et relire'}</button>` : `${editable ? `<button class="btn danger" data-action="cancel-call" ${pending ? 'disabled' : ''}>${modal.canceling ? spinner : icon('close')}${modal.canceling ? 'Annulation…' : 'Annuler l’appel'}</button>` : ''}<button class="btn" data-action="close-dialog" ${locked || pending ? 'disabled' : ''}>Fermer</button>${editable && !locked ? modal.tab === 'transcription' ? `<button id="finish-call-submit" class="btn primary" type="submit" form="call-finish-form" ${pending || !local.confirmed || !draft(local.transcriptKey).value.trim() ? 'disabled' : ''}>${modal.saving ? spinner : icon('check')}${modal.saving ? 'Enregistrement…' : call.status === 'error' ? 'Confirmer et relancer le résumé' : 'Confirmer et terminer'}</button>` : '<button class="btn primary" data-action="review-transcript">Relire la transcription</button>' : ''}`}`;
  }
  function updateModal() {
    const modal = state.modal;
    if (!modal || !dialog.open) return;
    const locked = recordingLocked() || modalBusy();
    dialog.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = locked; });
    if (modal.kind === 'new-call') {
      dialog.querySelectorAll('input').forEach(field => { field.disabled = !!modal.starting; });
      const submit = document.getElementById('new-call-submit');
      if (submit) { submit.disabled = !!modal.starting || modal.blocked; if (modal.starting) submit.innerHTML = `${spinner}Démarrage…`; else syncNewCallMode(); }
      const cancel = document.getElementById('cancel-start');
      if (cancel) { cancel.hidden = !modal.starting; cancel.disabled = !!state.startingCall?.cancelRequested; }
      return;
    }
    if (modal.kind === 'related') {
      dialog.querySelectorAll('[data-related-id]').forEach(input => { input.disabled = !!modal.relatedSaving; });
      const button = document.getElementById('related-submit');
      if (button) { button.disabled = !!modal.relatedSaving; button.innerHTML = modal.relatedSaving ? `${spinner}Enregistrement…` : 'Enregistrer les liens'; }
      return;
    }
    if (modal.kind !== 'call') return;
    const call = getCall(modal.id, modal.callId);
    if (!call) return;
    const local = ensureCallDraft(modal.id, call);
    const recording = state.recording && state.recording.id === modal.id && state.recording.callId === modal.callId;
    replaceSlot('call-dialog-meta', `${callStatus(call)}${call.synthetic ? '<span class="badge synthetic">Appel synthétique · sans audio</span>' : '<span class="badge">Microphone réel</span>'}<span class="badge">${e((call.participants || []).join(' · '))}</span><span class="badge">${e(duration(local.duration || call.duration_seconds))}</span>`);
    dialog.querySelectorAll('[role="tab"]').forEach(button => {
      button.disabled = !!recording || !!modal.starting || !!modal.canceling || !!modal.saving;
      button.setAttribute('aria-selected', String(button.dataset.tab === modal.tab));
      button.tabIndex = button.dataset.tab === modal.tab ? 0 : -1;
    });
    const notices = [];
    if (modal.starting) notices.push('<div class="loading-bar" role="status">' + spinner + 'Autorisation et préparation du microphone… <button class="text-button" data-action="cancel-start">Annuler</button></div>');
    if (call.synthetic) notices.push('<p class="notice purple">Transcription fictive fournie par le backend. Cet appel n’a pas été enregistré au microphone et ne dispose pas d’audio.</p>');
    if (!call.synthetic && !recording && !local.url && call.status === 'en_cours') notices.push('<p class="notice amber">Aucun audio local disponible dans cette page. Vous pouvez démarrer le microphone sur cet appel ou saisir une transcription manuelle réelle.</p><button class="btn small purple" data-action="resume-microphone">Démarrer le microphone</button>');
    if (call.status === 'processing') notices.push(`<div class="loading-bar" role="status">${spinner}La transcription est enregistrée. Résumé en préparation, puis recalcul des impacts.</div>`);
    if (call.status === 'annule') notices.push('<p class="notice">Appel annulé. Il reste visible pour la traçabilité ; aucun traitement n’est lancé.</p>');
    if (local.note) notices.push(`<p class="notice amber">${e(local.note)}</p>`);
    if (!aiAllowed() && ['en_cours', 'error'].includes(call.status)) notices.push(`<p class="notice amber">${e(aiNotice())} La transcription peut être enregistrée, mais le résumé pourra être en erreur.</p>`);
    replaceSlot('call-dialog-notice', notices.join(''));
    if (!recording) {
      const audio = local.url ? `<div class="audio-preview"><strong class="small">Enregistrement local · ${e(duration(local.duration))}</strong><audio controls preload="metadata" src="${e(local.url)}" aria-label="Écouter l’enregistrement de cet appel"></audio><div class="button-row"><a class="btn small" href="${e(local.url)}" download="${e(String(call.id).replace(/[^a-zA-Z0-9_-]/g, '_'))}.${local.mime.includes('mp4') ? 'm4a' : local.mime.includes('ogg') ? 'ogg' : 'webm'}">${icon('download')}Télécharger l’audio</a></div><p class="audio-caption">Audio conservé uniquement en mémoire dans ce navigateur, non envoyé au serveur. Téléchargez-le avant de recharger ou de quitter la page.</p></div>` : '';
      replaceSlot('call-audio', audio);
    }
    if (!recording && modal.renderedStatus !== call.status) {
      renderCallTab(); return;
    }
    if (modal.tab === 'summary') {
      replaceSlot('call-summary-copy', call.summary ? `${rich(call.summary)}<p class="recognition-note">${call.summary_source === 'mistral' ? 'Résumé généré par l’IA' : 'Résumé synthétique initial'}</p>` : `<p class="muted">${call.status === 'en_cours' ? 'Le résumé sera généré après l’arrêt et la confirmation de la transcription.' : call.status === 'processing' ? 'Le résumé est en cours de génération.' : call.status === 'error' ? 'Le résumé n’a pas pu être généré. Relisez la transcription et relancez le traitement.' : 'Aucun résumé disponible.'}</p>`);
    }
    if (modal.tab === 'chat') updateChat(chatKey(modal.id, modal.callId));
    if (modal.tab === 'transcription' && !recording) {
      const editor = document.getElementById('call-transcript');
      if (editor) {
        editor.readOnly = !!modal.saving || !['en_cours', 'error'].includes(call.status);
        const checkbox = document.getElementById('transcript-confirmed');
        if (checkbox) checkbox.disabled = editor.readOnly;
      } else if (['en_cours', 'error'].includes(call.status) && modal.renderedStatus !== call.status) {
        renderCallTab(); return;
      } else setText('saved-transcript', call.transcript || 'Aucune transcription enregistrée pour cet appel.');
    }
    setText('call-dialog-error', local.error || (call.status === 'error' ? call.error || 'Le traitement a échoué. Relisez la transcription puis réessayez.' : ''));
    replaceSlot('call-dialog-footer', callFooter(modal, call, local));
  }
  async function createCall(id) {
    const modal = state.modal;
    if (modal?.kind !== 'new-call' || modal.id !== id || isBusy('create-call') || modal.blocked) return;
    const titleKey = `call-title|${id}`;
    const snapshot = {...draft(titleKey)};
    const title = snapshot.value.trim() || null;
    const synthetic = (dialog.querySelector('[name="call-mode"]:checked')?.value || 'microphone') === 'synthetic';
    if (title && title.length > 180) { setText('new-call-error', 'Le titre ne peut pas dépasser 180 caractères.'); return; }
    if (!synthetic && (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')) {
      setText('new-call-error', 'Enregistrement indisponible : utilisez HTTPS ou localhost et un navigateur compatible. L’option synthétique est une démonstration distincte.'); return;
    }
    const session = {id, callId: null, cancelRequested: false};
    state.startingCall = session; state.busy.add('create-call'); modal.starting = true; setText('new-call-error', ''); updateModal();
    try {
      const {data, ticket} = await api(`${incidentPath(id)}/calls`, {title, synthetic});
      if (!data.call?.id || !data.incident) throw new RequestError('Réponse de création d’appel invalide.');
      cacheIncident(data.incident, ticket); session.callId = data.call.id;
      ensureCallDraft(id, data.call); clearSubmittedDraft(titleKey, snapshot);
      openCall(id, data.call.id, 'transcription', true);
      if (session.cancelRequested) { state.startingCall = null; await cancelCall(id, data.call.id); return; }
      if (synthetic) { state.startingCall = null; toast('Appel synthétique créé. Relisez le texte fictif fourni par le backend avant de confirmer.'); }
      else {
        state.modal.starting = true; updateModal();
        await startMicrophone(id, data.call.id, session);
      }
    } catch (error) {
      if (session.callId) await microphoneFailed(id, session.callId, error);
      else {
        if (state.modal === modal) setText('new-call-error', error.message);
        if (error.uncertain || error.status === 409) { await reconcile(id); if (error.uncertain) toast('Création non confirmée. Vérifiez le fil et annulez tout appel incomplet avant de réessayer.', true); }
      }
    } finally {
      if (state.startingCall === session) state.startingCall = null;
      state.busy.delete('create-call'); modal.starting = false;
      if (state.modal?.kind === 'call' && state.modal.id === id && state.modal.callId === session.callId) state.modal.starting = false;
      refreshUI();
    }
  }
  async function finishCall(id, callId) {
    const call = getCall(id, callId);
    const key = `finish|${callKey(id, callId)}`;
    if (!call || !['en_cours', 'error'].includes(call.status) || isBusy(key) || recordingLocked()) return;
    const local = ensureCallDraft(id, call);
    const transcript = draft(local.transcriptKey).value.trim();
    if (!local.confirmed || !transcript || transcript.length > 60000) {
      local.error = 'Relisez une transcription non vide (60 000 caractères maximum), puis cochez la confirmation.'; updateModal(); return;
    }
    const modal = state.modal?.kind === 'call' && state.modal.id === id && state.modal.callId === callId ? state.modal : null;
    state.busy.add(key); local.error = ''; if (modal) modal.saving = true; updateModal();
    try {
      const {data, ticket} = await api(`${callPath(id, callId)}/finish`, {transcript, duration_seconds: Math.min(14400, Math.max(0, Math.round(local.duration)))});
      cacheIncident(data, ticket); local.phase = 'saved';
      toast('Transcription enregistrée. Résumé et impacts en cours de traitement.');
    } catch (error) { local.error = error.message; if (error.uncertain || error.status === 409) await reconcile(id); }
    finally { state.busy.delete(key); if (modal) modal.saving = false; refreshUI(); }
  }
  function discardCallDraft(id, callId) {
    const key = callKey(id, callId);
    const local = state.callDrafts.get(key);
    if (!local) return;
    if (local.url) URL.revokeObjectURL(local.url);
    local.url = ''; local.blob = null; local.phase = 'cancelled'; local.confirmed = false;
    setDraft(local.transcriptKey, '');
    if (state.modal?.id === id && state.modal?.callId === callId) {
      const editor = document.getElementById('call-transcript');
      if (editor) editor.value = '';
    }
  }
  async function cancelCall(id, callId) {
    const call = getCall(id, callId);
    const key = `cancel|${callKey(id, callId)}`;
    if (!call || isBusy(key) || isBusy(`finish|${callKey(id, callId)}`)) return;
    const modal = state.modal?.kind === 'call' && state.modal.id === id && state.modal.callId === callId ? state.modal : null;
    const local = ensureCallDraft(id, call);
    if (!['en_cours', 'error'].includes(call.status)) { local.error = 'Un appel terminé ou en traitement ne peut pas être annulé.'; updateModal(); return; }
    state.busy.add(key); if (modal) modal.canceling = true; local.error = ''; updateModal();
    if (state.startingCall?.id === id && state.startingCall.callId === callId) state.startingCall.cancelRequested = true;
    if (state.recording?.id === id && state.recording.callId === callId) {
      const recording = state.recording; tearDownCapture(recording); state.recording = null;
    }
    try {
      const {data, ticket} = await api(`${callPath(id, callId)}/cancel`, {});
      cacheIncident(data, ticket); discardCallDraft(id, callId); local.note = 'Appel annulé. Les ressources microphone et le brouillon audio local ont été libérés.';
      if (modal && state.modal === modal) renderCallTab();
      toast('Appel annulé. Microphone libéré et audio local supprimé.');
    } catch (error) {
      local.error = `Le microphone est arrêté, mais l’annulation serveur a échoué : ${error.message}`;
      local.phase = 'review'; if (error.uncertain || error.status === 409) await reconcile(id);
      if (modal && state.modal === modal) renderCallTab();
    } finally { state.busy.delete(key); if (modal) { modal.canceling = false; modal.starting = false; } refreshUI(); }
  }
  async function microphoneFailed(id, callId, error) {
    if (state.recording?.id === id && state.recording.callId === callId) { tearDownCapture(state.recording); state.recording = null; }
    if (state.startingCall?.id === id && state.startingCall.callId === callId) state.startingCall = null;
    const call = getCall(id, callId);
    const local = call ? ensureCallDraft(id, call) : null;
    const reason = error.name === 'NotAllowedError' ? 'Autorisation du microphone refusée.' : error.name === 'NotFoundError' ? 'Aucun microphone détecté.' : error.name === 'NotReadableError' ? 'Microphone inaccessible ou utilisé par une autre application.' : error.message || 'Le microphone a échoué.';
    if (state.modal?.kind === 'call') state.modal.starting = false;
    if (call && ['en_cours', 'error'].includes(call.status)) await cancelCall(id, callId);
    if (local) local.note = `${reason} ${getCall(id, callId)?.status === 'annule' ? 'L’appel incomplet a été annulé côté serveur.' : 'L’appel doit encore être annulé côté serveur ; utilisez Annuler l’appel pour réessayer.'} Aucun audio ni aucune transcription fictive n’a été créé.`;
    toast(local?.note || reason, true); updateModal();
  }
  async function resumeMicrophone() {
    const modal = state.modal;
    if (modal?.kind !== 'call' || recordingLocked() || modalBusy()) return;
    const call = getCall(modal.id, modal.callId);
    if (!call || call.synthetic || call.status !== 'en_cours') return;
    const session = {id: modal.id, callId: modal.callId, cancelRequested: false};
    state.startingCall = session; modal.starting = true; modal.tab = 'transcription'; renderCallTab(); updateModal();
    try { await startMicrophone(modal.id, modal.callId, session); }
    catch (error) { await microphoneFailed(modal.id, modal.callId, error); }
    finally { if (state.startingCall === session) state.startingCall = null; modal.starting = false; refreshUI(); }
  }
  async function handleDialogAction(button) {
    const action = button.dataset.action;
    const modal = state.modal;
    if (action === 'new-call') openNewCall(button.dataset.id);
    else if (action === 'open-call') openCall(button.dataset.id, button.dataset.call);
    else if (['join-call', 'end-call'].includes(action)) {
      const call = getCall(button.dataset.id, button.dataset.call);
      if (call?.status === 'en_cours') openCall(button.dataset.id, button.dataset.call, 'transcription');
    }
    else if (action === 'related') openRelated(button.dataset.id);
    else if (action === 'open-history') openHistory(button.dataset.id, button.dataset.history);
    else if (action === 'close-dialog') closeDialog();
    else if (action === 'call-tab' && modal?.kind === 'call' && !recordingLocked() && !modalBusy()) { modal.tab = button.dataset.tab; renderCallTab(); }
    else if (action === 'review-transcript' && modal?.kind === 'call' && !recordingLocked()) { modal.tab = 'transcription'; renderCallTab(); }
    else if (action === 'stop-recording') await stopRecording();
    else if (action === 'resume-microphone') await resumeMicrophone();
    else if (action === 'cancel-start') {
      const session = state.startingCall;
      if (session) {
        session.cancelRequested = true;
        if (session.callId) await cancelCall(session.id, session.callId);
        else setText('new-call-error', 'Annulation demandée. L’appel sera annulé dès la réponse du serveur.');
        updateModal();
      }
    } else if (action === 'cancel-call' && modal?.kind === 'call') await cancelCall(modal.id, modal.callId);
  }
  async function handleDialogSubmit(form) {
    if (form.dataset.form === 'new-call') await createCall(form.dataset.incident);
    else if (form.dataset.form === 'related') await saveRelated(form.dataset.incident);
    else if (form.dataset.form === 'finish-call') await finishCall(form.dataset.incident, form.dataset.call);
  }
  dialog.addEventListener('change', event => {
    if (event.target.id !== 'transcript-confirmed' || state.modal?.kind !== 'call') return;
    const local = state.callDrafts.get(callKey(state.modal.id, state.modal.callId));
    if (local) { local.confirmed = event.target.checked; local.error = ''; updateModal(); }
  });

  function releaseTracks(stream) {
    stream?.getTracks().forEach(track => { try { track.stop(); } catch (_) { /* Track already stopped. */ } });
  }
  function recognitionFallback(recording, message) {
    recording.manual = true;
    recording.recognitionNote = `${message} L’audio réel continue d’être enregistré. Saisissez ou collez une transcription manuelle avant de confirmer ; aucun texte n’est inventé.`;
    clearTimeout(recording.restartTimer);
    try { recording.recognition?.abort(); } catch (_) { /* Recognition already stopped. */ }
    setText('recognition-note', recording.recognitionNote);
  }
  function liveRecognitionText(recording) {
    const finals = [...recording.finalSegments.values()].join(' ').trim();
    setText('live-transcript', [finals, recording.interim].filter(Boolean).join(' ') || 'En attente de paroles reconnues. Vous pouvez saisir une transcription manuelle ci-dessous.');
    const node = document.getElementById('live-transcript');
    if (node) node.scrollTop = node.scrollHeight;
  }
  function startRecognition(recording) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { recognitionFallback(recording, 'Reconnaissance vocale indisponible dans ce navigateur (SpeechRecognition non pris en charge).'); return; }
    try {
      const recognition = new Recognition();
      recording.recognition = recognition;
      recognition.lang = 'fr-FR'; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
      let generation = 0;
      recognition.onstart = () => { generation += 1; recording.recognitionActive = true; };
      recognition.onresult = event => {
        if (recording.discard || recording.manual) return;
        const interim = [];
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = String(result[0]?.transcript || '').trim();
          if (result.isFinal && text) recording.finalSegments.set(`${generation}:${index}`, text);
          else if (text) interim.push(text);
        }
        recording.interim = interim.join(' '); recording.silentEnds = 0;
        liveRecognitionText(recording);
      };
      recognition.onerror = event => {
        if (recording.discard || recording.stopping || event.error === 'aborted') return;
        const reasons = {
          'not-allowed': 'Autorisation de reconnaissance vocale refusée.',
          'service-not-allowed': 'Le service vocal du navigateur est indisponible.',
          network: 'Le service vocal du navigateur ne répond pas (erreur réseau).',
          'audio-capture': 'Le service vocal ne peut pas accéder au microphone.',
          'language-not-supported': 'Le service vocal ne prend pas en charge le français fr-FR.'
        };
        if (event.error === 'no-speech') {
          setText('recognition-note', 'Aucune parole détectée. L’enregistrement audio continue ; une saisie manuelle reste possible.');
        } else recognitionFallback(recording, reasons[event.error] || `Reconnaissance vocale interrompue (${String(event.error || 'erreur inconnue')}).`);
      };
      recognition.onend = () => {
        recording.recognitionActive = false;
        recording.resolveRecognitionEnd?.();
        if (recording.discard || recording.stopping || recording.manual || state.recording !== recording) return;
        recording.silentEnds += 1;
        if (recording.silentEnds > 4) { recognitionFallback(recording, 'Le moteur vocal s’est arrêté plusieurs fois.'); return; }
        recording.restartTimer = setTimeout(() => {
          if (recording.discard || recording.stopping || recording.manual || state.recording !== recording) return;
          try { recognition.start(); } catch (_) { recognitionFallback(recording, 'La reconnaissance vocale ne peut pas redémarrer.'); }
        }, 400);
      };
      recognition.start();
      setText('recognition-note', 'Reconnaissance du navigateur en français (fr-FR). Les résultats sont provisoires et doivent être relus. Une saisie manuelle peut être ajoutée ci-dessous.');
    } catch (_) { recognitionFallback(recording, 'Impossible de démarrer la reconnaissance vocale du navigateur.'); }
  }
  async function startMicrophone(id, callId, session) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !window.isSecureContext) throw new Error('Le microphone nécessite HTTPS ou localhost et MediaRecorder.');
    let expired = false;
    let permissionTimer;
    const acquisition = navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
      if (expired || session.cancelRequested || state.startingCall !== session) { releaseTracks(stream); return null; }
      return stream;
    });
    let stream;
    try {
      stream = await Promise.race([acquisition, new Promise((_, reject) => {
        permissionTimer = setTimeout(() => { expired = true; reject(new Error('L’autorisation du microphone n’a pas été reçue après 30 secondes. Réessayez après vérification des permissions.')); }, 30000);
      })]);
    } finally { clearTimeout(permissionTimer); }
    if (!stream || session.cancelRequested || getCall(id, callId)?.status !== 'en_cours') {
      releaseTracks(stream);
      if (getCall(id, callId)?.status === 'en_cours') await cancelCall(id, callId);
      return;
    }
    const call = getCall(id, callId);
    const local = ensureCallDraft(id, call);
    let recorder;
    try {
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported?.(type));
      recorder = mime ? new MediaRecorder(stream, {mimeType: mime}) : new MediaRecorder(stream);
    } catch (error) { releaseTracks(stream); throw error; }
    const recording = {id, callId, stream, recorder, chunks: [], started: performance.now(), stopping: false,
      discard: false, manual: false, finalSegments: new Map(), interim: '', silentEnds: 0,
      recognitionActive: false, recognition: null, recognitionNote: '', restartTimer: null, timer: null,
      audioDone: null, resolveAudio: null, resolveRecognitionEnd: null};
    recording.audioDone = new Promise(resolve => { recording.resolveAudio = resolve; });
    recorder.ondataavailable = event => { if (!recording.discard && event.data?.size) recording.chunks.push(event.data); };
    recorder.onstop = () => {
      recording.resolveAudio();
      if (!recording.stopping && !recording.discard && state.recording === recording) void stopRecording();
    };
    recorder.onerror = event => {
      if (!recording.discard) void microphoneFailed(id, callId, event.error || new Error('L’enregistrement du microphone a échoué.'));
    };
    stream.getTracks().forEach(track => track.addEventListener('ended', () => {
      if (!recording.stopping && !recording.discard && state.recording === recording) void microphoneFailed(id, callId, new Error('Le microphone a été déconnecté pendant l’enregistrement.'));
    }));
    state.recording = recording;
    local.phase = 'recording'; local.confirmed = false; local.error = ''; local.note = '';
    if (state.modal?.kind === 'call') { state.modal.starting = false; state.modal.tab = 'transcription'; }
    const panel = document.getElementById('call-tab-content');
    panel.innerHTML = `<div class="recording-panel"><div class="recording-heading"><strong><span class="record-indicator" aria-hidden="true"></span>Microphone en cours d’enregistrement</strong><span id="recording-clock">0 s</span></div><div id="live-transcript" aria-label="Transcription vocale provisoire">En attente de paroles reconnues…</div><p id="recognition-note" class="recognition-note"></p></div><label for="recording-manual">Transcription ou notes manuelles (facultatif pendant l’enregistrement)</label><textarea id="recording-manual" class="transcript-editor" data-draft="${e(local.transcriptKey)}" maxlength="60000" placeholder="Si la reconnaissance est indisponible, saisissez ici la transcription réelle. Ces notes seront conservées avec les paroles reconnues."></textarea><p class="draft-note">Arrêtez d’abord l’enregistrement. Les derniers résultats vocaux seront attendus avant la relecture et la confirmation.</p>`;
    hydrateDrafts(panel);
    try { recorder.start(1000); } catch (error) { tearDownCapture(recording); state.recording = null; throw error; }
    state.startingCall = null;
    startRecognition(recording);
    recording.timer = setInterval(() => {
      const elapsed = Math.floor((performance.now() - recording.started) / 1000);
      setText('recording-clock', duration(elapsed));
      if (elapsed >= 14400 && !recording.stopping) { local.note = 'La limite de quatre heures est atteinte. Relisez la transcription avant de confirmer.'; void stopRecording(); }
    }, 1000);
    updateModal(); refreshUI();
    document.getElementById('stop-recording')?.focus({preventScroll: true});
  }
  function waitFor(promise, milliseconds) {
    let timer;
    return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]).finally(() => clearTimeout(timer));
  }
  async function stopRecording() {
    const recording = state.recording;
    if (!recording || recording.stopping || recording.discard) return;
    recording.stopping = true; clearInterval(recording.timer); clearTimeout(recording.restartTimer);
    const local = state.callDrafts.get(callKey(recording.id, recording.callId));
    local.duration = Math.min(14400, Math.round((performance.now() - recording.started) / 1000));
    updateModal();
    try {
      if (recording.recorder.state !== 'inactive') recording.recorder.stop();
      const audioFinished = await waitFor(recording.audioDone.then(() => true), 5000);
      releaseTracks(recording.stream);
      if (!audioFinished) local.note = 'Le navigateur n’a pas confirmé la finalisation audio. Vérifiez la lecture et la transcription avant de terminer.';
      if (recording.recognition && !recording.manual) {
        const recognitionEnded = new Promise(resolve => { recording.resolveRecognitionEnd = () => resolve(true); });
        try { recording.recognition.stop(); } catch (_) { recording.resolveRecognitionEnd(); }
        const ended = await waitFor(recognitionEnded, 3500);
        if (!ended) {
          local.note = 'Le moteur vocal n’a pas confirmé ses derniers résultats. Les paroles finales déjà reçues sont conservées ; complétez manuellement les passages manquants.';
          try { recording.recognition.abort(); } catch (_) { /* Recognition already stopped. */ }
        }
      }
      if (recording.discard || state.recording !== recording) return;
      const manual = draft(local.transcriptKey).value.trim();
      const recognized = [...recording.finalSegments.values()].join(' ').trim();
      const transcript = [manual, recognized].filter(Boolean).join('\n\n');
      setDraft(local.transcriptKey, transcript);
      local.confirmed = false; local.phase = 'review';
      if (recording.manual) local.note = recording.recognitionNote;
      if (recording.chunks.length) {
        if (local.url) URL.revokeObjectURL(local.url);
        local.mime = recording.recorder.mimeType || recording.chunks[0].type || 'audio/webm';
        local.blob = new Blob(recording.chunks, {type: local.mime});
        local.url = URL.createObjectURL(local.blob);
      } else local.note = 'Aucune donnée audio n’a été fournie par le navigateur. Saisissez une transcription manuelle réelle ou annulez cet appel.';
      tearDownCapture(recording, false); state.recording = null;
      if (state.modal?.kind === 'call' && state.modal.id === recording.id && state.modal.callId === recording.callId) { state.modal.tab = 'transcription'; renderCallTab(); }
      refreshUI(); toast('Enregistrement arrêté. Relisez et confirmez la transcription avant de terminer l’appel.');
      document.getElementById('call-transcript')?.focus({preventScroll: true});
    } catch (error) { await microphoneFailed(recording.id, recording.callId, error); }
  }
  function tearDownCapture(recording, discard = true) {
    if (!recording) return;
    recording.discard = true;
    clearInterval(recording.timer); clearTimeout(recording.restartTimer);
    try { if (recording.recorder.state !== 'inactive') recording.recorder.stop(); } catch (_) { /* Recorder already stopped. */ }
    try { recording.recognition?.abort(); } catch (_) { /* Recognition already stopped. */ }
    releaseTracks(recording.stream);
    recording.resolveAudio?.(); recording.resolveRecognitionEnd?.();
    if (discard) recording.chunks.length = 0;
  }
  function cancelOnExit(id, callId) {
    try {
      const body = new Blob(['{}'], {type: 'application/json'});
      if (navigator.sendBeacon?.(`${callPath(id, callId)}/cancel`, body)) return;
      void fetch(`${callPath(id, callId)}/cancel`, {method: 'POST', credentials: 'same-origin', keepalive: true, headers: {'Content-Type': 'application/json'}, body: '{}'}).catch(() => {});
    } catch (_) { /* The server also recovers interrupted microphone calls on restart. */ }
  }
  window.addEventListener('beforeunload', event => {
    const recording = state.recording;
    const starting = state.startingCall;
    const unsaved = [...state.callDrafts.values()].some(local => local.phase === 'review' && (local.url || draft(local.transcriptKey).value.trim()));
    if (recording || starting || unsaved) { event.preventDefault(); event.returnValue = ''; }
    if (recording) {
      tearDownCapture(recording); state.recording = null; cancelOnExit(recording.id, recording.callId);
      const local = state.callDrafts.get(callKey(recording.id, recording.callId));
      if (local) { local.phase = 'review'; local.note = 'Le microphone a été arrêté lors de la tentative de sortie. Vérifiez le statut serveur avant de reprendre.'; }
      if (state.modal?.kind === 'call') renderCallTab();
      void reconcile(recording.id);
    }
    if (starting) { starting.cancelRequested = true; if (starting.callId) cancelOnExit(starting.id, starting.callId); }
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(state.pollTimer);
    if (state.recording) { cancelOnExit(state.recording.id, state.recording.callId); tearDownCapture(state.recording); state.recording = null; }
    state.callDrafts.forEach(local => { if (local.url) URL.revokeObjectURL(local.url); local.url = ''; local.blob = null; });
  });

  async function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (button.disabled) return;
    if (action === 'overview') await navigate('overview');
    else if (action === 'incidents') await navigate('incidents');
    else if (action === 'open-incident') await navigate('detail', id);
    else if (action === 'reload-config' || action === 'refresh-data') await load(true);
    else if (action === 'dismiss-toast') document.getElementById('toast-region').replaceChildren();
    else if (action === 'summary') await incidentAI(id, 'summary');
    else if (action === 'retry-impact') await incidentAI(id, 'impact');
    else if (action === 'suggestion') {
      const key = chatKey(id); setDraft(key, button.dataset.question);
      const field = document.getElementById('incident-question');
      if (field) { field.value = draft(key).value; field.focus(); }
    } else if (action === 'retry-chat') {
      const [, incidentId, callId] = button.dataset.chatKey.split('|');
      await sendChat(incidentId, callId, true);
    } else await handleDialogAction(button);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]') || event.target.closest('[data-incident-row]')?.querySelector('[data-action="open-incident"]');
    if (button) { event.preventDefault(); void handleAction(button).catch(error => toast(error.message || 'Action impossible.', true)); }
    const brand = event.target.closest('.brand');
    if (brand) { event.preventDefault(); void navigate('overview'); }
  });
  document.addEventListener('input', event => {
    const key = event.target.dataset.draft;
    if (!key) return;
    setDraft(key, event.target.value);
    if (key === 'overview-search') updateOverview();
    if (key.startsWith('transcript|')) syncTranscriptDraft(key);
  });
  document.addEventListener('change', event => {
    const key = event.target.dataset.draft;
    if (key === 'overview-severity') { setDraft(key, event.target.value); updateOverview(); }
    if (event.target.matches('[data-related-id]')) syncRelatedDraft();
    if (event.target.name === 'call-mode') syncNewCallMode();
  });
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!form.dataset.form) return;
    event.preventDefault();
    const work = form.dataset.form === 'message' ? sendMessage(form.dataset.incident) :
      form.dataset.form === 'chat' ? sendChat(form.dataset.incident, form.dataset.call) : handleDialogSubmit(form);
    void Promise.resolve(work).catch(error => toast(error.message || 'Envoi impossible.', true));
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.closest('form')) {
      event.preventDefault(); event.target.closest('form').requestSubmit();
    }
  });
  document.addEventListener('compositionstart', () => { state.composing = true; });
  document.addEventListener('compositionend', () => {
    state.composing = false;
    if (state.refreshPending) { state.refreshPending = false; refreshUI(); }
  });
  window.addEventListener('hashchange', () => {
    if (recordingLocked()) {
      history.replaceState(null, '', state.view === 'detail' ? `#incident/${encodeURIComponent(state.activeId)}` : `#${state.view}`);
      toast('La navigation est verrouillée pendant l’enregistrement.', true);
    } else void routeFromHash();
  });
  window.addEventListener('online', () => { void load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && hasBackgroundWork() && !state.polling) { clearTimeout(state.pollTimer); void poll(); } });
  function tick() { setText('clock', formatted(new Date().toISOString())); }
  document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
  tick(); setInterval(tick, 30000);
  void load().then(() => routeFromHash()).catch(error => toast(error.message, true));
})();
