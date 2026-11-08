// Leitura de NFS-e (XML ABRASF 2.03) e de arquivos .zip, direto no navegador.
(function (root) {
  function cents(s) {
    if (!s) return 0;
    const [i, f = ""] = String(s).trim().split(".");
    const neg = i.startsWith("-");
    const v = Math.abs(parseInt(i, 10)) * 100 + parseInt((f + "00").slice(0, 2), 10);
    return neg ? -v : v;
  }
  function kid(el, name) { if (!el) return null; for (const c of el.children) if (c.localName === name) return c; return null; }
  function path(el, p) { return p.split("/").reduce((e, n) => kid(e, n), el); }
  function txt(el, p) { const e = path(el, p); return e ? e.textContent.trim() : ""; }
  function deep(el, name) { return el ? el.getElementsByTagNameNS("*", name)[0] || null : null; }

  // Devolve notas no formato do motor de cálculo (centavos) + campos de cadastro.
  function parseXml(text, fname) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error(fname + ": XML inválido");
    const notas = [];
    for (const comp of doc.getElementsByTagNameNS("*", "CompNfse")) {
      const inf = deep(comp, "InfNfse"); if (!inf) continue;
      const dps = deep(inf, "InfDeclaracaoPrestacaoServico");
      const serv = kid(dps, "Servico"), val = kid(serv, "Valores"), vn = kid(inf, "ValoresNfse"), tom = kid(dps, "Tomador");
      const prest = kid(dps, "Prestador");
      const cnpj = deep(tom, "Cnpj"), cpf = deep(tom, "Cpf");
      const disc = txt(serv, "Discriminacao").replace(/\s+/g, " ");
      notas.push({
        cnpj_prestador: (deep(prest, "Cnpj") || {}).textContent?.trim() || "",
        n: parseInt(txt(inf, "Numero"), 10),
        e: txt(inf, "DataEmissao").slice(0, 10),
        comp: (txt(dps, "Competencia") || txt(inf, "DataEmissao")).slice(0, 10),
        tp: cnpj ? "PJ" : "PF", t: txt(tom, "RazaoSocial"), doc: (cnpj || cpf)?.textContent.trim() || "",
        s: root.Calc.categoria(disc), disc,
        v: cents(txt(val, "ValorServicos")), dc: cents(txt(val, "DescontoIncondicionado")),
        b: cents(txt(vn, "BaseCalculo")), al: parseFloat(txt(vn, "Aliquota") || "0"), iss: cents(txt(vn, "ValorIss")),
        ir: txt(serv, "IssRetido") === "1",
        pis: cents(txt(val, "ValorPis")), cof: cents(txt(val, "ValorCofins")), irr: cents(txt(val, "ValorIr")), csl: cents(txt(val, "ValorCsll")),
        liq: cents(txt(vn, "ValorLiquidoNfse")), ibs: cents(txt(vn, "ValorIBS")), cbs: cents(txt(vn, "ValorCBS")),
        x: !!(deep(comp, "Cancelamento") || deep(comp, "NfseCancelamento") || deep(comp, "CodigoCancelamento")),
        xml: new XMLSerializer().serializeToString(comp)
      });
    }
    return notas;
  }

  async function readZip(buf) {
    const dv = new DataView(buf), out = [];
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error("Arquivo .zip não reconhecido");
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder("utf-8");
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
        elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nlen)); p += 46 + nlen + elen + clen;
      if (!/\.xml$/i.test(name)) continue;
      const ds = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
      const raw = new Uint8Array(buf, ds, csize);
      let bytes;
      if (method === 0) bytes = raw;
      else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      else continue;
      out.push({ name, text: dec.decode(bytes) });
    }
    return out;
  }

  // Lê uma lista de File (zip ou xml) e devolve {notas, erros}
  async function lerArquivos(files) {
    let docs = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) docs = docs.concat(await readZip(await f.arrayBuffer()));
      else docs.push({ name: f.name, text: await f.text() });
    }
    const map = new Map(); const erros = [];
    for (const d of docs) {
      try { for (const n of parseXml(d.text, d.name)) map.set(n.cnpj_prestador + ":" + n.n, n); }
      catch (e) { erros.push(d.name); }
    }
    return { notas: [...map.values()], erros };
  }

  root.NFXml = { parseXml, readZip, lerArquivos, cents };
})(window);
