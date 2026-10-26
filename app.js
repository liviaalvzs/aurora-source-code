// Supabase: URL e chave pública (publishable/anon) do projeto. A segurança vem do RLS em supabase/schema.sql.
const SB_URL = "https://esxphcyqtjcrvijlgdde.supabase.co";
const SB_KEY = "sb_publishable_ChgKrC8ouh2PT4k5vJeF_w_CiUWVO12";
const KEY = "aurora-caderno";
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
   items    livros e links          [{ id, kind, title, ... }]
   days     conteúdo por dia        { "2026-10-26": [{ id, item, from?, to? }] }
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

// ponytail: um JSON por usuário, o último a salvar vence; editar em dois aparelhos ao mesmo tempo pode sobrescrever
const sb = supabase.createClient(SB_URL, SB_KEY);
let user = null, timer = null;
const status = t => { $("sync").textContent = t; };
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  render();
  if (!user) return;
  clearTimeout(timer);
  timer = setTimeout(push, 600);
};
async function push() {
  timer = null;
  const { error } = await sb.from("aurora_state").upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
  status(error ? "não salvou na nuvem" : "");
}
async function pull() {
  if (timer) return;
  const { data: row, error } = await sb.from("aurora_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) return status("sem conexão");
  if (!row) return push(); // primeira vez: sobe o que já está neste aparelho
  data = norm(row.data);
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  render();
}

// ---------- consultas ----------
const today = new Date(); today.setHours(0,0,0,0);
const TODAY = iso(today);
let view = new Date(today.getFullYear(), today.getMonth(), 1), sel = TODAY, addKind = "book";
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

async function preview(url) {
  try {
    const r = await fetch("/api/preview?url=" + encodeURIComponent(url));
    if (r.ok) return await r.json();
  } catch {}
  const host = new URL(url).hostname.replace(/^www\./, "");
  return { url, title: host, image: "", site: host, desc: "" };
}
async function findCover(title, author) {
  try {
    const q = new URLSearchParams({ title, limit: 1, fields: "cover_i" });
    if (author) q.set("author", author);
    const r = await fetch("https://openlibrary.org/search.json?" + q, { signal: AbortSignal.timeout(6000) });
    const id = (await r.json()).docs?.[0]?.cover_i;
    return id ? "https://covers.openlibrary.org/b/id/" + id + "-M.jpg" : "";
  } catch { return ""; }
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
const del = (what, id, label) => '<button type="button" class="del" data-del="' + what + ":" + id + '" aria-label="' + esc(label) + '">✕</button>';
const habitCheck = (h, k) => '<label class="hrow"><input type="checkbox" data-hk="' + h.id + '" data-day="' + k + '"' + (done(k, h.id) ? " checked" : "") + '><span>' + esc(h.name) + '</span></label>';
const workoutLine = w => '<li class="line"><div class="eb"><span class="et">' + esc(w.type) + (w.min ? " · " + w.min + " min" : "") + '</span>' + (w.note ? '<span class="meta">' + esc(w.note) + "</span>" : "") + "</div>" + del("workout", w.id, "Apagar treino") + "</li>";
const eventLine = (e, withDate) => '<li class="line"><span class="when">' + (withDate ? fmt(e.date) + (e.time ? " · " : "") : "") + (e.time || (withDate ? "" : "dia todo")) + '</span><span class="et">' + esc(e.title) + "</span>" + del("event", e.id, "Apagar evento") + "</li>";

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
      (r > 0 ?'<i class="hb"><i style="width:' + Math.round(r * 100) + '%"></i></i>' : "") + '</button>';
  }
  $("cal").innerHTML = h;
}

