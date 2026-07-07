/* =========================================================================
   FocusDeck — script.js
   All dashboard logic: theme, dynamic sky background, clock, navigation,
   todo list, daily planner, motivation quote, pomodoro timer, weather,
   and daily goals. Each module is self-contained and persists via
   Local Storage where noted in the project documentation.
   ========================================================================= */

/* ---------------------------------------------------------------
   THEME SWITCH
   Applied as early as possible (see inline head script) to avoid
   a flash of the wrong theme; this module wires up the toggle.
--------------------------------------------------------------- */
const ThemeModule = (() => {
  const root = document.documentElement;
  const toggleBtn = document.getElementById('theme-toggle');

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('focusdeck-theme', theme);
    if (toggleBtn) toggleBtn.setAttribute('aria-checked', theme === 'dark');
  }

  function init() {
    // Theme was already applied synchronously in <head>; just sync the control.
    const current = root.getAttribute('data-theme') || 'dark';
    if (toggleBtn) toggleBtn.setAttribute('aria-checked', current === 'dark');

    toggleBtn?.addEventListener('click', () => {
      const now = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      apply(now);
    });
  }

  return { init };
})();

/* ---------------------------------------------------------------
   DYNAMIC BACKGROUND
   Picks a sky gradient based on the current hour and re-checks
   periodically in case the app stays open across a time boundary.
--------------------------------------------------------------- */
const SkyModule = (() => {
  const sky = document.getElementById('sky-bg');
  const CATEGORIES = [
    { name: 'dawn', from: 5, to: 8 },
    { name: 'morning', from: 8, to: 12 },
    { name: 'afternoon', from: 12, to: 17 },
    { name: 'evening', from: 17, to: 20 },
    { name: 'night', from: 20, to: 29 }, // wraps past midnight (20..24 + 0..5 handled below)
  ];

  function categoryForHour(hour) {
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 20) return 'evening';
    return 'night'; // covers 20-23 and 0-4, no gaps across all 24 hours
  }

  function update() {
    const hour = new Date().getHours();
    const cat = categoryForHour(hour);
    ['dawn', 'morning', 'afternoon', 'evening', 'night'].forEach((c) =>
      sky.classList.remove(`sky-${c}`)
    );
    sky.classList.add(`sky-${cat}`);
  }

  function init() {
    update();
    setInterval(update, 5 * 60 * 1000); // re-check every 5 minutes
  }

  return { init };
})();

/* ---------------------------------------------------------------
   DATE & TIME (live digital clock in topbar)
--------------------------------------------------------------- */
const ClockModule = (() => {
  const timeEl = document.getElementById('digital-time');
  const dateEl = document.getElementById('digital-date');

  function pad(n) { return n.toString().padStart(2, '0'); }

  function tick() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();

    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    if (timeEl) timeEl.textContent = `${hour12}:${pad(m)}:${pad(s)} ${ampm}`;
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      });
    }
  }

  function init() {
    tick(); // run immediately so it doesn't wait a full second to appear
    setInterval(tick, 1000);
  }

  return { init };
})();

/* ---------------------------------------------------------------
   DASHBOARD NAVIGATION
   Tracks which section is active so features never overlap, and
   guards against rapid double-clicks opening two views at once.
--------------------------------------------------------------- */
const NavModule = (() => {
  const dashboard = document.getElementById('dashboard');
  const featureViews = document.querySelectorAll('.feature-view');
  let activeView = null;
  let isTransitioning = false;

  function openFeature(name) {
    if (isTransitioning || activeView === name) return;
    isTransitioning = true;
    const view = document.getElementById(`feature-${name}`);
    if (!view) { isTransitioning = false; return; }

    dashboard.setAttribute('hidden', '');
    featureViews.forEach((v) => v.setAttribute('hidden', ''));
    view.removeAttribute('hidden');
    activeView = name;

    const heading = view.querySelector('h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });

    document.dispatchEvent(new CustomEvent('feature:opened', { detail: { name } }));

    requestAnimationFrame(() => { isTransitioning = false; });
  }

  function closeFeature() {
    if (isTransitioning) return;
    featureViews.forEach((v) => v.setAttribute('hidden', ''));
    dashboard.removeAttribute('hidden');
    activeView = null;
  }

  function init() {
    document.querySelectorAll('[data-open-feature]').forEach((card) => {
      card.addEventListener('click', () => openFeature(card.dataset.openFeature));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openFeature(card.dataset.openFeature);
        }
      });
    });

    document.querySelectorAll('[data-close-feature]').forEach((btn) => {
      btn.addEventListener('click', closeFeature);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeView) closeFeature();
    });
  }

  return { init };
})();

