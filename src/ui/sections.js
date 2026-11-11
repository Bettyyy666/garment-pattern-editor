// Drop-down sidebar sections: each section's heading becomes a button that shows or hides the rest of it.
// Open/closed state is a per-viewer convenience kept in localStorage.
const KEY = 'gpe.sections';
const openers = new Map(); // section name -> open()
const CLOSED_BY_DEFAULT = ['Design operations', 'Selection', 'Panels', 'View'];

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function store(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: the state just isn't remembered
  }
}

export function initSections() {
  const saved = load();
  document.querySelectorAll('aside > section').forEach((sec, i) => {
    const h = sec.querySelector(':scope > h2');
    if (!h) return;
    const name = h.firstChild.textContent.trim(),
      body = document.createElement('div'),
      btn = document.createElement('button');
    // Everything after the heading goes into one body element that collapses.
    body.className = 'sec-body';
    body.id = `sec-body-${i}`;
    while (h.nextSibling) body.appendChild(h.nextSibling);
    sec.appendChild(body);
    btn.type = 'button';
    btn.className = 'sec-toggle';
    btn.setAttribute('aria-controls', body.id);
    while (h.firstChild) btn.appendChild(h.firstChild);
    h.removeAttribute('style');
    h.appendChild(btn);
    const set = (open) => {
      sec.classList.toggle('collapsed', !open);
      btn.setAttribute('aria-expanded', open);
      body.hidden = !open;
    };
    set(name in saved ? saved[name] : !CLOSED_BY_DEFAULT.includes(name));
    openers.set(name, () => set(true));
    btn.addEventListener('click', () => {
      const open = sec.classList.contains('collapsed');
      set(open);
      saved[name] = open;
      store(saved);
    });
  });
}

// Open a sidebar section by its heading text (does not change the remembered choice).
export function openSection(name) {
  const f = openers.get(name);
  if (f) f();
}
