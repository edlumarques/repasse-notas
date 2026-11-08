// Repasse de Notas – app (administração e visão do sócio)
(function () {
  const CFG = window.APP_CONFIG, C = window.Calc;
  const $ = s => document.querySelector(s);
  const app = $("#app");
  const brl = C.brl;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const dbr = s => s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "";
  const pct = x => (x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";
  const cents = v => Math.round(Number(v || 0) * 100);
  const reais = c => c / 100;
  const mesDe = d => d.slice(0, 7);
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 3200); }
  function ultimoDia(ym) { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }

  const S = { sb: null, user: null, perfil: null, param: C.PADRAO, socios: [], usuarios: [], notas: [], atrib: {}, fechados: new Set(),
    de: "", ate: "", tab: "notas", busca: "", soPend: false, soAlert: false };

  /* ================= início e login ================= */
  async function boot() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      app.innerHTML = `<div class="login panel"><h1>Configuração pendente</h1><p class="muted">Preencha SUPABASE_URL e SUPABASE_ANON_KEY em <code>js/config.js</code>.</p></div>`; return;
    }
    S.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    const { data } = await S.sb.auth.getSession();
    S.sb.auth.onAuthStateChange((ev, sess) => { if (ev === "SIGNED_IN" && !S.user) entrar(sess); if (ev === "SIGNED_OUT") { S.user = null; telaLogin(); } });
    if (data.session) entrar(data.session); else telaLogin();
  }
  function telaLogin(msg) {
    app.innerHTML = `<div class="login panel">
      <h1>Repasse de Notas</h1>
      <p class="muted">${esc(CFG.EMPRESA.razao)}</p>
      <form id="fLogin">
        <label class="field" for="email">E-mail<input type="email" id="email" required autocomplete="username"></label>
        <label class="field" for="senha">Senha<input type="password" id="senha" required autocomplete="current-password"></label>
        <button class="primary" type="submit" id="btnEntrar">Entrar</button>
      </form>
      <p class="note" id="loginMsg">${msg ? esc(msg) : "O acesso é criado pela administração. Esqueceu a senha? Peça uma nova à administração."}</p>
    </div>`;
    $("#fLogin").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("#btnEntrar"); btn.disabled = true; btn.textContent = "Entrando…";
      const { data, error } = await S.sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#senha").value });
      if (error) {
        btn.disabled = false; btn.textContent = "Entrar";
        const t = (error.message || "").toLowerCase();
        $("#loginMsg").textContent = t.includes("invalid") ? "E-mail ou senha incorretos." : t.includes("not confirmed") ? "Acesso ainda não confirmado. Peça à administração para confirmar o usuário." : "Não foi possível entrar: " + error.message;
        return;
      }
      entrar(data.session);
    });
  }
  function trocarSenha() {
    const box = document.createElement("section");
    box.className = "panel"; box.id = "boxSenha";
    box.innerHTML = `<form id="fSenha" class="controls">
        <label class="field" for="s1">Nova senha (mínimo 8 caracteres)<input type="password" id="s1" minlength="8" required autocomplete="new-password"></label>
        <label class="field" for="s2">Repita a nova senha<input type="password" id="s2" minlength="8" required autocomplete="new-password"></label>
        <button class="primary" type="submit">Salvar senha</button><button type="button" id="cancSenha">Cancelar</button>
        <span class="note" id="senhaMsg"></span></form>`;
    $("#boxSenha")?.remove(); app.insertBefore(box, app.children[1]);
    $("#cancSenha").onclick = () => box.remove();
    $("#fSenha").onsubmit = async e => {
      e.preventDefault();
      if ($("#s1").value !== $("#s2").value) { $("#senhaMsg").textContent = "As senhas não conferem."; return; }
      const { error } = await S.sb.auth.updateUser({ password: $("#s1").value });
      if (error) { $("#senhaMsg").textContent = "Não salvou: " + error.message; return; }
      box.remove(); toast("Senha alterada");
    };
  }
  async function entrar(sess) {
    S.user = sess.user;
    const { data, error } = await S.sb.from("usuarios").select("papel, socio_id").eq("user_id", S.user.id).maybeSingle();
    if (error || !data) {
      app.innerHTML = `<div class="login panel"><h1>Acesso ainda não liberado</h1><p class="muted">Seu login (${esc(S.user.email)}) existe, mas ainda não foi ligado a um sócio ou administrador.</p><button id="sair">Sair</button></div>`;
      $("#sair").onclick = () => S.sb.auth.signOut(); return;
    }
    S.perfil = data;
    const p = await S.sb.from("parametros").select("*").order("vigencia_ini", { ascending: false }).limit(1).maybeSingle();
    if (p.data) { S.param = {}; for (const k in C.PADRAO) S.param[k] = Number(p.data[k]); }
    const ult = await S.sb.from("notas").select("emissao").order("emissao", { ascending: false }).limit(1).maybeSingle();
    const ym = ult.data ? mesDe(ult.data.emissao) : new Date().toISOString().slice(0, 7);
    S.de = ym + "-01"; S.ate = ultimoDia(ym);
    await carregar();
  }

  /* ================= dados ================= */
  const COLS = "id,numero,emissao,competencia,tomador_tipo,tomador_nome,categoria,discriminacao,valor_servicos,desconto,base_calculo,aliquota_iss,valor_iss,iss_retido,pis_informado,cofins_informado,ir_informado,csll_informado,liquido,ibs,cbs,pis_ret,cofins_ret,ir_ret,csll_ret,iss_ret,alertas,conferido,cancelada";
  function paraCalc(r) {
    const ret = { pis: cents(r.pis_ret), cof: cents(r.cofins_ret), csl: cents(r.csll_ret), irr: cents(r.ir_ret), iss: cents(r.iss_ret) };
    ret.total = ret.pis + ret.cof + ret.csl + ret.irr + ret.iss;
    return { id: r.id, n: r.numero, e: r.emissao, tp: r.tomador_tipo, t: r.tomador_nome, s: r.categoria, disc: r.discriminacao,
      v: cents(r.valor_servicos), dc: cents(r.desconto), b: cents(r.base_calculo), al: Number(r.aliquota_iss), iss: cents(r.valor_iss), ir: r.iss_retido,
      pis: cents(r.pis_informado), cof: cents(r.cofins_informado), irr: cents(r.ir_informado), csl: cents(r.csll_informado),
      liq: cents(r.liquido), ibs: cents(r.ibs), cbs: cents(r.cbs), x: r.cancelada, ret, alertas: r.alertas || [], conferido: r.conferido };
  }
  async function carregar() {
    const sb = S.sb, admin = S.perfil.papel === "admin";
    const [so, no, fe, us] = await Promise.all([
      sb.from("socios").select("*").order("nome"),
      sb.from("notas").select(COLS).gte("emissao", S.de).lte("emissao", S.ate).order("numero"),
      sb.from("fechamentos").select("competencia"),
      admin ? sb.from("usuarios").select("user_id,papel,socio_id") : Promise.resolve({ data: [] })
    ]);
    if (no.error) { toast("Erro ao carregar notas: " + no.error.message); }
    S.socios = so.data || []; S.usuarios = us.data || [];
    S.notas = (no.data || []).map(paraCalc);
    S.fechados = new Set((fe.data || []).map(f => mesDe(f.competencia)));
    S.atrib = {};
    const ids = S.notas.map(n => n.id);
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb.from("atribuicoes").select("nota_id,socio_id,percentual").in("nota_id", ids.slice(i, i + 150));
      (data || []).forEach(a => { (S.atrib[a.nota_id] ||= {})[a.socio_id] = Number(a.percentual); });
    }
    render();
  }
  const ativos = () => S.socios.filter(s => s.ativo);
  const pendentes = n => n.conferido ? [] : n.alertas.filter(a => a[0] !== "info");
  const atribOk = a => a && Math.abs(Object.values(a).reduce((x, y) => x + Number(y), 0) - 100) < 0.001;
  const periodoFechado = () => { const ms = mesesDoPeriodo(); return ms.length > 0 && ms.every(m => S.fechados.has(m)); };
  function mesesDoPeriodo() { const out = []; let [y, m] = S.de.split("-").map(Number); const [y2, m2] = S.ate.split("-").map(Number); while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } return out; }
  const notaFechada = n => S.fechados.has(mesDe(n.e));

  /* ================= importação ================= */
  async function importar(files) {
    toast("Lendo arquivos…");
    const { notas, erros } = await NFXml.lerArquivos(files);
    const outras = notas.filter(n => n.cnpj_prestador !== CFG.EMPRESA.cnpj);
    const rows = notas.filter(n => n.cnpj_prestador === CFG.EMPRESA.cnpj).map(n => {
      const c = C.conferir(n, S.param);
      return { cnpj_prestador: n.cnpj_prestador, numero: n.n, emissao: n.e, competencia: n.comp, tomador_tipo: n.tp, tomador_doc: n.doc,
        tomador_nome: n.t, categoria: n.s, discriminacao: n.disc, valor_servicos: reais(n.v), desconto: reais(n.dc), base_calculo: reais(n.b),
        aliquota_iss: n.al, valor_iss: reais(n.iss), iss_retido: n.ir, pis_informado: reais(n.pis), cofins_informado: reais(n.cof),
        ir_informado: reais(n.irr), csll_informado: reais(n.csl), liquido: reais(n.liq), ibs: reais(n.ibs), cbs: reais(n.cbs),
        pis_ret: reais(c.ret.pis), cofins_ret: reais(c.ret.cof), ir_ret: reais(c.ret.irr), csll_ret: reais(c.ret.csl), iss_ret: reais(c.ret.iss),
        alertas: c.alertas, cancelada: n.x, xml: n.xml };
    });
    let ok = 0, bloqueadas = 0, falhas = 0;
    for (let i = 0; i < rows.length; i += 25) {
      const lote = rows.slice(i, i + 25);
      const { error } = await S.sb.from("notas").upsert(lote, { onConflict: "cnpj_prestador,numero" });
      if (!error) { ok += lote.length; continue; }
      for (const r of lote) {
        const e2 = (await S.sb.from("notas").upsert(r, { onConflict: "cnpj_prestador,numero" })).error;
        if (!e2) ok++; else if (/fechado/i.test(e2.message)) bloqueadas++; else falhas++;
      }
    }
    const partes = [`${ok} nota(s) importada(s)`];
    if (bloqueadas) partes.push(`${bloqueadas} em mês fechado (ignoradas)`);
    if (outras.length) partes.push(`${outras.length} de outro CNPJ (ignoradas)`);
    if (falhas || erros.length) partes.push(`${falhas + erros.length} com erro`);
    toast(partes.join(" · "));
    if (ok) {
      const datas = rows.map(r => r.emissao).sort();
      const ym = mesDe(datas[datas.length - 1]);
      if (datas[0] < S.de || datas[datas.length - 1] > S.ate) { S.de = ym + "-01"; S.ate = ultimoDia(ym); }
    }
    await carregar();
  }

  /* ================= atribuição ================= */
  async function salvarAtrib(nota, mapa) {
    if (notaFechada(nota)) { toast("Mês fechado: reabra na aba Fechamento para alterar"); return; }
    const antes = S.atrib[nota.id];
    if (mapa && Object.keys(mapa).length) S.atrib[nota.id] = mapa; else delete S.atrib[nota.id];
    render();
    const d = await S.sb.from("atribuicoes").delete().eq("nota_id", nota.id);
    let err = d.error;
    if (!err && mapa && Object.keys(mapa).length) {
      err = (await S.sb.from("atribuicoes").insert(Object.entries(mapa).map(([sid, p]) => ({ nota_id: nota.id, socio_id: sid, percentual: Math.max(0.01, Number(p)) })))).error;
    }
    if (err) { if (antes) S.atrib[nota.id] = antes; else delete S.atrib[nota.id]; render(); toast("Não salvou: " + err.message); }
  }
  function alternar(nota, sid) {
    const a = { ...(S.atrib[nota.id] || {}) };
    if (sid in a) delete a[sid]; else a[sid] = 0;
    const ids = Object.keys(a);
    if (ids.length) { const eq = Math.floor(10000 / ids.length) / 100; ids.forEach((id, i) => a[id] = i === ids.length - 1 ? +(100 - eq * (ids.length - 1)).toFixed(2) : eq); }
    salvarAtrib(nota, ids.length ? a : null);
  }
  async function emLote(sid, lista) {
    const alvo = lista.filter(n => !n.x && !S.atrib[n.id] && !notaFechada(n));
    if (!alvo.length) { toast("Nenhuma nota sem sócio nos filtros"); return; }
    const { error } = await S.sb.from("atribuicoes").insert(alvo.map(n => ({ nota_id: n.id, socio_id: sid, percentual: 100 })));
    if (error) { toast("Não salvou: " + error.message); return; }
    alvo.forEach(n => S.atrib[n.id] = { [sid]: 100 });
    toast(`${alvo.length} nota(s) atribuída(s) a ${S.socios.find(s => s.id === sid).nome}`); render();
  }
  async function marcarConferido(nota, texto) {
    const { error } = await S.sb.from("notas").update({ conferido: texto }).eq("id", nota.id);
    if (error) { toast("Não salvou: " + error.message); return; }
    nota.conferido = texto; render();
  }

  /* ================= telas comuns ================= */
  function cabecalho() {
    const socio = S.perfil.papel === "socio" ? S.socios.find(s => s.id === S.perfil.socio_id) : null;
    return `<header class="top">
      <div style="display:grid;gap:4px"><h1>${socio ? "Minha produção" : "Repasse de notas fiscais aos sócios"}</h1>
      <div class="muted">${esc(CFG.EMPRESA.razao)} · ${esc(CFG.EMPRESA.cidade)}</div></div>
      <div class="chips"><span class="chip">${socio ? esc(socio.nome) : "Administração"}</span><span class="muted" style="font-size:13px">${esc(S.user.email)}</span><button class="x" id="trocaSenha">Trocar senha</button><button class="x" id="sair">Sair</button></div>
    </header>`;
  }
  function controlesPeriodo(extra = "") {
    const st = periodoFechado() ? `<span class="chip ok">Período fechado</span>` : `<span class="chip warn">Período aberto: valores parciais</span>`;
    return `<section class="panel controls">
      <label class="field" for="de">De<input type="date" id="de" value="${S.de}"></label>
      <label class="field" for="ate">Até<input type="date" id="ate" value="${S.ate}"></label>
      <div class="field"><span>Atalhos</span><div style="display:flex;gap:6px"><button class="x" data-mes="-1">Mês anterior</button><button class="x" data-mes="0">Este mês</button><button class="x" data-mes="+1">Próximo mês</button></div></div>
      <div class="field"><span>Situação</span>${st}</div>${extra}
    </section>`;
  }
  function ligarComuns() {
    $("#sair").onclick = () => S.sb.auth.signOut();
    $("#trocaSenha").onclick = trocarSenha;
    $("#de").onchange = e => { S.de = e.target.value; carregar(); };
    $("#ate").onchange = e => { S.ate = e.target.value; carregar(); };
    document.querySelectorAll("[data-mes]").forEach(b => b.onclick = () => {
      let [y, m] = S.de.split("-").map(Number); m += Number(b.dataset.mes); if (b.dataset.mes === "0") { const d = new Date(); y = d.getFullYear(); m = d.getMonth() + 1; }
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      const ym = `${y}-${String(m).padStart(2, "0")}`; S.de = ym + "-01"; S.ate = ultimoDia(ym); carregar();
    });
  }
  const tile = (k, v, s, cls = "") => `<div class="tile ${cls}"><span class="k">${k}</span><span class="v">${v}</span>${s ? `<span class="s">${s}</span>` : ""}</div>`;

  function render() { if (S.perfil.papel === "admin") renderAdmin(); else renderSocio(); }

  /* ================= visão do sócio ================= */
  function renderSocio() {
    const sid = S.perfil.socio_id;
    const itens = S.notas.filter(n => !n.x && S.atrib[n.id] && S.atrib[n.id][sid])
      .map(n => ({ nota: n, percentual: S.atrib[n.id][sid], ...C.parte(n.b, S.atrib[n.id][sid], S.param) }));
    const tp = itens.reduce((s, i) => s + i.produzido, 0), tr = itens.reduce((s, i) => s + i.repasse, 0);
    const nome = (S.socios.find(s => s.id === sid) || {}).nome || "Sócio";
    app.innerHTML = cabecalho() + controlesPeriodo(`<div class="field"><span>Relatório</span><button class="primary" id="pdfMeu">Baixar PDF</button></div>`) +
      `<section class="tiles">${tile("Notas no período", String(itens.length))}${tile("Produzido", brl(tp), "valor das notas, na sua parte")}${tile("Repasse (85%)", brl(tr), periodoFechado() ? "definitivo" : "parcial: mês ainda aberto", periodoFechado() ? "" : "warn")}</section>
      <section class="panel"><div class="tablewrap"><table><thead><tr><th>Nº</th><th>Emissão</th><th>Tomador · serviço</th><th class="r">Valor da nota</th><th class="r">Sua parte</th><th class="r">Produzido</th><th class="r">Repasse</th></tr></thead><tbody>
      ${itens.map(i => `<tr><td class="num">${i.nota.n}</td><td class="num">${dbr(i.nota.e)}</td><td><div class="tomador">${esc(i.nota.t)}</div><div class="serv">${esc(i.nota.s)}</div></td><td class="r num">${brl(i.nota.b)}</td><td class="r num">${i.percentual.toLocaleString("pt-BR")}%</td><td class="r num">${brl(i.produzido)}</td><td class="r num">${brl(i.repasse)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">Nenhuma nota sua neste período.</td></tr>`}
      ${itens.length ? `<tr class="tot"><td colspan="5">Total</td><td class="r num">${brl(tp)}</td><td class="r num">${brl(tr)}</td></tr>` : ""}
      </tbody></table></div></section>`;
    ligarComuns();
    $("#pdfMeu").onclick = () => PDF.socio({ nome, de: S.de, ate: S.ate, itens, fechado: periodoFechado() });
  }

  /* ================= visão da administração ================= */
  const ABAS = [["notas", "Notas e atribuição"], ["apuracao", "Apuração"], ["repasse", "Repasse"], ["relatorio", "Relatórios"], ["fechamento", "Fechamento"], ["socios", "Sócios e acessos"]];
  function renderAdmin() {
    const ap = C.apurar(S.notas, S.de, S.ate, S.param);
    const rep = C.repasse(S.notas, S.atrib, S.socios, S.param);
    const val = S.notas.filter(n => !n.x), atrib = val.length - rep.sem.notas, nAlert = val.filter(n => pendentes(n).length).length;
    app.innerHTML = cabecalho() +
      controlesPeriodo(`<div class="field"><span>Importar notas</span><label class="btn primary" for="fileInput">Carregar .zip ou XML<input id="fileInput" type="file" accept=".zip,.xml" multiple></label></div>`) +
      `<section class="tiles">
        ${tile("Faturamento", brl(ap.faturamento), `${ap.notas} notas válidas` + (S.notas.length > val.length ? ` · ${S.notas.length - val.length} cancelada(s)` : ""))}
        ${tile("Impostos devidos", brl(ap.devTotal), pct(ap.faturamento ? ap.devTotal / ap.faturamento : 0) + " do faturamento")}
        ${tile("Retidos pelos tomadores", brl(ap.retTotal), "abatem do que falta recolher")}
        ${tile("Repasse aos sócios (85%)", brl(ap.repasseTotal), rep.sem.notas ? `${brl(rep.sem.repasse)} sem sócio` : "todas atribuídas", rep.sem.notas ? "warn" : "")}
        ${tile("Sobra da reserva", brl(ap.sobra), "15% − impostos devidos", ap.sobra < 0 ? "bad" : "")}
        ${tile("Notas atribuídas", `${atrib} de ${val.length}`, `<span class="bar"><span style="width:${val.length ? atrib / val.length * 100 : 0}%"></span></span>`, rep.sem.notas ? "warn" : "")}
        ${tile("Alertas pendentes", String(nAlert), "", nAlert ? "warn" : "")}
      </section>
      <nav class="tabs" role="tablist">${ABAS.map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${t}</button>`).join("")}</nav>
      <section class="panel" id="conteudo"></section>`;
    ligarComuns();
    $("#fileInput").onchange = e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) importar(f); };
    document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; renderAdmin(); });
    ({ notas: abaNotas, apuracao: abaApuracao, repasse: abaRepasse, relatorio: abaRelatorio, fechamento: abaFechamento, socios: abaSocios })[S.tab]($("#conteudo"), ap, rep);
  }

  function abaNotas(el) {
    const q = S.busca.toLowerCase();
    const lista = S.notas.filter(n => {
      if (S.soPend && (n.x || atribOk(S.atrib[n.id]))) return false;
      if (S.soAlert && !pendentes(n).length) return false;
      if (q && !(String(n.n).includes(q) || (n.t || "").toLowerCase().includes(q) || (n.s || "").toLowerCase().includes(q) || (n.disc || "").toLowerCase().includes(q))) return false;
      return true;
    });
    const so = ativos();
    el.innerHTML = `<div class="toolbar">
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          <label for="busca">Buscar <input type="search" id="busca" value="${esc(S.busca)}" placeholder="nº, paciente, tomador ou serviço"></label>
          <label for="soPend"><input type="checkbox" id="soPend" ${S.soPend ? "checked" : ""}> Só sem sócio</label>
          <label for="soAlert"><input type="checkbox" id="soAlert" ${S.soAlert ? "checked" : ""}> Só com alerta</label>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="muted" style="font-size:13px">Atribuir as filtradas sem sócio a:</span>
          <span class="socios">${so.map(s => `<button class="sbtn lote" data-sid="${s.id}">${esc(s.nome)}</button>`).join("")}</span></div>
      </div>
      ${so.length ? "" : `<p class="note err">Cadastre os sócios na aba “Sócios e acessos” antes de atribuir.</p>`}
      ${S.notas.length ? "" : `<p class="note">Nenhuma nota neste período. Use “Carregar .zip ou XML” para importar.</p>`}
      <div class="tablewrap"><table><thead><tr><th>Nº</th><th>Emissão</th><th>Tomador · serviço</th><th class="r">Valor</th><th class="r">ISS</th><th class="r">Retido</th><th>Alertas</th><th>Sócio(s)</th></tr></thead><tbody>
      ${lista.map(n => linhaNota(n, so)).join("") || `<tr><td colspan="8" class="muted">Nenhuma nota com esses filtros.</td></tr>`}
      </tbody></table></div>`;
    const reabrirBusca = () => { const i = $("#busca"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    $("#busca").oninput = e => { S.busca = e.target.value; abaNotas(el); reabrirBusca(); };
    $("#soPend").onchange = e => { S.soPend = e.target.checked; abaNotas(el); };
    $("#soAlert").onchange = e => { S.soAlert = e.target.checked; abaNotas(el); };
    const byId = id => S.notas.find(n => n.id === id);
    el.querySelectorAll(".sbtn.lote").forEach(b => b.onclick = () => emLote(b.dataset.sid, lista));
    el.querySelectorAll(".sbtn[data-nota]").forEach(b => b.onclick = () => alternar(byId(b.dataset.nota), b.dataset.sid));
    el.querySelectorAll(".split input").forEach(i => i.onchange = () => {
      const n = byId(i.dataset.nota); const a = { ...S.atrib[n.id] }; a[i.dataset.sid] = Math.max(0.01, Math.min(100, Number(i.value) || 0.01)); salvarAtrib(n, a);
    });
    el.querySelectorAll(".confere").forEach(b => b.onclick = () => marcarConferido(byId(b.dataset.nota), "Conferido"));
    el.querySelectorAll(".desfaz").forEach(b => b.onclick = () => marcarConferido(byId(b.dataset.nota), null));
  }
  function linhaNota(n, so) {
    const a = S.atrib[n.id], fechada = notaFechada(n);
    let split = "";
    if (a && Object.keys(a).length > 1) {
      const soma = Object.values(a).reduce((x, y) => x + Number(y), 0);
      split = `<div class="split">` + Object.keys(a).map(id => { const s = S.socios.find(z => z.id === id); return s ? `<label for="p-${n.id}-${id}">${esc(s.nome)} <input type="number" min="0.01" max="100" step="0.01" id="p-${n.id}-${id}" data-nota="${n.id}" data-sid="${id}" value="${a[id]}" ${fechada ? "disabled" : ""}>%</label>` : ""; }).join("") +
        (Math.abs(soma - 100) > 0.001 ? `<span class="err">soma ${soma.toLocaleString("pt-BR")}%</span>` : "") + `</div>`;
    }
    const temAlerta = n.alertas.some(x => x[0] !== "info");
    return `<tr class="${n.x ? "cancel" : ""}"><td class="num">${n.n}</td><td class="num">${dbr(n.e)}</td>
      <td><div class="tomador">${esc(n.t)} <span class="chip ${n.tp === "PJ" ? "" : "ok"}" style="font-size:11px">${n.tp}</span></div><div class="serv" title="${esc(n.disc)}">${esc(n.s)}${n.dc ? ` · desconto ${brl(n.dc)}` : ""}</div></td>
      <td class="r num">${brl(n.b)}</td><td class="r num">${brl(n.iss)}</td><td class="r num">${n.ret.total ? brl(n.ret.total) : "—"}</td>
      <td><div class="alerts">${n.alertas.map(x => `<span class="alert ${n.conferido && x[0] !== "info" ? "info" : x[0]}">${esc(x[1])}</span>`).join("")}
        ${n.conferido ? `<span class="chip ok">${esc(n.conferido)}</span> <button class="x desfaz" data-nota="${n.id}">Desfazer</button>` : (temAlerta ? `<button class="x confere" data-nota="${n.id}">Marcar como conferido</button>` : "")}</div></td>
      <td>${n.x ? "" : `<div class="socios">${so.map(s => `<button class="sbtn" data-nota="${n.id}" data-sid="${s.id}" aria-pressed="${a && s.id in a}" ${fechada ? "disabled" : ""}>${esc(s.nome)}</button>`).join("")}</div>${split}`}</td></tr>`;
  }

  function abaApuracao(el, ap) {
    let tD = 0, tR = 0;
    el.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Tributo</th><th class="r">Devido</th><th class="r">Retido</th><th class="r">A recolher</th><th>Período</th></tr></thead><tbody>
      ${ap.linhas.map(([t, d, r, p]) => { tD += d; tR += r; const ar = d - r; return `<tr><td>${t}</td><td class="r num">${brl(d)}</td><td class="r num">${brl(r)}</td><td class="r num">${ar < 0 ? `<span class="chip warn">${brl(ar)} saldo a compensar</span>` : brl(ar)}</td><td class="muted">${p}</td></tr>`; }).join("")}
      <tr class="tot"><td>Total</td><td class="r num">${brl(tD)}</td><td class="r num">${brl(tR)}</td><td class="r num">${brl(tD - tR)}</td><td></td></tr>
      <tr><td class="muted">IBS (teste, 0,1%)</td><td class="r num muted">${brl(ap.ibs)}</td><td></td><td class="muted">informativo</td><td></td></tr>
      <tr><td class="muted">CBS (teste, 0,9%)</td><td class="r num muted">${brl(ap.cbs)}</td><td></td><td class="muted">informativo</td><td></td></tr>
      </tbody></table></div>
      <p class="note">Período de ${ap.meses} mês(es). Presunção ${pct(S.param.presuncao_ir)} (IRPJ) e ${pct(S.param.presuncao_cs)} (CSLL). IRPJ e CSLL são trimestrais e aparecem aqui como estimativa do período. O adicional de IRPJ entra quando a base passa de R$ ${S.param.limite_adicional_mes.toLocaleString("pt-BR")} por mês. Valores para conferência; a apuração oficial é do contador.</p>`;
  }
  function abaRepasse(el, ap, rep) {
    el.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Sócio</th><th class="r">Notas</th><th class="r">Produzido</th><th class="r">Repasse 85%</th><th class="r">% do total</th></tr></thead><tbody>
      ${S.socios.map(s => { const r = rep.socios[s.id]; if (!r.notas && !s.ativo) return ""; return `<tr><td>${esc(s.nome)}${s.ativo ? "" : ` <span class="chip">inativo</span>`}</td><td class="r num">${r.notas}</td><td class="r num">${brl(r.produzido)}</td><td class="r num">${brl(r.repasse)}</td><td class="r num">${pct(ap.repasseTotal ? r.repasse / ap.repasseTotal : 0)}</td></tr>`; }).join("")}
      ${rep.sem.notas ? `<tr><td><span class="chip warn">Sem sócio</span>${rep.sem.divisaoInvalida ? ` <span class="muted" style="font-size:12px">(${rep.sem.divisaoInvalida} com divisão que não soma 100%)</span>` : ""}</td><td class="r num">${rep.sem.notas}</td><td class="r num">${brl(rep.sem.produzido)}</td><td class="r num">${brl(rep.sem.repasse)}</td><td></td></tr>` : ""}
      <tr class="tot"><td>Total</td><td class="r num">${ap.notas}</td><td class="r num">${brl(ap.faturamento)}</td><td class="r num">${brl(ap.repasseTotal)}</td><td></td></tr>
      <tr><td>Reserva da sociedade (15%)</td><td></td><td></td><td class="r num">${brl(ap.reserva)}</td><td></td></tr>
      <tr><td>− Impostos devidos</td><td></td><td></td><td class="r num">${brl(-ap.devTotal)}</td><td></td></tr>
      <tr class="tot"><td>Sobra para despesas comuns</td><td></td><td></td><td class="r num">${ap.sobra < 0 ? `<span class="chip bad">${brl(ap.sobra)}</span>` : brl(ap.sobra)}</td><td class="r num">${pct(ap.faturamento ? ap.sobra / ap.faturamento : 0)}</td></tr>
      </tbody></table></div>
      <p class="note">Repasse = 85% do valor de cada nota (já sem desconto), dividido entre os sócios marcados. Diferenças de 1 centavo vêm do arredondamento por nota.</p>`;
  }
  function abaRelatorio(el, ap, rep) {
    el.innerHTML = `<div class="toolbar"><h2>Relatórios de ${dbr(S.de)} a ${dbr(S.ate)}</h2>
      <button class="primary" id="pdfGeral">PDF geral (apuração e repasse)</button></div>
      ${rep.sem.notas ? `<p class="note"><span class="chip warn">${rep.sem.notas} nota(s) sem sócio</span> ficam fora dos demonstrativos individuais.</p>` : ""}
      <div class="tablewrap"><table><thead><tr><th>Sócio</th><th class="r">Notas</th><th class="r">Repasse</th><th></th></tr></thead><tbody>
      ${S.socios.filter(s => rep.socios[s.id].notas).map(s => `<tr><td>${esc(s.nome)}</td><td class="r num">${rep.socios[s.id].notas}</td><td class="r num">${brl(rep.socios[s.id].repasse)}</td><td class="r"><button class="x pdfS" data-sid="${s.id}">PDF do sócio</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nenhuma nota atribuída no período.</td></tr>`}
      </tbody></table></div>`;
    $("#pdfGeral").onclick = () => PDF.geral({ de: S.de, ate: S.ate, ap, rep, socios: S.socios.filter(s => s.ativo || rep.socios[s.id].notas), fechado: periodoFechado() });
    el.querySelectorAll(".pdfS").forEach(b => b.onclick = () => { const s = S.socios.find(z => z.id === b.dataset.sid); PDF.socio({ nome: s.nome, de: S.de, ate: S.ate, itens: rep.socios[s.id].itens, fechado: periodoFechado() }); });
  }
  async function abaFechamento(el) {
    el.innerHTML = `<p class="muted">Carregando meses…</p>`;
    const { data: meses, error } = await S.sb.rpc("meses_resumo");
    if (error) { el.innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
    const nomeMes = ym => new Date(ym + "-15").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    el.innerHTML = `<p class="note">Fechar um mês trava notas e atribuições dele, e os sócios passam a ver os valores como definitivos. Para corrigir, reabra o mês.</p>
      <div class="tablewrap"><table><thead><tr><th>Mês</th><th class="r">Notas</th><th class="r">Sem sócio</th><th class="r">Alertas</th><th>Situação</th><th></th></tr></thead><tbody>
      ${(meses || []).map(m => `<tr><td>${nomeMes(m.mes)}</td><td class="r num">${m.notas}</td>
        <td class="r num">${m.sem_socio ? `<span class="chip warn">${m.sem_socio}</span>` : "0"}</td><td class="r num">${m.alertas ? `<span class="chip warn">${m.alertas}</span>` : "0"}</td>
        <td>${m.fechado ? `<span class="chip ok">Fechado</span>` : `<span class="chip warn">Aberto</span>`}</td>
        <td class="r">${m.fechado ? `<button class="x reabrir" data-m="${m.mes}">Reabrir</button>` : `<button class="primary x fechar" data-m="${m.mes}" data-pend="${Number(m.sem_socio) + Number(m.alertas)}">Fechar mês</button>`}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Nenhuma nota importada.</td></tr>`}
      </tbody></table></div><p class="err" id="fechMsg"></p>`;
    el.querySelectorAll(".fechar").forEach(b => b.onclick = async () => {
      const m = b.dataset.m;
      if (Number(b.dataset.pend) && b.dataset.confirmado !== "1") {
        $("#fechMsg").textContent = `${nomeMes(m)} ainda tem notas sem sócio ou alertas pendentes. Clique de novo em “Fechar mês” para fechar assim mesmo.`;
        b.dataset.confirmado = "1"; return;
      }
      const { error } = await S.sb.rpc("fechar_mes", { p_mes: m + "-01" });
      if (error) { $("#fechMsg").textContent = "Não fechou: " + error.message; return; }
      S.fechados.add(m); toast(`${nomeMes(m)} fechado`); renderAdmin();
    });
    el.querySelectorAll(".reabrir").forEach(b => b.onclick = async () => {
      const m = b.dataset.m;
      const { error } = await S.sb.rpc("reabrir_mes", { p_mes: m + "-01" });
      if (error) { $("#fechMsg").textContent = "Não reabriu: " + error.message; return; }
      S.fechados.delete(m); toast(`${nomeMes(m)} reaberto`); renderAdmin();
    });
  }
  function abaSocios(el) {
    const acesso = s => S.usuarios.some(u => u.socio_id === s.id) ? `<span class="chip ok">Acesso liberado</span>` : (s.email ? `<span class="chip warn">Aguardando convite/login</span>` : `<span class="chip">Sem e-mail</span>`);
    el.innerHTML = `<p class="note">Para dar acesso: cadastre o e-mail do sócio aqui. Depois, no Supabase, vá em Authentication → Users → Add user → Create new user, use o mesmo e-mail, crie uma senha provisória e marque “Auto Confirm User”. O vínculo é automático; o sócio pode trocar a senha pelo botão “Trocar senha”.</p>
      <div class="tablewrap"><table><thead><tr><th>Nome</th><th>CRM</th><th>E-mail</th><th>Ativo</th><th>Acesso</th><th></th></tr></thead><tbody>
      ${S.socios.map(s => `<tr data-id="${s.id}"><td><input type="text" id="n-${s.id}" value="${esc(s.nome)}" aria-label="Nome"></td><td><input type="text" id="c-${s.id}" value="${esc(s.crm || "")}" aria-label="CRM" style="width:110px"></td>
        <td><input type="email" id="e-${s.id}" value="${esc(s.email || "")}" aria-label="E-mail"></td><td><input type="checkbox" id="a-${s.id}" ${s.ativo ? "checked" : ""} aria-label="Ativo"></td><td>${acesso(s)}</td><td><button class="x salvarS" data-id="${s.id}">Salvar</button></td></tr>`).join("")}
      <tr><td><input type="text" id="n-novo" placeholder="Nome do sócio" aria-label="Nome do novo sócio"></td><td><input type="text" id="c-novo" placeholder="CRM-MT" style="width:110px" aria-label="CRM do novo sócio"></td><td><input type="email" id="e-novo" placeholder="email@exemplo.com" aria-label="E-mail do novo sócio"></td><td></td><td></td><td><button class="primary x" id="addS">Adicionar</button></td></tr>
      </tbody></table></div>`;
    const salvar = async (id) => {
      const k = id || "novo";
      const row = { nome: $(`#n-${k}`).value.trim(), crm: $(`#c-${k}`).value.trim() || null, email: $(`#e-${k}`).value.trim().toLowerCase() || null };
      if (!row.nome) { toast("Informe o nome"); return; }
      if (id) row.ativo = $(`#a-${k}`).checked;
      const { error } = id ? await S.sb.from("socios").update(row).eq("id", id) : await S.sb.from("socios").insert(row);
      if (error) { toast("Não salvou: " + error.message); return; }
      await S.sb.rpc("vincular_existentes");
      toast("Sócio salvo"); await carregar();
    };
    el.querySelectorAll(".salvarS").forEach(b => b.onclick = () => salvar(b.dataset.id));
    $("#addS").onclick = () => salvar(null);
  }

  boot();
})();