/* ---------------------------------------------------------------
   Shared storage helpers
--------------------------------------------------------------- */
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — fail silently, app still works this session */
  }
}
function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------------------------------------------------------
   TODO LIST
--------------------------------------------------------------- */
const TodoModule = (() => {
  const STORAGE_KEY = 'focusdeck-todos';
  const input = document.getElementById('todo-input');
  const addBtn = document.getElementById('todo-add');
  const list = document.getElementById('todo-list');
  let todos = loadJSON(STORAGE_KEY, []);

  function persist() { saveJSON(STORAGE_KEY, todos); }

  function render() {
    list.innerHTML = '';
    if (todos.length === 0) {
      list.innerHTML = `<li class="empty-state">Nothing on your list yet — add your first task above.</li>`;
      return;
    }
    // important + incomplete first, then by original order
    const sorted = [...todos].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.important !== b.important) return a.important ? -1 : 1;
      return 0;
    });

    sorted.forEach((todo) => {
      const li = document.createElement('li');
      li.className = `list-item${todo.completed ? ' completed' : ''}`;
      li.dataset.id = todo.id;
      li.innerHTML = `
        <button class="check-circle" data-action="complete" aria-label="Mark complete">${todo.completed ? '✓' : ''}</button>
        <span class="item-text">${escapeHTML(todo.text)}</span>
        <button class="icon-btn star${todo.important ? ' active' : ''}" data-action="important" aria-label="Mark important" title="Mark important">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9L6 21l1.7-7L2.3 9.2l7.1-.6z"/></svg>
        </button>
        <button class="icon-btn delete" data-action="delete" aria-label="Delete task" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v13a1 1 0 01-1 1H8a1 1 0 01-1-1V7"/></svg>
        </button>
      `;
      list.appendChild(li);
    });
  }

  function addTodo() {
    const text = input.value.trim();
    if (!text) return;
    todos.push({ id: uid(), text, completed: false, important: false });
    persist();
    render();
    input.value = '';
    input.focus();
  }

  function handleListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const li = e.target.closest('.list-item');
    const id = li?.dataset.id;
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;

    if (btn.dataset.action === 'complete') todo.completed = !todo.completed;
    if (btn.dataset.action === 'important') todo.important = !todo.important;
    if (btn.dataset.action === 'delete') todos = todos.filter((t) => t.id !== id);

    persist();
    render();
  }

  function init() {
    render();
    addBtn.addEventListener('click', addTodo);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });
    list.addEventListener('click', handleListClick);
  }

  return { init };
})();

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------------------------------------------
   DAILY PLANNER
   Hourly slots from 6:00 to 22:00. Saves on a short debounce so we
   are not hammering Local Storage on every keystroke.
