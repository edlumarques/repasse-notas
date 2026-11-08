// Motor de cálculo: valores sempre em centavos (inteiros).
(function (root) {
  const rnd = Math.round;

  const PADRAO = {
    pis: 0.0065, cofins: 0.03, presuncao_ir: 0.08, aliquota_ir: 0.15, adicional_ir: 0.10,
    limite_adicional_mes: 20000, presuncao_cs: 0.12, aliquota_cs: 0.09, aliquota_iss: 0.05, repasse: 0.85
  };

  function categoria(s) {
    s = (s || "").toLowerCase();
    if (/eletroenc|mapeamento/.test(s)) return "EEG com mapeamento cerebral";
    if (/intracran|intracrian|brain4|brina4/.test(s)) return "Monitorização da PIC (Brain4care)";
    if (s.includes("polissono")) return "Polissonografia";
    if (s.includes("spine")) return "Spine Med (sessões)";
    if (s.includes("neurocir")) return "Neurocirurgia";
    if (s.includes("terapia in")) return "Plantão em terapia intensiva";
    if (/\bupa\b/.test(s)) return "Serviços médicos (UPA)";
    if (s.includes("home care") || s.includes("domicil")) return "Honorários – home care/hospital";
    if (s.includes("honor")) return "Honorários médicos";
    return "Outros serviços médicos";
  }

  // Confere uma nota (campos em centavos) e devolve {ret, alertas}.
  // n: {v, dc, b, al, iss, ir, pis, cof, irr, csl, liq, ibs, cbs, tp, x}
  function conferir(n, p = PADRAO) {
    const alertas = [];
    if (n.x) return { ret: { pis: 0, cof: 0, csl: 0, irr: 0, iss: 0, total: 0 }, alertas: [["info", "Nota cancelada: fora da apuração e do repasse"]] };
    const issEsp = rnd(n.b * n.al / 100);
    if (Math.abs(n.al - p.aliquota_iss * 100) > 0.001) alertas.push(["warn", `ISS com alíquota de ${n.al}% (regra: ${p.aliquota_iss * 100}%)`]);
    if (Math.abs(issEsp - n.iss) > 1) alertas.push(["bad", `ISS na nota ${brl(n.iss)}; esperado ${brl(issEsp)}`]);
    const issRet = n.ir ? n.iss : 0;
    const totalRet = n.v - n.dc - n.liq;
    const infoRet = n.pis + n.cof + n.csl + n.irr + issRet;
    let ret = { pis: n.pis, cof: n.cof, csl: n.csl, irr: n.irr, iss: issRet };
    if (totalRet !== infoRet) {
      const csrf = Math.max(0, totalRet - n.irr - issRet);
      ret = { irr: n.irr, iss: issRet, pis: rnd(csrf * 0.65 / 4.65), cof: rnd(csrf * 3 / 4.65) };
      ret.csl = csrf - ret.pis - ret.cof;
      const csEsp = rnd(n.b * 0.01);
      if (n.csl && Math.abs(n.csl - (n.pis + n.cof + csEsp)) <= 2)
        alertas.push(["info", `Regra aplicada: CSLL retida veio como ${brl(n.csl)} (4,65%, soma de PIS+COFINS+CSLL); considerada 1% = ${brl(ret.csl)}`]);
      else
        alertas.push(["bad", `Retenções informadas somam ${brl(infoRet)}, mas o líquido desconta ${brl(totalRet)}`]);
    }
    ret.total = ret.pis + ret.cof + ret.csl + ret.irr + ret.iss;
    if (n.tp === "PJ") {
      if (ret.total === 0) alertas.push(["warn", "Tomador PJ sem retenção na nota: conferir se reteve IRRF 1,5% e CSRF 4,65% no pagamento"]);
      else if (n.irr && Math.abs(n.irr - rnd(n.b * 0.015)) > 1) alertas.push(["warn", `IRRF retido ${brl(n.irr)}; 1,5% seria ${brl(rnd(n.b * 0.015))}`]);
    }
    if (!n.ibs && !n.cbs) alertas.push(["warn", "Sem IBS/CBS destacados"]);
    else {
      const base = n.b - n.iss - n.pis - n.cof;
      if (Math.abs(rnd(base * 0.001) - n.ibs) > 1 || Math.abs(rnd(base * 0.009) - n.cbs) > 1) alertas.push(["warn", `IBS/CBS fora do esperado (base ${brl(base)})`]);
    }
    return { ret, alertas };
  }

  function meses(de, ate) {
    if (!de || !ate) return 1;
    const [y1, m1] = de.split("-").map(Number), [y2, m2] = ate.split("-").map(Number);
    return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1);
  }

  // notas: [{b, iss, ibs, cbs, x, ret:{pis,cof,csl,irr,iss}}]
  function apurar(notas, de, ate, p = PADRAO) {
    const v = notas.filter(n => !n.x);
    const R = v.reduce((s, n) => s + n.b, 0);
    const m = meses(de, ate);
    const baseIR = R * p.presuncao_ir;
    const dev = {
      pis: rnd(R * p.pis), cof: rnd(R * p.cofins), irpj: rnd(baseIR * p.aliquota_ir),
      adic: rnd(Math.max(0, baseIR - p.limite_adicional_mes * 100 * m) * p.adicional_ir),
      csll: rnd(R * p.presuncao_cs * p.aliquota_cs), iss: v.reduce((s, n) => s + n.iss, 0)
    };
    const ret = { pis: 0, cof: 0, csl: 0, irr: 0, iss: 0 };
    v.forEach(n => { for (const k in ret) ret[k] += n.ret[k]; });
    const devTotal = dev.pis + dev.cof + dev.irpj + dev.adic + dev.csll + dev.iss;
    const retTotal = ret.pis + ret.cof + ret.csl + ret.irr + ret.iss;
    const repasseTotal = rnd(R * p.repasse);
    const reserva = R - repasseTotal;
    return {
      notas: v.length, faturamento: R, meses: m, dev, ret, devTotal, retTotal,
      linhas: [
        ["PIS", dev.pis, ret.pis, "Mensal"], ["COFINS", dev.cof, ret.cof, "Mensal"],
        ["IRPJ", dev.irpj, ret.irr, "Trimestral"], ["Adicional IRPJ", dev.adic, 0, "Trimestral"],
        ["CSLL", dev.csll, ret.csl, "Trimestral"], ["ISS", dev.iss, ret.iss, "Mensal"]
      ],
      ibs: v.reduce((s, n) => s + n.ibs, 0), cbs: v.reduce((s, n) => s + n.cbs, 0),
      repasseTotal, reserva, sobra: reserva - devTotal
    };
  }

  // Parte de um sócio numa nota.
  function parte(b, percentual, p = PADRAO) {
    return { produzido: rnd(b * percentual / 100), repasse: rnd(b * p.repasse * percentual / 100) };
  }

  // atrib: {notaId: {socioId: pct}}  → {socioId: {notas, produzido, repasse, itens}} + sem
  function repasse(notas, atrib, socios, p = PADRAO) {
    const out = {}; socios.forEach(s => out[s.id] = { notas: 0, produzido: 0, repasse: 0, itens: [] });
    const sem = { notas: 0, produzido: 0, repasse: 0, itens: [], divisaoInvalida: 0 };
    notas.filter(n => !n.x).forEach(n => {
      const a = atrib[n.id];
      const soma = a ? Object.values(a).reduce((x, y) => x + Number(y), 0) : 0;
      if (!a || Math.abs(soma - 100) > 0.001) {
        sem.notas++; sem.produzido += n.b; sem.repasse += rnd(n.b * p.repasse); sem.itens.push(n);
        if (a) sem.divisaoInvalida++;
        return;
      }
      for (const sid in a) {
        if (!out[sid]) continue;
        const pt = parte(n.b, a[sid], p);
        out[sid].notas++; out[sid].produzido += pt.produzido; out[sid].repasse += pt.repasse;
        out[sid].itens.push({ nota: n, percentual: Number(a[sid]), ...pt });
      }
    });
    return { socios: out, sem };
  }

  function brl(c) {
    return (c < 0 ? "−" : "") + "R$ " + (Math.abs(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const api = { PADRAO, categoria, conferir, apurar, repasse, parte, meses, brl };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
