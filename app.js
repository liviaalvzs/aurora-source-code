// Supabase: URL e chave pública (publishable/anon) do projeto. A segurança vem do RLS em supabase/schema.sql.
const SB_URL = "https://esxphcyqtjcrvijlgdde.supabase.co";
const SB_KEY = "sb_publishable_ChgKrC8ouh2PT4k5vJeF_w_CiUWVO12";
const KEY = "aurora-caderno";
const DOWL = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
const MONL = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const iso = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const norm = d => { d = d && typeof d === "object" ? d : {}; d.habits ||= []; d.reminders ||= []; d.log ||= {}; return d; };
let data;
try { data = norm(JSON.parse(localStorage.getItem(KEY))); } catch { data = norm(); }

// ponytail: um JSON por usuário, o último a salvar vence; editar em dois aparelhos ao mesmo tempo pode sobrescrever
const sb = supabase.createClient(SB_URL, SB_KEY);
let user = null, timer = null;
const status = t => { $("sync").textContent = t; };
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
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

const today = new Date(); today.setHours(0,0,0,0);
let sel = new Date(today);

const day = k => data.log[k] ||= { h: {}, r: {} };
const doneH = (k, id) => !!data.log[k]?.h?.[id];
const ratio = k => data.habits.length ? data.habits.filter(h => doneH(k, h.id)).length / data.habits.length : 0;
function streak(id) {
  let n = 0, d = new Date(sel);
  while (doneH(iso(d), id)) { n++; d = addDays(d, -1); }
  return n;
}

function render() {
  const k = iso(sel), isToday = +sel === +today;
  $("dow").textContent = DOWL[sel.getDay()] + (isToday ? " · hoje" : "");
  $("date").innerHTML = sel.getDate() + " <em>de " + MONL[sel.getMonth()] + "</em>";
  $("tod").hidden = isToday;

  let w = "";
  for (let i = -6; i <= 0; i++) {
    const d = addDays(sel, i), dk = iso(d);
    w += '<button type="button" class="wd' + (i === 0 ? " sel" : "") + (+d === +today ? " today" : "") + '" data-d="' + dk + '" aria-label="' + DOWL[d.getDay()] + ", " + d.getDate() + '">' +
      '<span class="label">' + DOWL[d.getDay()].slice(0,3) + '</span><span class="n">' + d.getDate() + '</span>' +
      '<span class="bar"><i style="width:' + Math.round(ratio(dk) * 100) + '%"></i></span></button>';
  }
  $("week").innerHTML = w;

  const dd = data.log[k] || { h: {}, r: {} };
  $("habits").innerHTML = data.habits.length ? data.habits.map(h => {
    const on = !!dd.h[h.id], s = streak(h.id);
    return '<li class="item' + (on ? " done" : "") + '"><label><input type="checkbox" data-h="' + h.id + '"' + (on ? " checked" : "") + '><span class="t">' + esc(h.name) + '</span></label>' +
      '<span class="meta">' + (s > 1 ? s + " dias seguidos" : "") + '</span><button type="button" class="del" data-hdel="' + h.id + '" aria-label="Apagar hábito ' + esc(h.name) + '">✕</button></li>';
  }).join("") : '<li class="empty">Nenhum hábito ainda. Adicione o primeiro abaixo.</li>';
  $("hcount").textContent = data.habits.filter(h => dd.h[h.id]).length + " / " + data.habits.length;

  const rems = [...data.reminders].sort((a, b) => (a.time || "99") < (b.time || "99") ? -1 : 1);
  $("reminders").innerHTML = rems.length ? rems.map(r => {
    const on = !!dd.r[r.id];
    return '<li class="item rem' + (on ? " done" : "") + '"><label><input type="checkbox" data-r="' + r.id + '"' + (on ? " checked" : "") + '><span class="t">' + (r.time ? '<span class="tm">' + r.time + '</span>' : "") + esc(r.text) + '</span></label>' +
      '<span></span><button type="button" class="del" data-rdel="' + r.id + '" aria-label="Apagar lembrete ' + esc(r.text) + '">✕</button></li>';
  }).join("") : '<li class="empty">Nenhum lembrete ainda. Eles se repetem todo dia.</li>';
  $("rcount").textContent = data.reminders.filter(r => dd.r[r.id]).length + " / " + data.reminders.length;
}

const go = d => { sel = d; render(); };
$("prev").onclick = () => go(addDays(sel, -1));
$("next").onclick = () => go(addDays(sel, 1));
$("tod").onclick = () => go(new Date(today));
$("week").onclick = e => { const b = e.target.closest("[data-d]"); if (b) go(new Date(b.dataset.d + "T00:00")); };

document.addEventListener("change", e => {
  const t = e.target, k = iso(sel);
  if (t.dataset.h) { if (t.checked) day(k).h[t.dataset.h] = 1; else delete day(k).h[t.dataset.h]; }
  else if (t.dataset.r) { if (t.checked) day(k).r[t.dataset.r] = 1; else delete day(k).r[t.dataset.r]; }
  else return;
  save(); render();
});
document.addEventListener("click", e => {
  const h = e.target.closest("[data-hdel]"), r = e.target.closest("[data-rdel]");
  if (h && confirm("Apagar este hábito?")) data.habits = data.habits.filter(x => x.id !== h.dataset.hdel);
  else if (r && confirm("Apagar este lembrete?")) data.reminders = data.reminders.filter(x => x.id !== r.dataset.rdel);
  else return;
  save(); render();
});
$("addhabit").onsubmit = e => {
  e.preventDefault();
  const name = e.target.elements.name.value.trim(); if (!name) return;
  data.habits.push({ id: crypto.randomUUID(), name });
  e.target.reset(); save(); render();
};
$("addrem").onsubmit = e => {
  e.preventDefault();
  const text = e.target.elements.text.value.trim(); if (!text) return;
  data.reminders.push({ id: crypto.randomUUID(), text, time: e.target.elements.time.value });
  e.target.reset(); save(); render();
};
$("tabbar").onclick = e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  $("tabbar").querySelectorAll("[data-tab]").forEach(x => {
    const on = x === b;
    x.setAttribute("aria-pressed", on);
    $(x.dataset.tab).hidden = !on;
  });
};

// login por link no e-mail
sb.auth.onAuthStateChange((_ev, session) => {
  const u = session?.user || null;
  if (u?.id === user?.id) return;
  user = u;
  document.body.classList.toggle("out", !user);
  if (user) pull();
});
$("login").onsubmit = async e => {
  e.preventDefault();
  const email = e.target.elements.email.value.trim(), msg = $("loginmsg");
  msg.textContent = "enviando…";
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  msg.textContent = error ? "Não deu: " + error.message : "Pronto! Abra o link que chegou no seu e-mail.";
};
$("logout").onclick = async () => {
  if (!confirm("Sair da aurora neste aparelho?")) return;
  await sb.auth.signOut();
  try { localStorage.removeItem(KEY); } catch {}
  data = norm(); render();
};
document.addEventListener("visibilitychange", () => { if (!document.hidden && user) pull(); });

render();