--------------------------------------------------------------- */
const PlannerModule = (() => {
  const STORAGE_KEY = 'focusdeck-planner';
  const container = document.getElementById('planner-list');
  const START_HOUR = 6;
  const END_HOUR = 22;
  let data = loadJSON(STORAGE_KEY, {});
  let debounceTimer = null;

  function formatHour(h) {
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    return `${hour12}:00 ${ampm}`;
  }

  function render() {
    container.innerHTML = '';
    const currentHour = new Date().getHours();
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const row = document.createElement('div');
      row.className = `planner-row${h === currentHour ? ' current-hour' : ''}`;
      row.innerHTML = `
        <span class="planner-time">${formatHour(h)}</span>
        <input type="text" class="planner-input" data-hour="${h}"
          placeholder="What's happening?" value="${escapeHTML(data[h] || '')}" />
      `;
      container.appendChild(row);
    }
  }

  function handleInput(e) {
    const field = e.target.closest('.planner-input');
    if (!field) return;
    const hour = field.dataset.hour;
    const value = field.value;
    if (value.trim() === '') {
      delete data[hour];
    } else {
      data[hour] = value;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => saveJSON(STORAGE_KEY, data), 400);
  }

  function init() {
    render();
    container.addEventListener('input', handleInput);
    // Keep the "current hour" highlight accurate if the planner stays open.
    setInterval(() => {
      const currentHour = new Date().getHours();
      container.querySelectorAll('.planner-row').forEach((row, idx) => {
        row.classList.toggle('current-hour', START_HOUR + idx === currentHour);
      });
    }, 60 * 1000);
  }

  return { init };
})();

