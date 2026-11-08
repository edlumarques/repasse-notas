// Relatórios em PDF (jsPDF + autotable).
(function (root) {
  const fmt = c => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dbr = s => s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "";
  const ACC = [31, 106, 133];

  function base(titulo, sub) {
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const E = root.APP_CONFIG.EMPRESA;
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(titulo, 40, 50);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(`${E.razao} · CNPJ ${E.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")} · ${E.cidade}`, 40, 66);
    doc.text(sub, 40, 80);
    doc.setTextColor(0);
    return doc;
  }
  function rodape(doc) {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")} · página ${i} de ${n}`, 40, doc.internal.pageSize.getHeight() - 24);
    }
  }
  const tbl = (doc, y, head, body, opts = {}) => {
    doc.autoTable({ startY: y, head: [head], body, theme: "grid", styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: ACC, textColor: 255 }, margin: { left: 40, right: 40 }, ...opts });
    return doc.lastAutoTable.finalY;
  };

  // Relatório de um sócio: itens = [{nota, percentual, produzido, repasse}]
  function socio({ nome, de, ate, itens, fechado }) {
    const doc = base(`Demonstrativo de repasse – ${nome}`, `Período: ${dbr(de)} a ${dbr(ate)} · ${fechado ? "período fechado (valores definitivos)" : "período aberto (valores parciais)"}`);
    const tp = itens.reduce((s, i) => s + i.produzido, 0), tr = itens.reduce((s, i) => s + i.repasse, 0);
    let y = tbl(doc, 96, ["Notas", "Produzido (R$)", "Repasse 85% (R$)"], [[String(itens.length), fmt(tp), fmt(tr)]],
      { columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } } });
    tbl(doc, y + 16, ["Nº", "Emissão", "Serviço", "Tomador", "Parte", "Produzido", "Repasse"],
      itens.map(i => [i.nota.n, dbr(i.nota.e), i.nota.s, i.nota.t || "", i.percentual.toLocaleString("pt-BR") + "%", fmt(i.produzido), fmt(i.repasse)]),
      { columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
        foot: [["", "", "", "Total", "", fmt(tp), fmt(tr)]], footStyles: { fillColor: [235, 240, 244], textColor: 20, halign: "right" } });
    rodape(doc);
    doc.save(`repasse_${nome.replace(/\W+/g, "_")}_${de}_${ate}.pdf`);
  }

  // Relatório geral: apuração + repasse por sócio
  function geral({ de, ate, ap, rep, socios, fechado }) {
    const doc = base("Relatório do período – apuração e repasse", `Período: ${dbr(de)} a ${dbr(ate)} · ${ap.notas} notas válidas · ${fechado ? "período fechado" : "período aberto (parcial)"}`);
    const linhasRep = socios.map(s => { const r = rep.socios[s.id]; return [s.nome, r.notas, fmt(r.produzido), fmt(r.repasse)]; });
    if (rep.sem.notas) linhasRep.push(["Sem sócio", rep.sem.notas, fmt(rep.sem.produzido), fmt(rep.sem.repasse)]);
    let y = tbl(doc, 96, ["Sócio", "Notas", "Produzido (R$)", "Repasse 85% (R$)"], linhasRep,
      { columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        foot: [["Total", ap.notas, fmt(ap.faturamento), fmt(ap.repasseTotal)]], footStyles: { fillColor: [235, 240, 244], textColor: 20, halign: "right" } });
    let tD = 0, tR = 0;
    const linhas = ap.linhas.map(([t, d, r, p]) => { tD += d; tR += r; return [t, fmt(d), fmt(r), fmt(d - r), p]; });
    y = tbl(doc, y + 16, ["Tributo", "Devido (R$)", "Retido (R$)", "A recolher (R$)", "Período"], linhas,
      { columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        foot: [["Total", fmt(tD), fmt(tR), fmt(tD - tR), ""]], footStyles: { fillColor: [235, 240, 244], textColor: 20, halign: "right" } });
    y = tbl(doc, y + 16, ["Reserva da sociedade", "R$"], [
      ["Reserva 15%", fmt(ap.reserva)], ["Impostos devidos", fmt(-ap.devTotal)], ["Sobra para despesas comuns", fmt(ap.sobra)],
      ["IBS / CBS destacados (teste 2026, informativo)", `${fmt(ap.ibs)} / ${fmt(ap.cbs)}`]],
      { columnStyles: { 1: { halign: "right" } } });
    doc.setFontSize(8); doc.setTextColor(100);
    doc.text("IRPJ e CSLL são trimestrais; no período escolhido aparecem como estimativa. Valores para conferência; a apuração oficial é do contador.", 40, y + 18, { maxWidth: 515 });
    rodape(doc);
    doc.save(`relatorio_${de}_${ate}.pdf`);
  }

  root.PDF = { socio, geral };
})(window);
