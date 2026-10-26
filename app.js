// Supabase: URL e chave pública (publishable/anon) do projeto. A segurança vem do RLS em supabase/schema.sql.
const SB_URL = "https://esxphcyqtjcrvijlgdde.supabase.co";
const SB_KEY = "sb_publishable_ChgKrC8ouh2PT4k5vJeF_w_CiUWVO12";
const KEY = "aurora-caderno";
const DOWL = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
const MONL = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const KINDS = { book: ["Livro", "▤"], podcast: ["Podcast", "◉"], text: ["Texto", "¶"] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const iso = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
const fmt = k => { const d = new Date(k + "T00:00"); return d.getDate() + " " + MONL[d.getMonth()].slice(0, 3); };
const uid = () => crypto.randomUUID();

// items: livros, podcasts e textos; days: { "2026-10-26": [{ id, item, from?, to? }] }
const norm = d => { d = d && typeof d === "object" ? d : {}; d.items ||= []; d.days ||= {}; return d; };
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

function renderCal() {
  $("month").textContent = MONL[view.getMonth()] + " " + view.getFullYear();
  const y = view.getFullYear(), m = view.getMonth();
  const off = (view.getDay() + 6) % 7, last = new Date(y, m + 1, 0).getDate();
  let h = ["seg","ter","qua","qui","sex","sáb","dom"].map(d => '<span class="dow">' + d + '</span>').join("") + "<span></span>".repeat(off);
  for (let n = 1; n <= last; n++) {
    const k = iso(new Date(y, m, n));
    const its = [...new Set((data.days[k] || []).map(e => e.item))].map(itemOf).filter(Boolean);
    h += '<button type="button" class="cd' + (k === sel ? " sel" : "") + (k === TODAY ? " today" : "") + '" data-d="' + k + '" aria-label="' + n + " de " + MONL[m] + (its.length ? ", " + its.length + " registros" : "") + '">' +
      '<span class="n">' + n + '</span><span class="ths">' + its.slice(0, 3).map(it => thumb(it, "mini")).join("") +
      (its.length > 3 ? '<span class="more">+' + (its.length - 3) + '</span>' : "") + '</span></button>';
  }
  $("cal").innerHTML = h;
}

function renderDay() {
  const d = new Date(sel + "T00:00"), es = data.days[sel] || [];
  let h = '<div class="sech"><h3>' + d.getDate() + " de " + MONL[d.getMonth()] + '</h3><span class="label">' + DOWL[d.getDay()] + (sel === TODAY ? " · hoje" : "") + '</span></div>';
  h += es.length ? '<ul class="list">' + es.map(e => {
    const it = itemOf(e.item); if (!it) return "";
    const pages = e.from || e.to ? " · p. " + (e.from || "?") + "–" + (e.to || "?") : "";
    return '<li class="entry">' + thumb(it, "th") + '<div class="eb"><span class="et">' + esc(it.title) + '</span><span class="meta">' + KINDS[it.kind][0] + pages + '</span></div>' +
      '<button type="button" class="del" data-edel="' + e.id + '" aria-label="Tirar do dia">✕</button></li>';
  }).join("") + "</ul>" : '<p class="empty">Nada registrado neste dia.</p>';

  const open = data.items.filter(i => i.kind === addKind && !i.done);
  h += '<form class="addentry" id="addentry"><span class="flabel">registrar neste dia</span><div class="seg">' +
    Object.entries(KINDS).map(([k, v]) => '<button type="button" data-kind="' + k + '" aria-pressed="' + (k === addKind) + '">' + v[0] + '</button>').join("") + '</div>';
  const opts = open.map(i => '<option value="' + i.id + '">' + esc(i.title) + '</option>').join("");
  if (addKind === "book") {
    h += open.length
      ? '<select class="in" name="pick" aria-label="Livro">' + opts + '</select><div class="pages"><label>da página<input class="in" name="from" type="number" min="1" inputmode="numeric"></label><label>até a página<input class="in" name="to" type="number" min="1" inputmode="numeric" required></label></div><button class="nbtn txt">registrar</button>'
      : '<p class="empty">Crie um livro na aba Livros primeiro.</p>';
  } else {
    h += '<select class="in" name="pick" aria-label="' + KINDS[addKind][0] + '">' + opts + '<option value="">+ novo link</option></select>' +
      '<input class="in" name="url" type="url" placeholder="cole o link"' + (open.length ? " hidden" : "") + '><button class="nbtn txt">registrar</button>';
  }
  $("day").innerHTML = h + "</form>";
  prefill();
}
function prefill() {
  const f = $("addentry")?.elements;
  if (addKind === "book" && f?.pick) f.from.value = lastPage(f.pick.value) + 1;
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

function render() { renderCal(); renderDay(); Object.keys(KINDS).forEach(renderList); }

// ---------- ações ----------
$("mprev").onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCal(); };
$("mnext").onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCal(); };
$("cal").onclick = e => {
  const b = e.target.closest("[data-d]"); if (!b) return;
  sel = b.dataset.d; renderCal(); renderDay();
  // no celular o painel do dia fica abaixo do calendário: traz ele para a vista
  const r = $("day").getBoundingClientRect();
  if (r.top > innerHeight - 160) $("day").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" });
};