function block(title, body, form) {
  return '<div class="block"><span class="flabel">' + title + "</span>" + body + (form || "") + "</div>";
}
function renderDay() {
  const d = toDate(sel), es = data.days[sel] || [], evs = eventsOn(sel), wos = workoutsOn(sel);
  let h = '<div class="sech"><h3>' + d.getDate() + " de " + MONL[d.getMonth()] + '</h3><span class="label">' + DOWL[d.getDay()] + (sel === TODAY ? " · hoje" : "") + "</span></div>";

  h += block("Eventos", evs.length ? '<ul class="list">' + evs.map(e => eventLine(e)).join("") + "</ul>" : "",
    '<form class="row" data-add="event"><input class="in" name="time" type="time" aria-label="Hora"><input class="in" name="title" placeholder="novo evento" autocomplete="off" required><button class="plus" aria-label="Adicionar evento">+</button></form>');

  h += block("Hábitos", data.habits.length ? '<div class="hlist">' + data.habits.map(x => habitCheck(x, sel)).join("") + "</div>" : '<p class="empty">Crie hábitos na aba Hábitos.</p>');

  h += block("Treinos", wos.length ? '<ul class="list">' + wos.map(workoutLine).join("") + "</ul>" : "",
    '<form class="row" data-add="workout"><select class="in" name="type" aria-label="Tipo">' + WTYPES.map(t => "<option>" + t + "</option>").join("") + '</select><input class="in min" name="min" type="number" min="1" inputmode="numeric" placeholder="min" aria-label="Minutos"><button class="plus" aria-label="Adicionar treino">+</button></form>');

  const body = es.length ? '<ul class="list">' + es.map(e => {
    const it = itemOf(e.item); if (!it) return "";
    const pages = e.from || e.to ? " · p. " + (e.from || "?") + "–" + (e.to || "?") : "";
    return '<li class="entry">' + thumb(it, "th") + '<div class="eb"><span class="et">' + esc(it.title) + '</span><span class="meta">' + KINDS[it.kind][0] + pages + "</span></div>" + del("entry", e.id, "Tirar do dia") + "</li>";
  }).join("") + "</ul>" : "";
  const open = data.items.filter(i => i.kind === addKind && !i.done);
  const opts = open.map(i => '<option value="' + i.id + '">' + esc(i.title) + "</option>").join("");
  let f = '<form class="addentry" data-add="content"><div class="seg two">' +
    Object.entries(KINDS).map(([k, v]) => '<button type="button" data-kind="' + k + '" aria-pressed="' + (k === addKind) + '">' + v[0] + "</button>").join("") + "</div>";
  if (addKind === "book") {
    f += open.length
      ? '<select class="in" name="pick" aria-label="Livro">' + opts + '</select><div class="pages"><label>da página<input class="in" name="from" type="number" min="1" inputmode="numeric"></label><label>até a página<input class="in" name="to" type="number" min="1" inputmode="numeric" required></label></div><button class="nbtn txt">registrar</button>'
      : '<p class="empty">Crie um livro na aba Conteúdo primeiro.</p>';
  } else {
    f += '<select class="in" name="pick" aria-label="Link">' + opts + '<option value="">+ novo link</option></select>' +
      '<input class="in" name="url" type="url" placeholder="cole o link"' + (open.length ? " hidden" : "") + '><button class="nbtn txt">registrar</button>';
  }
  h += block("Conteúdo", body, f + "</form>");

  $("day").innerHTML = h;
  prefill();
}
function prefill() {
  const f = $("day").querySelector('[data-add="content"]')?.elements;
  if (addKind === "book" && f?.pick) f.from.value = lastPage(f.pick.value) + 1;
}

function renderHabits() {
  $("habits").innerHTML = data.habits.length ? '<div class="sech"><h3>Hoje</h3><span class="label">' + data.habits.filter(x => done(TODAY, x.id)).length + " / " + data.habits.length + "</span></div>" +
    data.habits.map(x => {
      const s = streak(x.id);
      let dots = "";
      for (let i = 13; i >= 0; i--) { const k = addDays(TODAY, -i); dots += '<i class="' + (done(k, x.id) ? "on" : "") + '" title="' + fmt(k) + '"></i>'; }
      return '<div class="habit">' + habitCheck(x, TODAY) + del("habit", x.id, "Apagar hábito " + x.name) +
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
      '<span class="meta">' + (days.length ? days.length + (days.length > 1 ? " dias" : " dia") + " · desde " + fmt(days[0]) : "ainda sem registro") + (it.done ? " · terminado" : "") + "</span>" +
      '<div class="cact"><button type="button" data-done="' + it.id + '">' + (it.done ? "reabrir" : "terminei") + '</button><button type="button" data-ren="' + it.id + '">renomear</button><button type="button" data-idel="' + it.id + '">apagar</button></div></div></article>';
  }).join("") : '<p class="empty">Nada por aqui ainda.</p>';
}

function render() { renderCal(); renderDay(); renderHabits(); renderWorkouts(); renderEvents(); Object.keys(KINDS).forEach(renderList); }

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

$("day").addEventListener("click", e => {
  const k = e.target.closest("[data-kind]"); if (k) { addKind = k.dataset.kind; renderDay(); }
});
$("day").addEventListener("change", e => {
  if (e.target.name !== "pick") return;
  const url = e.target.form.elements.url;
  if (url) { url.hidden = !!e.target.value; if (!url.hidden) url.focus(); }
  prefill();
});
$("day").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target, f = form.elements, what = form.dataset.add;
  if (what === "event") data.events.push({ id: uid(), date: sel, time: f.time.value, title: f.title.value.trim() });
  else if (what === "workout") data.workouts.push({ id: uid(), date: sel, type: f.type.value, min: +f.min.value || null, note: "" });
  else {
    let id = f.pick?.value;
    if (addKind === "link" && !id) {
      const url = f.url.value.trim(); if (!url) return f.url.focus();
      const btn = form.querySelector(".nbtn"); btn.disabled = true; btn.textContent = "buscando…";
      id = newLink(await preview(url)).id;
    }
    if (!id) return;
    const en = { id: uid(), item: id };
    if (addKind === "book") { en.from = +f.from.value || null; en.to = +f.to.value || null; }
    (data.days[sel] ||= []).push(en);
  }
  save();
});

