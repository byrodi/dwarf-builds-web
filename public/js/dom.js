// Small DOM helpers. User text is always set with textContent, never as HTML.

// h("div.card.on", {attrs}, ...children). Attrs: on<Event> handlers, "text", "dataset", "style" (object
// of properties, custom ones too), "hidden", "disabled", any other attribute by name.
export function h(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");
  if (attrs && (attrs instanceof Node || typeof attrs !== "object" || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "text") el.textContent = String(v);
      else if (k === "class") el.className += (el.className ? " " : "") + v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "style") {
        for (const [p, val] of Object.entries(v)) {
          if (val !== undefined && val !== null) el.style.setProperty(p, String(val));
        }
      } else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  return append(el, children);
}

// Length in code points (what the server counts).
export function textLength(s) {
  return Array.from(String(s || "")).length;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function formatDate(ms) {
  const d = new Date(Number(ms) || 0);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