$("day").addEventListener("click", e => {
  const k = e.target.closest("[data-kind]"); if (k) { addKind = k.dataset.kind; renderDay(); }
});
$("day").addEventListener("change", e => {
  if (e.target.name !== "pick") return;
  const url = $("addentry").elements.url;
  if (url) { url.hidden = !!e.target.value; if (!url.hidden) url.focus(); }
  prefill();
});
$("day").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target.elements, btn = e.target.querySelector("button:not([data-kind])");
  let id = f.pick?.value;
  if (addKind !== "book" && !id) {
    const url = f.url.value.trim(); if (!url) return f.url.focus();
    btn.disabled = true; btn.textContent = "buscando…";
    id = newLink(addKind, await preview(url)).id;
  }
  if (!id) return;
  const en = { id: uid(), item: id };
  if (addKind === "book") { en.from = +f.from.value || null; en.to = +f.to.value || null; }
  (data.days[sel] ||= []).push(en);
  save();
});

function newLink(kind, p) {
  const it = { id: uid(), kind, url: p.url, title: p.title, image: p.image, site: p.site, desc: p.desc, created: TODAY };
  data.items.push(it);
  return it;
}
document.querySelectorAll(".addlink").forEach(form => form.onsubmit = async e => {
  e.preventDefault();
  const f = form.elements, btn = form.querySelector("button");
  btn.disabled = true; btn.textContent = "buscando…";
  const it = newLink(form.dataset.kind, await preview(f.url.value.trim()));
  if (f.today.checked) (data.days[TODAY] ||= []).push({ id: uid(), item: it.id });
  form.reset(); btn.disabled = false; btn.textContent = "adicionar"; form.closest("details").open = false;
  save();
});
$("addbook").onsubmit = async e => {
  e.preventDefault();
  const f = e.target.elements, btn = e.target.querySelector("button"), title = f.title.value.trim(), author = f.author.value.trim();
  btn.disabled = true; btn.textContent = "procurando capa…";
  const image = f.cover.value.trim() || await findCover(title, author);
  data.items.push({ id: uid(), kind: "book", title, author, pages: +f.pages.value || null, image, created: TODAY });
  e.target.reset(); btn.disabled = false; btn.textContent = "criar livro"; e.target.closest("details").open = false;
  save();
};

document.addEventListener("click", e => {
  const b = e.target.closest("[data-done],[data-ren],[data-idel],[data-edel]"); if (!b) return;
  if (b.dataset.edel) {
    data.days[sel] = (data.days[sel] || []).filter(x => x.id !== b.dataset.edel);
    if (!data.days[sel].length) delete data.days[sel];
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
