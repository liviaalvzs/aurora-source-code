// Supabase: URL e chave pública (publishable/anon) do projeto. A segurança vem do RLS em supabase/schema.sql.
const SB_URL = "https://esxphcyqtjcrvijlgdde.supabase.co";
const SB_KEY = "sb_publishable_ChgKrC8ouh2PT4k5vJeF_w_CiUWVO12";
const KEY = "aurora-caderno", PENDING = "aurora-pendente";
const DOWL = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
const MONL = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const KINDS = { book: ["Livro", "▤"], link: ["Link", "↗"] };
const WTYPES = ["Academia","Bike","Caminhada","Canoagem","Corrida","Yoga","Outro"];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const iso = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
const toDate = k => new Date(k + "T00:00");
const fmt = k => { const d = toDate(k); return d.getDate() + " " + MONL[d.getMonth()].slice(0, 3); };
const addDays = (k, n) => { const d = toDate(k); d.setDate(d.getDate() + n); return iso(d); };
const uid = () => crypto.randomUUID();

/* dados:
   items    livros e links          [{ id, kind, title, note, ... }]
   days     conteúdo por dia        { "2026-10-26": [{ id, item, from?, to?, note? }] }
   habits   lista de hábitos        [{ id, name }]
   checks   hábitos feitos por dia  { "2026-10-26": { habitId: 1 } }
   workouts treinos                 [{ id, date, type, min, note }]
   events   eventos                 [{ id, date, time, title }] */
const norm = d => {
  d = d && typeof d === "object" ? d : {};
  d.items ||= []; d.days ||= {}; d.habits ||= []; d.checks ||= {}; d.workouts ||= []; d.events ||= [];
  d.items.forEach(i => { if (i.kind === "podcast" || i.kind === "text") i.kind = "link"; }); // podcasts e textos viraram links
  return d;
};
let data;
try { data = norm(JSON.parse(localStorage.getItem(KEY))); } catch { data = norm(); }

// ---------- nuvem ----------
// ponytail: um JSON por usuário, o último a salvar vence; editar em dois aparelhos ao mesmo tempo pode sobrescrever
// Sem internet, tudo fica no aparelho marcado como "pendente" e sobe quando a conexão voltar.
const sb = supabase.createClient(SB_URL, SB_KEY);
let user = null, timer = null;
const ls = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const pending = () => { try { return localStorage.getItem(PENDING) === "1"; } catch { return false; } };
const status = t => { $("sync").textContent = t; };
const save = () => {
  ls(KEY, JSON.stringify(data));
  render();
  if (!user) return;
  ls(PENDING, "1");
  clearTimeout(timer);
  timer = setTimeout(push, 600);
};
async function push() {
  timer = null;
  const { error } = await sb.from("aurora_state").upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
  if (error) return status(navigator.onLine ? "não salvou na nuvem" : "sem internet · salvo no aparelho");
  ls(PENDING); status("");
}
async function pull() {
  if (timer) return;
  if (pending()) return push(); // o que foi feito offline sobe antes de baixar
  const { data: row, error } = await sb.from("aurora_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) return status(navigator.onLine ? "sem conexão com a nuvem" : "sem internet");
  if (!row) return push(); // primeira vez: sobe o que já está neste aparelho
  data = norm(row.data);
  ls(KEY, JSON.stringify(data));
  status(""); render();
}
addEventListener("online", () => { if (user) pull(); });
addEventListener("offline", () => status("sem internet · salvo no aparelho"));
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// ---------- dia de hoje (atualiza se o app ficar aberto de um dia para o outro) ----------
let today, TODAY, view, sel, lastAdd = "event";
function setToday() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const k = iso(t);
  if (k === TODAY) return false;
  if (!TODAY || sel === TODAY) { sel = k; view = new Date(t.getFullYear(), t.getMonth(), 1); }
  today = t; TODAY = k;
  return true;
}
setToday();
setInterval(() => { if (setToday()) render(); }, 60000);

