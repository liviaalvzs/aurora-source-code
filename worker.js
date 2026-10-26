// Serve o site e, em /api/preview?url=..., devolve título, imagem e site de um link (tags og:/twitter:).
// ponytail: endpoint aberto, só lê metadados públicos; exigir login do Supabase se alguém abusar
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400" },
});

// o HTMLRewriter entrega atributos sem decodificar as entidades
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const decode = s => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname !== "/api/preview") return env.ASSETS.fetch(req);

    let target;
    try { target = new URL(u.searchParams.get("url")); } catch { return json({ error: "link inválido" }, 400); }
    if (!/^https?:$/.test(target.protocol)) return json({ error: "link inválido" }, 400);

    let res;
    try {
      res = await fetch(target, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; aurora-preview/1.0)", accept: "text/html,*/*" },
        redirect: "follow", signal: AbortSignal.timeout(8000), cf: { cacheTtl: 86400 },
      });
    } catch { return json({ error: "não abriu o link" }, 502); }

    const meta = {};
    let title = "";
    await new HTMLRewriter()
      .on("meta", { element(e) {
        const k = (e.getAttribute("property") || e.getAttribute("name") || "").toLowerCase(), v = e.getAttribute("content");
        if (k && v && !(k in meta)) meta[k] = decode(v.trim());
      } })
      .on("head > title", { text(t) { title += t.text; } })
      .transform(res).arrayBuffer();

    const abs = s => { try { return s ? new URL(s, res.url).href : ""; } catch { return ""; } };
    return json({
      url: res.url,
      title: meta["og:title"] || meta["twitter:title"] || decode(title.trim()) || target.hostname,
      // capas da Apple vêm em 1200 px; 300 px basta e carrega rápido no celular
      image: abs(meta["og:image"] || meta["og:image:url"] || meta["twitter:image"]).replace(/(mzstatic\.com\/.+\/)\d+x\d+(\w*-\d+\.\w+)$/, "$1300x300$2"),
      site: meta["og:site_name"] || new URL(res.url).hostname.replace(/^www\./, ""),
      desc: meta["og:description"] || meta["description"] || "",
    });
  },
};