function newLink(p) {
  const it = { id: uid(), kind: "link", url: p.url, title: p.title, image: p.image, site: p.site, desc: p.desc, created: TODAY };
  data.items.push(it);
  return it;
}
const closeBox = form => { form.reset(); const d = form.closest("details"); if (d) d.open = false; };
$("addlink").onsubmit = async e => {
  e.preventDefault();
  const form = e.target, f = form.elements, btn = form.querySelector("button");
  btn.disabled = true; btn.textContent = "buscando…";
  const it = newLink(await preview(f.url.value.trim()));
  if (f.today.checked) (data.days[TODAY] ||= []).push({ id: uid(), item: it.id });
  btn.disabled = false; btn.textContent = "adicionar"; closeBox(form);
  save();
};
$("addbook").onsubmit = async e => {
  e.preventDefault();
  const form = e.target, f = form.elements, btn = form.querySelector("button"), title = f.title.value.trim(), author = f.author.value.trim();
  btn.disabled = true; btn.textContent = "procurando capa…";
  const image = f.cover.value.trim() || await findCover(title, author);
  data.items.push({ id: uid(), kind: "book", title, author, pages: +f.pages.value || null, image, created: TODAY });
  btn.disabled = false; btn.textContent = "criar livro"; closeBox(form);
  save();
};
$("addhabit").onsubmit = e => {
  e.preventDefault();
  data.habits.push({ id: uid(), name: e.target.elements.name.value.trim() });
  closeBox(e.target); save();
};
$("addworkout").elements.type.innerHTML = WTYPES.map(t => "<option>" + t + "</option>").join("");
$("addworkout").onsubmit = e => {
  e.preventDefault();
  const f = e.target.elements;
  data.workouts.push({ id: uid(), date: f.date.value, type: f.type.value, min: +f.min.value || null, note: f.note.value.trim() });
  closeBox(e.target); save();
};
$("addevent").onsubmit = e => {
  e.preventDefault();
  const f = e.target.elements;
  data.events.push({ id: uid(), date: f.date.value, time: f.time.value, title: f.title.value.trim() });
  closeBox(e.target); save();
};
// os formulários de data começam no dia de hoje
document.querySelectorAll('input[type=date]').forEach(i => { i.defaultValue = TODAY; });

document.addEventListener("change", e => {
  const t = e.target; if (!t.dataset.hk) return;
  const c = data.checks[t.dataset.day] ||= {};
  if (t.checked) c[t.dataset.hk] = 1; else delete c[t.dataset.hk];
  if (!Object.keys(c).length) delete data.checks[t.dataset.day];
  save();
});
document.addEventListener("click", e => {
  const b = e.target.closest("[data-done],[data-ren],[data-idel],[data-del]"); if (!b) return;
  if (b.dataset.del) {
    const [what, id] = b.dataset.del.split(":");
    if (what === "entry") {
      data.days[sel] = (data.days[sel] || []).filter(x => x.id !== id);
      if (!data.days[sel].length) delete data.days[sel];
    } else if (what === "workout") data.workouts = data.workouts.filter(x => x.id !== id);
    else if (what === "event") data.events = data.events.filter(x => x.id !== id);
    else if (what === "habit") {
      if (!confirm("Apagar este hábito e o histórico dele?")) return;
      data.habits = data.habits.filter(x => x.id !== id);
      for (const k in data.checks) { delete data.checks[k][id]; if (!Object.keys(data.checks[k]).length) delete data.checks[k]; }
    }
  } else {
    const it = itemOf(b.dataset.done || b.dataset.ren || b.dataset.idel); if (!it) return;
    if (b.dataset.done) it.done = !it.done;
    else if (b.dataset.ren) { const t = prompt("Novo título:", it.title); if (!t?.trim()) return; it.title = t.trim(); }
    else {
      if (!confirm("Apagar \"" + it.title + "\" e todos os registros dele?")) return;
      data.items = data.items.filter(x => x !== it);
      for (const k in data.days) { data.days[k] = data.days[k].filter(x => x.item !== it.id); if (!data.days[k].length) delete data.days[k]; }
    }
  }
  save();
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
  if (!confirm("Sair da aurora neste aparelho?")) return;
  await sb.auth.signOut();
  try { localStorage.removeItem(KEY); } catch {}
  data = norm(); render();
};
document.addEventListener("visibilitychange", () => { if (!document.hidden && user) pull(); });

render();