// ---------- consultas ----------
const itemOf = id => data.items.find(i => i.id === id);
const entriesOf = id => Object.entries(data.days).flatMap(([day, es]) => es.filter(e => e.item === id).map(e => ({ ...e, day })));
const lastPage = id => Math.max(0, ...entriesOf(id).map(e => +e.to || 0));
const done = (k, hid) => !!data.checks[k]?.[hid];
const habRatio = k => data.habits.length ? data.habits.filter(h => done(k, h.id)).length / data.habits.length : 0;
function streak(hid) {
  let k = done(TODAY, hid) ? TODAY : addDays(TODAY, -1), n = 0;
  while (done(k, hid)) { n++; k = addDays(k, -1); }
  return n;
}
const byTime = (a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99"));
const eventsOn = k => data.events.filter(e => e.date === k).sort(byTime);
const workoutsOn = k => data.workouts.filter(w => w.date === k);
const openItems = kind => data.items.filter(i => i.kind === kind && !i.done);

async function preview(url) {
  try {
    const r = await fetch("/api/preview?url=" + encodeURIComponent(url));
    if (r.ok) return await r.json();
  } catch {}
  const host = new URL(url).hostname.replace(/^www\./, "");
  return { url, title: host, image: "", site: host, desc: "" };
}
// Procura o livro: Google Books (pelo Worker, se tiver chave) e, sem capa lá, Open Library. Com ISBN acerta a edição.
async function lookupBook(title, author, isbn) {
  isbn = isbn.replace(/[^\dX]/gi, "");
  let g = {};
  try {
    const q = isbn ? "isbn:" + isbn : "intitle:" + title + (author ? " inauthor:" + author : "");
    g = await (await fetch("/api/book?q=" + encodeURIComponent(q), { signal: AbortSignal.timeout(6000) })).json();
    if (g.image) return g;
  } catch {}
  try {
    const p = new URLSearchParams({ limit: 5, fields: "title,author_name,number_of_pages_median,cover_i" });
    if (isbn) p.set("isbn", isbn); else p.set("q", (title + " " + author).trim()); // texto livre acha mais que título/autor separados
    const docs = (await (await fetch("https://openlibrary.org/search.json?" + p, { signal: AbortSignal.timeout(6000) })).json()).docs || [];
    const d = docs.find(x => x.cover_i) || docs[0];
    if (d) return {
      title: g.title || d.title, pages: g.pages || d.number_of_pages_median || null,
      // o mesmo autor costuma vir com e sem acento: fica um só
      author: g.author || [...new Map((d.author_name || []).map(n => [n.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(), n])).values()].join(", "),
      image: d.cover_i ? "https://covers.openlibrary.org/b/id/" + d.cover_i + "-M.jpg" : "",
    };
  } catch {}
  return g;
}
function newLink(p) {
  const it = { id: uid(), kind: "link", url: p.url, title: p.title, image: p.image, site: p.site, desc: p.desc, created: TODAY };
  data.items.push(it);
  return it;
}

// ---------- desenho ----------
const thumb = (it, cls) => it.image
  ? '<img class="' + cls + '" src="' + esc(it.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-gl="' + KINDS[it.kind][1] + '">'
  : '<span class="' + cls + ' gl">' + KINDS[it.kind][1] + '</span>';
// imagem que não carrega vira o símbolo do tipo
document.addEventListener("error", e => {
  const img = e.target;
  if (img.tagName !== "IMG" || !img.dataset.gl) return;
  const s = document.createElement("span");
  s.className = img.className + " gl"; s.textContent = img.dataset.gl;
  img.replaceWith(s);
}, true);
const note = t => t ? '<span class="note">' + esc(t) + "</span>" : "";
const habitCheck = (h, k) => '<label class="hrow"><input type="checkbox" data-hk="' + h.id + '" data-day="' + k + '"' + (done(k, h.id) ? " checked" : "") + '><span>' + esc(h.name) + '</span></label>';
// cada linha é um botão: tocar abre a edição
const lineBtn = (edit, inner) => '<li><button type="button" class="line" data-edit="' + edit + '">' + inner + '<span class="chev" aria-hidden="true">›</span></button></li>';
const workoutLine = w => lineBtn("workout:" + w.id, '<span class="eb"><span class="et">' + esc(w.type) + (w.min ? " · " + w.min + " min" : "") + "</span>" + note(w.note) + "</span>");
const eventLine = (e, withDate) => lineBtn("event:" + e.id, '<span class="when">' + (withDate ? fmt(e.date) + (e.time ? " · " : "") : "") + (e.time || (withDate ? "" : "dia todo")) + '</span><span class="et">' + esc(e.title) + "</span>");
const entryLine = e => {
  const it = itemOf(e.item); if (!it) return "";
  const pages = e.from || e.to ? " · p. " + (e.from || "?") + "–" + (e.to || "?") : "";
  return lineBtn("entry:" + e.id, thumb(it, "th") + '<span class="eb"><span class="et">' + esc(it.title) + '</span><span class="meta">' + KINDS[it.kind][0] + pages + "</span>" + note(e.note) + "</span>");
};

function renderCal() {
  $("month").textContent = MONL[view.getMonth()] + " " + view.getFullYear();
  const y = view.getFullYear(), m = view.getMonth();
  const off = (view.getDay() + 6) % 7, last = new Date(y, m + 1, 0).getDate();
  let h = ["seg","ter","qua","qui","sex","sáb","dom"].map(d => '<span class="dow">' + d + '</span>').join("") + "<span></span>".repeat(off);
  for (let n = 1; n <= last; n++) {
    const k = iso(new Date(y, m, n));
    const its = [...new Set((data.days[k] || []).map(e => e.item))].map(itemOf).filter(Boolean);
    const ev = data.events.some(e => e.date === k), wo = data.workouts.some(w => w.date === k), r = habRatio(k);
    h += '<button type="button" class="cd' + (k === sel ? " sel" : "") + (k === TODAY ? " today" : "") + '" data-d="' + k + '" aria-label="' + n + " de " + MONL[m] + '">' +
      '<span class="n">' + n + '</span>' +
      '<span class="ths">' + (ev ? '<i class="mk ev"></i>' : "") + (wo ? '<i class="mk wo"></i>' : "") + its.slice(0, 2).map(it => thumb(it, "mini")).join("") +
      (its.length > 2 ? '<span class="more">+' + (its.length - 2) + '</span>' : "") + '</span>' +
      (r > 0 ? '<i class="hb"><i style="width:' + Math.round(r * 100) + '%"></i></i>' : "") + '</button>';
  }
  $("cal").innerHTML = h;
}

const block = (title, body) => '<div class="block"><span class="flabel">' + title + "</span>" + body + "</div>";
function renderDay() {
  const d = toDate(sel), es = data.days[sel] || [], evs = eventsOn(sel), wos = workoutsOn(sel);
  let h = '<div class="sech"><h3>' + d.getDate() + " de " + MONL[d.getMonth()] + '</h3><span class="label">' + DOWL[d.getDay()] + (sel === TODAY ? " · hoje" : "") + "</span></div>";
  // só aparecem os blocos que têm algo; os hábitos sempre, para marcar
  if (evs.length) h += block("Eventos", '<ul class="list">' + evs.map(e => eventLine(e)).join("") + "</ul>");
  if (data.habits.length) h += block("Hábitos", '<div class="hlist">' + data.habits.map(x => habitCheck(x, sel)).join("") + "</div>");
  if (wos.length) h += block("Treinos", '<ul class="list">' + wos.map(workoutLine).join("") + "</ul>");
  if (es.length) h += block("Conteúdo", '<ul class="list">' + es.map(entryLine).join("") + "</ul>");
  if (!evs.length && !wos.length && !es.length && !data.habits.length) h += '<p class="empty">Nada registrado neste dia.</p>';
  $("day").innerHTML = h + '<button type="button" class="newbtn solid" data-new="day">+ registrar</button>';
}

function renderHabits() {
  $("habits").innerHTML = data.habits.length ? '<div class="sech"><h3>Hoje</h3><span class="label">' + data.habits.filter(x => done(TODAY, x.id)).length + " / " + data.habits.length + "</span></div>" +
    data.habits.map(x => {
      const s = streak(x.id);
      let dots = "";
      for (let i = 13; i >= 0; i--) { const k = addDays(TODAY, -i); dots += '<i class="' + (done(k, x.id) ? "on" : "") + '" title="' + fmt(k) + '"></i>'; }
      return '<div class="habit">' + habitCheck(x, TODAY) + '<button type="button" class="del" data-edit="habit:' + x.id + '" aria-label="Editar hábito ' + esc(x.name) + '">✎</button>' +
        '<div class="hmeta"><span class="dots14">' + dots + '</span><span class="meta">' + (s ? s + (s > 1 ? " dias seguidos" : " dia") : "") + "</span></div></div>";
    }).join("") : '<p class="empty">Nenhum hábito ainda. Crie o primeiro acima.</p>';
}

function renderWorkouts() {
  const mk = TODAY.slice(0, 7), month = data.workouts.filter(w => w.date.startsWith(mk));
  const byType = {};
  month.forEach(w => { const t = byType[w.type] ||= { n: 0, min: 0 }; t.n++; t.min += +w.min || 0; });
  $("wosum").innerHTML = '<div class="sech"><h3>' + MONL[today.getMonth()] + '</h3><span class="label">' + month.length + (month.length === 1 ? " treino" : " treinos") + "</span></div>" +
    (month.length ? '<div class="chips">' + Object.entries(byType).sort((a, b) => b[1].n - a[1].n).map(([t, v]) => '<span class="chip"><b>' + v.n + "×</b> " + esc(t) + (v.min ? " · " + v.min + " min" : "") + "</span>").join("") + "</div>" : '<p class="empty">Nenhum treino neste mês ainda.</p>');
  const recent = [...data.workouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  let h = '<div class="sech"><h3>Últimos</h3></div>', lastDay = "";
  if (!recent.length) h += '<p class="empty">Os treinos registrados aparecem aqui.</p>';
  else h += '<ul class="list">' + recent.map(w => {
    const head = w.date !== lastDay ? '<li class="dayhead">' + DOWL[toDate(w.date).getDay()] + ", " + fmt(w.date) + "</li>" : "";
    lastDay = w.date;
    return head + workoutLine(w);
  }).join("") + "</ul>";
  $("wolist").innerHTML = h;
}

function renderEvents() {
  const next = data.events.filter(e => e.date >= TODAY).sort(byTime), past = data.events.filter(e => e.date < TODAY).sort(byTime).reverse();
  $("evnext").innerHTML = '<div class="sech"><h3>Próximos</h3></div>' + (next.length ? '<ul class="list">' + next.map(e => eventLine(e, true)).join("") + "</ul>" : '<p class="empty">Nenhum evento marcado.</p>');
  $("evpastbox").hidden = !past.length;
  $("evpast").innerHTML = '<ul class="list">' + past.map(e => eventLine(e, true)).join("") + "</ul>";
}

function renderList(kind) {
  const its = data.items.filter(i => i.kind === kind).sort((a, b) => (!!a.done - !!b.done) || (b.created > a.created ? 1 : -1));
  $("list-" + kind).innerHTML = its.length ? its.map(it => {
    const days = [...new Set(entriesOf(it.id).map(e => e.day))].sort();
    let prog = "";
    if (kind === "book" && it.pages) {
      const p = lastPage(it.id);
      prog = '<span class="bar"><i style="width:' + Math.min(100, p / it.pages * 100) + '%"></i></span><span class="meta">p. ' + p + " de " + it.pages + "</span>";
    }
    const title = it.url ? '<a class="ct" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + "</a>" : '<span class="ct">' + esc(it.title) + "</span>";
    return '<article class="card' + (it.done ? " done" : "") + '">' + thumb(it, "cover") + '<div class="cbody">' + title +
      '<span class="cs">' + esc(kind === "book" ? it.author : it.site) + "</span>" + prog +
      '<span class="meta">' + (days.length ? days.length + (days.length > 1 ? " dias" : " dia") + " · desde " + fmt(days[0]) : "ainda sem registro") + (it.done ? " · terminado" : "") + "</span>" + note(it.note) +
      '<div class="cact"><button type="button" data-done="' + it.id + '">' + (it.done ? "reabrir" : "terminei") + '</button><button type="button" data-edit="item:' + it.id + '">editar</button></div></div></article>';
  }).join("") : '<p class="empty">Nada por aqui ainda.</p>';
}

function render() { renderCal(); renderDay(); renderHabits(); renderWorkouts(); renderEvents(); Object.keys(KINDS).forEach(renderList); }

// ---------- folha de criar / editar ----------
const ADD = { event: "Evento", workout: "Treino", "read-book": "Livro", "read-link": "Link" };
const NAMES = { event: "evento", workout: "treino", habit: "hábito", book: "livro", link: "link", entry: "registro" };
let sh = null; // { kind, obj, day, fromDay }
const fld = (label, inner) => '<label class="fl"><span>' + label + "</span>" + inner + "</label>";
const inp = (name, attrs, val) => '<input class="in" name="' + name + '" ' + (attrs || "") + ' value="' + esc(val ?? "") + '">';
const txt = (name, val, ph) => '<textarea class="in" name="' + name + '" rows="2" placeholder="' + (ph || "") + '">' + esc(val || "") + "</textarea>";
const pair = (a, b) => '<div class="pair">' + a + b + "</div>";
const pick = (kind, withNew) => '<select class="in" name="pick">' + openItems(kind).map(i => '<option value="' + i.id + '">' + esc(i.title) + "</option>").join("") + (withNew ? '<option value="">+ novo link</option>' : "") + "</select>";

function fields(kind, o, day) {
  switch (kind) {
    case "event": return pair(fld("dia", inp("date", 'type="date" required', o?.date || day)), fld("hora", inp("time", 'type="time"', o?.time))) +
      fld("o quê", inp("title", 'required autocomplete="off" placeholder="ex: aniversário da Ana"', o?.title));
    case "workout": return fld("tipo", '<select class="in" name="type">' + WTYPES.map(t => "<option" + (t === o?.type ? " selected" : "") + ">" + t + "</option>").join("") + "</select>") +
      pair(fld("dia", inp("date", 'type="date" required', o?.date || day)), fld("minutos", inp("min", 'type="number" min="1" inputmode="numeric"', o?.min))) +
      fld("como foi", txt("note", o?.note, "opcional"));
    case "habit": return fld("nome", inp("name", 'required autocomplete="off" placeholder="ex: beber 2 L de água"', o?.name));
    case "read-book": return openItems("book").length
      ? fld("livro", pick("book")) + pair(fld("da página", inp("from", 'type="number" min="1" inputmode="numeric"')), fld("até a página", inp("to", 'type="number" min="1" inputmode="numeric" required'))) + fld("nota", txt("note", "", "uma frase, uma ideia… (opcional)"))
      : '<p class="empty">Nenhum livro em andamento. Crie um em Conteúdo → Livros.</p>';
    case "read-link": return fld("link", pick("link", true)) + inp("url", 'type="url" placeholder="cole o link do podcast, artigo, vídeo…"' + (openItems("link").length ? " hidden" : "")) + fld("nota", txt("note", "", "opcional"));
    case "entry": {
      const it = itemOf(o.item);
      return '<p class="shitem">' + thumb(it, "th") + "<b>" + esc(it.title) + "</b></p>" +
        (it.kind === "book" ? pair(fld("da página", inp("from", 'type="number" min="1" inputmode="numeric"', o.from)), fld("até a página", inp("to", 'type="number" min="1" inputmode="numeric"', o.to))) : "") +
        fld("dia", inp("date", 'type="date" required', day)) + fld("nota", txt("note", o.note, "opcional"));
    }
    case "book": return fld("título", inp("title", 'autocomplete="off" placeholder="ou só o ISBN abaixo"', o?.title)) + fld("autor(a)", inp("author", 'autocomplete="off"', o?.author)) +
      pair(fld("ISBN", inp("isbn", 'inputmode="numeric" autocomplete="off" placeholder="verso do livro"', o?.isbn)), fld("páginas", inp("pages", 'type="number" min="1" inputmode="numeric"', o?.pages))) +
      fld("capa (link)", inp("cover", 'type="url" placeholder="vazio: eu procuro"', o?.image)) +
      fld("nota", txt("note", o?.note, "o que achou (opcional)"));
    case "link": return o
      ? fld("título", inp("title", 'required autocomplete="off"', o.title)) + fld("endereço", inp("url", 'type="url" required', o.url)) + fld("nota", txt("note", o.note, "opcional"))
      : fld("link", inp("url", 'type="url" required placeholder="cole o link do podcast, artigo, vídeo…"')) + '<label class="chk"><input type="checkbox" name="today" checked> consumi hoje</label>';
  }
}
function drawSheet() {
  const { kind, obj, day, fromDay } = sh;
  $("shtitle").textContent = fromDay ? "registrar · " + fmt(day) : (obj ? "editar " : "novo ") + NAMES[kind];
  $("shseg").hidden = !fromDay;
  $("shseg").innerHTML = Object.entries(ADD).map(([k, v]) => '<button type="button" data-sk="' + k + '" aria-pressed="' + (k === kind) + '">' + v + "</button>").join("");
  $("shfields").innerHTML = fields(kind, obj, day);
  $("shdel").hidden = !obj;
  const btn = $("shsave");
  btn.disabled = kind === "read-book" && !openItems("book").length;
  btn.textContent = "salvar";
  prefillPages();
}
function prefillPages() {
  const f = $("shform").elements;
  if (sh.kind === "read-book" && f.pick) f.from.value = lastPage(f.pick.value) + 1;
}
function openSheet(kind, obj = null, day = sel, fromDay = false) {
  sh = { kind, obj, day, fromDay };
  drawSheet();
  $("sheet").showModal();
}
const closeSheet = () => { $("sheet").close(); sh = null; };
$("shclose").onclick = closeSheet;
$("sheet").addEventListener("click", e => { if (e.target === $("sheet")) closeSheet(); }); // toque fora fecha
$("shseg").onclick = e => { const b = e.target.closest("[data-sk]"); if (b) { sh.kind = lastAdd = b.dataset.sk; drawSheet(); } };
$("shfields").addEventListener("change", e => {
  if (e.target.name !== "pick") return;
  const url = $("shform").elements.url;
  if (url && sh.kind === "read-link") { url.hidden = !!e.target.value; url.required = !e.target.value; if (!url.hidden) url.focus(); }
  prefillPages();
});
const upsert = (arr, obj, vals) => obj ? Object.assign(obj, vals) : arr.push({ id: uid(), ...vals });

$("shform").onsubmit = async e => {
  e.preventDefault();
  const f = e.target.elements, { kind, obj, day } = sh, v = n => (f[n]?.value ?? "").trim(), btn = $("shsave");
  const busy = t => { btn.disabled = true; btn.textContent = t; };
  if (kind === "event") upsert(data.events, obj, { date: v("date"), time: v("time"), title: v("title") });
  else if (kind === "workout") upsert(data.workouts, obj, { date: v("date"), type: v("type"), min: +v("min") || null, note: v("note") });
  else if (kind === "habit") upsert(data.habits, obj, { name: v("name") });
  else if (kind === "read-book" || kind === "read-link") {
    let id = v("pick");
    if (!id && kind === "read-link") {
      if (!v("url")) return f.url.focus();
      busy("buscando…");
      id = newLink(await preview(v("url"))).id;
    }
    if (!id) return;
    const en = { id: uid(), item: id, note: v("note") };
    if (kind === "read-book") { en.from = +v("from") || null; en.to = +v("to") || null; }
    (data.days[day] ||= []).push(en);
  } else if (kind === "entry") {
    obj.note = v("note");
    if (f.from) { obj.from = +v("from") || null; obj.to = +v("to") || null; }
    const nd = v("date");
    if (nd && nd !== day) { // mudou de dia
      data.days[day] = data.days[day].filter(x => x !== obj);
      if (!data.days[day].length) delete data.days[day];
      (data.days[nd] ||= []).push(obj);
    }
  } else if (kind === "book") {
    const o = obj || { id: uid(), kind: "book", created: TODAY };
    let title = v("title"), author = v("author"), pages = +v("pages") || null, image = v("cover");
    const isbn = v("isbn");
    if (!title && !isbn) return f.title.focus();
    if (!image || !title) { // falta capa ou título: procura e completa só o que estiver vazio
      busy("procurando o livro…");
      const b = await lookupBook(title, author, isbn);
      title ||= b.title || "ISBN " + isbn; author ||= b.author || ""; pages ||= b.pages || null; image ||= b.image || "";
    }
    Object.assign(o, { title, author, pages, image, isbn, note: v("note") });
    if (!obj) data.items.push(o);
  } else if (kind === "link") {
    if (obj) Object.assign(obj, { title: v("title"), url: v("url"), note: v("note") });
    else {
      busy("buscando…");
      const it = newLink(await preview(v("url")));
      if (f.today.checked) (data.days[TODAY] ||= []).push({ id: uid(), item: it.id });
    }
  }
  closeSheet(); save();
};
$("shdel").onclick = () => {
  const { kind, obj, day } = sh;
  if (kind === "entry") { data.days[day] = data.days[day].filter(x => x !== obj); if (!data.days[day].length) delete data.days[day]; }
  else if (kind === "event") data.events = data.events.filter(x => x !== obj);
  else if (kind === "workout") data.workouts = data.workouts.filter(x => x !== obj);
  else if (kind === "habit") {
    if (!confirm("Apagar este hábito e o histórico dele?")) return;
    data.habits = data.habits.filter(x => x !== obj);
    for (const k in data.checks) { delete data.checks[k][obj.id]; if (!Object.keys(data.checks[k]).length) delete data.checks[k]; }
  } else {
    if (!confirm("Apagar \"" + obj.title + "\" e todos os registros dele?")) return;
    data.items = data.items.filter(x => x !== obj);
    for (const k in data.days) { data.days[k] = data.days[k].filter(x => x.item !== obj.id); if (!data.days[k].length) delete data.days[k]; }
  }
  closeSheet(); save();
};

// ---------- ações ----------
$("mprev").onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCal(); };
$("mnext").onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCal(); };
$("cal").onclick = e => {
  const b = e.target.closest("[data-d]"); if (!b) return;
  sel = b.dataset.d; renderCal(); renderDay();
  // no celular o painel do dia fica abaixo do calendário: traz ele para a vista
  if ($("day").getBoundingClientRect().top > innerHeight - 160)
    $("day").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" });
};

document.addEventListener("change", e => {
  const t = e.target; if (!t.dataset.hk) return;
  const c = data.checks[t.dataset.day] ||= {};
  if (t.checked) c[t.dataset.hk] = 1; else delete c[t.dataset.hk];
  if (!Object.keys(c).length) delete data.checks[t.dataset.day];
  save();
});
document.addEventListener("click", e => {
  const n = e.target.closest("[data-new]");
  if (n) return n.dataset.new === "day" ? openSheet(lastAdd, null, sel, true) : openSheet(n.dataset.new, null, TODAY);
  const ed = e.target.closest("[data-edit]");
  if (ed) {
    const [what, id] = ed.dataset.edit.split(":");
    if (what === "event") return openSheet("event", data.events.find(x => x.id === id));
    if (what === "workout") return openSheet("workout", data.workouts.find(x => x.id === id));
    if (what === "habit") return openSheet("habit", data.habits.find(x => x.id === id));
    if (what === "entry") return openSheet("entry", (data.days[sel] || []).find(x => x.id === id), sel);
    const it = itemOf(id); if (it) return openSheet(it.kind, it);
    return;
  }
  const d = e.target.closest("[data-done]");
  if (d) { const it = itemOf(d.dataset.done); if (it) { it.done = !it.done; save(); } }
});

$("tabbar").onclick = e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  $("tabbar").querySelectorAll("[data-tab]").forEach(x => {
    const on = x === b;
    x.setAttribute("aria-pressed", on);
    $(x.dataset.tab).hidden = !on;
  });
  scrollTo(0, 0);
};
$("cseg").onclick = e => {
  const b = e.target.closest("[data-c]"); if (!b) return;
  $("cseg").querySelectorAll("[data-c]").forEach(x => { x.setAttribute("aria-pressed", x === b); $("c-" + x.dataset.c).hidden = x !== b; });
};