/* ---------------------------------------------------------------
   MOTIVATION QUOTE
   Uses the Fetch API against a public quote service. If the
   network call fails (offline, CORS, service down) we fall back
   to a small local collection so the card never breaks.
--------------------------------------------------------------- */
const QuoteModule = (() => {
  const textEl = document.getElementById('quote-text');
  const authorEl = document.getElementById('quote-author');
  const errorEl = document.getElementById('quote-error');
  const newBtn = document.getElementById('quote-new');

  const FALLBACK_QUOTES = [
    { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { text: 'Well begun is half done.', author: 'Aristotle' },
    { text: 'Small deeds done are better than great deeds planned.', author: 'Peter Marshall' },
    { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
    { text: 'Discipline is choosing between what you want now and what you want most.', author: 'Abraham Lincoln' },
    { text: 'Action is the foundational key to all success.', author: 'Pablo Picasso' },
    { text: 'You do not have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
  ];
  let lastIndex = -1;

  function pickFallback() {
    let idx = Math.floor(Math.random() * FALLBACK_QUOTES.length);
    if (FALLBACK_QUOTES.length > 1 && idx === lastIndex) {
      idx = (idx + 1) % FALLBACK_QUOTES.length;
    }
    lastIndex = idx;
    return FALLBACK_QUOTES[idx];
  }

  function setLoading() {
    textEl.classList.add('loading');
    textEl.textContent = 'Fetching a fresh quote…';
    authorEl.textContent = '';
    errorEl.hidden = true;
  }

  function display({ text, author }) {
    textEl.classList.remove('loading');
    textEl.textContent = text;
    authorEl.textContent = author ? `— ${author}` : '';
  }

  async function fetchQuote() {
    setLoading();
    newBtn.disabled = true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch('https://api.quotable.io/random', { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('Bad response');
      const data = await res.json();
      if (!data.content) throw new Error('Malformed response');
      errorEl.hidden = true;
      display({ text: data.content, author: data.author });
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = 'Could not reach the quote service — showing one from the local collection instead.';
      display(pickFallback());
    } finally {
      newBtn.disabled = false;
    }
  }

  function init() {
    newBtn.addEventListener('click', fetchQuote);
    document.addEventListener('feature:opened', (e) => {
      if (e.detail.name === 'quote' && textEl.textContent.trim() === '') fetchQuote();
    });
    // Load one immediately so the dashboard doesn't feel empty.
    fetchQuote();
  }

  return { init };
})();

/* ---------------------------------------------------------------
   POMODORO TIMER
--------------------------------------------------------------- */
const PomodoroModule = (() => {
  const readout = document.getElementById('timer-readout');
  const sessionLabel = document.getElementById('session-label');
  const ringProgress = document.getElementById('timer-ring-progress');
  const startBtn = document.getElementById('timer-start');
  const pauseBtn = document.getElementById('timer-pause');
  const resetBtn = document.getElementById('timer-reset');
  const workInput = document.getElementById('work-duration');
  const breakInput = document.getElementById('break-duration');

  const RADIUS = 108;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  ringProgress.style.strokeDasharray = `${CIRCUMFERENCE}`;

  let session = 'work'; // 'work' | 'break'
  let workSeconds = 25 * 60;
  let breakSeconds = 5 * 60;
  let remaining = workSeconds;
  let intervalId = null;

  function pad(n) { return n.toString().padStart(2, '0'); }

  function render() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    readout.textContent = `${pad(m)}:${pad(s)}`;
    sessionLabel.textContent = session === 'work' ? 'Work Session' : 'Break';

    const total = session === 'work' ? workSeconds : breakSeconds;
    const fraction = total > 0 ? remaining / total : 0;
    const offset = CIRCUMFERENCE * (1 - fraction);
    ringProgress.style.strokeDashoffset = `${offset}`;
  }

  function notifyEnd() {
    // Gentle in-app notification — no audio autoplay surprises.
    sessionLabel.textContent = session === 'work' ? 'Work session complete!' : 'Break complete!';
    if (window.Notification && Notification.permission === 'granted') {
      try { new Notification('FocusDeck', { body: sessionLabel.textContent }); } catch { /* ignore */ }
    }
    document.title = `⏰ ${sessionLabel.textContent} — FocusDeck`;
    setTimeout(() => { document.title = 'FocusDeck'; }, 4000);
  }

  function switchSession() {
    session = session === 'work' ? 'break' : 'work';
    remaining = session === 'work' ? workSeconds : breakSeconds;
  }

  function tick() {
    remaining -= 1;
    if (remaining <= 0) {
      notifyEnd();
      switchSession();
      render();
      return;
    }
    render();
  }

  function start() {
    if (intervalId) return; // guard against multiple intervals
    intervalId = setInterval(tick, 1000);
    startBtn.disabled = true;
    pauseBtn.disabled = false;
  }

  function pause() {
    clearInterval(intervalId);
    intervalId = null;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
  }

  function reset() {
    pause();
    session = 'work';
    workSeconds = (parseInt(workInput.value, 10) || 25) * 60;
    breakSeconds = (parseInt(breakInput.value, 10) || 5) * 60;
    remaining = workSeconds;
    render();
  }

  function init() {
    pauseBtn.disabled = true;
    render();
    startBtn.addEventListener('click', start);
    pauseBtn.addEventListener('click', pause);
    resetBtn.addEventListener('click', reset);
    [workInput, breakInput].forEach((el) => el.addEventListener('change', () => {
      if (!intervalId) reset();
    }));
  }

  return { init };
})();

/* ---------------------------------------------------------------
   WEATHER WIDGET
   Uses Open-Meteo (no API key required). Tries the browser's
   Geolocation API first and falls back to a default city if the
   user denies access or it's unavailable.
--------------------------------------------------------------- */
const WeatherModule = (() => {
  const iconEl = document.getElementById('weather-icon');
  const tempEl = document.getElementById('weather-temp');
  const locEl = document.getElementById('weather-loc');

  const DEFAULT_LOCATION = { lat: 12.9165, lon: 79.1325, name: 'Vellore' };

  const WEATHER_CODES = {
    0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
    45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'],
    51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌦️', 'Dense drizzle'],
    61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
    71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'],
    80: ['🌧️', 'Rain showers'], 81: ['🌧️', 'Rain showers'], 82: ['⛈️', 'Violent showers'],
    95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm'], 99: ['⛈️', 'Severe storm'],
  };

  function setLoading() {
    iconEl.textContent = '⏳';
    tempEl.textContent = '--°';
    locEl.textContent = 'Locating…';
  }

  function setError() {
    iconEl.textContent = '⚠️';
    tempEl.textContent = '--°';
    locEl.textContent = 'Weather unavailable';
  }

  async function reverseGeocodeName(lat, lon) {
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1`);
      const data = await res.json();
      return data?.results?.[0]?.name || 'Your location';
    } catch {
      return 'Your location';
    }
  }

  async function fetchWeather(lat, lon, name) {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
      if (!res.ok) throw new Error('Bad response');
      const data = await res.json();
      const code = data.current?.weather_code;
      const temp = Math.round(data.current?.temperature_2m);
      const [icon, label] = WEATHER_CODES[code] || ['🌡️', 'Weather'];
      iconEl.textContent = icon;
      iconEl.title = label;
      tempEl.textContent = `${temp}°C`;
      locEl.textContent = name;
    } catch {
      setError();
    }
  }

  function init() {
    setLoading();
    if (!navigator.geolocation) {
      fetchWeather(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.name);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const name = await reverseGeocodeName(latitude, longitude);
        fetchWeather(latitude, longitude, name);
      },
      () => {
        // Location denied or unavailable — graceful fallback.
        fetchWeather(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.name);
      },
      { timeout: 8000 }
    );
  }

  return { init };
})();

/* ---------------------------------------------------------------
   DAILY GOALS
--------------------------------------------------------------- */
const GoalsModule = (() => {
  const STORAGE_KEY = 'focusdeck-goals';
  const input = document.getElementById('goal-input');
  const addBtn = document.getElementById('goal-add');
  const list = document.getElementById('goal-list');
  const progressText = document.getElementById('goals-progress-text');
  const progressSub = document.getElementById('goals-progress-sub');
  const ringProgress = document.getElementById('goals-ring-progress');

  const RADIUS = 26;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  ringProgress.style.strokeDasharray = `${CIRCUMFERENCE}`;

  let goals = loadJSON(STORAGE_KEY, []);

  function persist() { saveJSON(STORAGE_KEY, goals); }

  function renderProgress() {
    const total = goals.length;
    const done = goals.filter((g) => g.completed).length;
    progressText.textContent = `${done} of ${total} completed`;
    progressSub.textContent = total === 0 ? 'Add a goal to get moving' : (done === total ? 'All done for today 🎉' : 'Keep going');
    const fraction = total === 0 ? 0 : done / total;
    ringProgress.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - fraction)}`;
  }

  function render() {
    list.innerHTML = '';
    if (goals.length === 0) {
      list.innerHTML = `<li class="empty-state">No goals set for today yet.</li>`;
    } else {
      goals.forEach((goal) => {
        const li = document.createElement('li');
        li.className = `list-item${goal.completed ? ' completed' : ''}`;
        li.dataset.id = goal.id;
        li.innerHTML = `
          <button class="check-circle" data-action="complete" aria-label="Mark goal done">${goal.completed ? '✓' : ''}</button>
          <span class="item-text">${escapeHTML(goal.text)}</span>
          <button class="icon-btn delete" data-action="delete" aria-label="Remove goal" title="Remove">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v13a1 1 0 01-1 1H8a1 1 0 01-1-1V7"/></svg>
          </button>
        `;
        list.appendChild(li);
      });
    }
    renderProgress();
  }

  function addGoal() {
    const text = input.value.trim();
    if (!text) return;
    goals.push({ id: uid(), text, completed: false });
    persist();
    render();
    input.value = '';
    input.focus();
  }

  function handleListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const li = e.target.closest('.list-item');
    const id = li?.dataset.id;
    const goal = goals.find((g) => g.id === id);
    if (!goal) return;

    if (btn.dataset.action === 'complete') goal.completed = !goal.completed;
    if (btn.dataset.action === 'delete') goals = goals.filter((g) => g.id !== id);

    persist();
    render();
  }

  function init() {
    render();
    addBtn.addEventListener('click', addGoal);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addGoal(); });
    list.addEventListener('click', handleListClick);
  }

  return { init };
})();

/* ---------------------------------------------------------------
   BOOTSTRAP
--------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  ThemeModule.init();
  SkyModule.init();
  ClockModule.init();
  NavModule.init();
  TodoModule.init();
  PlannerModule.init();
  QuoteModule.init();
  PomodoroModule.init();
  WeatherModule.init();
  GoalsModule.init();
});