// ---------- login com e-mail e senha ----------
const home = location.origin + location.pathname;
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "PASSWORD_RECOVERY") setTimeout(newPassword); // veio do link "esqueci a senha"
  const u = session?.user || null;
  if (u?.id === user?.id) return;
  user = u;
  document.body.classList.toggle("out", !user);
  if (user) pull();
});
async function newPassword() {
  const password = prompt("Digite a nova senha (mínimo 6 caracteres):");
  if (!password) return;
  const { error } = await sb.auth.updateUser({ password });
  alert(error ? "Não deu: " + error.message : "Senha trocada!");
}
$("login").onsubmit = async e => {
  e.preventDefault();
  const f = e.target.elements, email = f.email.value.trim(), password = f.password.value, msg = $("loginmsg");
  msg.textContent = "um instante…";
  if (e.submitter?.value === "up") {
    const { data: r, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: home } });
    msg.textContent = error ? "Não deu: " + error.message : r.session ? "" : "Conta criada! Confirme pelo link que chegou no seu e-mail e depois entre.";
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    msg.textContent = !error ? "" : /invalid login/i.test(error.message) ? "E-mail ou senha errados." : /not confirmed/i.test(error.message) ? "Confirme seu e-mail pelo link que enviamos antes de entrar." : "Não deu: " + error.message;
  }
};
$("forgot").onclick = async () => {
  const email = $("login").elements.email.value.trim(), msg = $("loginmsg");
  if (!email) return msg.textContent = "Digite seu e-mail acima primeiro.";
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: home });
  msg.textContent = error ? "Não deu: " + error.message : "Enviamos um link para criar uma senha nova.";
};
$("logout").onclick = async () => {
  if (pending() && !confirm("Ainda há mudanças que não subiram para a nuvem. Sair mesmo assim?")) return;
  if (!confirm("Sair da aurora neste aparelho?")) return;
  await sb.auth.signOut();
  ls(KEY); ls(PENDING);
  data = norm(); render();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (setToday()) render();
  if (user) pull();
});

render();
