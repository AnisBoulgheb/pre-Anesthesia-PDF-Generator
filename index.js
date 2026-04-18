// MUST BE AT THE VERY TOP OF index.js
const util = require("util");
if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = util.TextDecoder;
}

const OriginalTextDecoder = global.TextDecoder;
global.TextDecoder = class extends OriginalTextDecoder {
  constructor(encoding, options) {
    if (encoding === "ascii" || encoding === "windows-1252") {
      encoding = "utf-8";
    }
    super(encoding, options);
  }
};
const express = require("express");

const PDFDocument = require("pdfkit");

const path = require("path");

const app = express();

app.use(express.urlencoded({ extended: true }));

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/generate-pdf", (req, res) => {
  const d = req.body;

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });

  const nomFichier = (d.nom || "Patient").replace(/[^a-z0-9]/gi, "_");

  res.setHeader("Content-Type", "application/pdf");

  res.setHeader(
    "Content-Disposition",

    `attachment; filename="Fiche_PreAnesthesie_${nomFichier}.pdf"`,
  );

  doc.pipe(res);

  // ── UNIT: all coordinates in mm, converted to PDFKit points ──────────────

  const pt = (mm) => mm * 2.834645;

  const PAGE_W = 210; // A4 width mm

  const PAGE_H = 297; // A4 height mm

  const MG = 12; // left/right margin mm

  const CW = PAGE_W - 2 * MG; // content width = 186 mm

  let y = MG; // vertical cursor (mm), grows downward

  // ── FONTS ────────────────────────────────────────────────────────────────

  const F = (style = "normal", size = 9) => {
    doc

      .font(
        style === "bold"
          ? "Times-Bold"
          : style === "italic"
            ? "Times-Italic"
            : "Times-Roman",
      )

      .fontSize(size);
  };

  // ── PRIMITIVES ───────────────────────────────────────────────────────────

  const hline = (x1, x2, ty, color = "#c8c8c8", lw = 0.2) => {
    doc

      .strokeColor(color)

      .lineWidth(lw)

      .moveTo(pt(x1), pt(ty))

      .lineTo(pt(x2), pt(ty))

      .stroke();
  };

  const vline = (x, ty1, ty2, color = "#000000ff", lw = 0.4) => {
    doc

      .strokeColor(color)

      .lineWidth(lw)

      .moveTo(pt(x), pt(ty1))

      .lineTo(pt(x), pt(ty2))

      .stroke();
  };

  const drawRect = (x, w, ty, h, fill = null, stroke = "#000000", lw = 0.4) => {
    doc.lineWidth(lw);

    if (fill) {
      doc

        .fillColor(fill)

        .rect(pt(x), pt(ty), pt(w), pt(h))

        .fillAndStroke(fill, stroke);
    } else {
      doc.strokeColor(stroke).rect(pt(x), pt(ty), pt(w), pt(h)).stroke();
    }
  };

  // Draw text clipped strictly inside a cell — prevents bleed into neighbours

  const cell = (x, w, ty, h, text, align = "L", bold = false, size = 8) => {
    F(bold ? "bold" : "normal", size);

    doc.fillColor("black");

    const PAD = 1.2;

    const iX = x + PAD;

    const iW = w - 2 * PAD;

    if (iW <= 0) return;

    const th = doc.heightOfString("X");

    const vtop = pt(ty) + (pt(h) - th) / 2;

    doc.save();

    doc.rect(pt(x), pt(ty), pt(w), pt(h)).clip();

    doc.text(String(text || ""), pt(iX), vtop, {
      width: pt(iW),

      align: align === "C" ? "center" : align === "R" ? "right" : "left",

      lineBreak: false,
    });

    doc.restore();
  };

  // Absolute text placement

  const put = (text, x, ty, opts = {}) => {
    doc.text(String(text || ""), pt(x), pt(ty), { lineBreak: false, ...opts });
  };

  // Centered text across full content width

  const center = (text, style, size, ty) => {
    F(style, size);

    doc.text(text, pt(MG), pt(ty), {
      align: "center",

      width: pt(CW),

      lineBreak: false,
    });
  };

  // Bold label + normal value, with optional underline

  const lv = (lbl, val, xL, ty, xV, xEnd = null) => {
    F("bold", 9);

    doc.fillColor("black");

    put(lbl, xL, ty);

    F("normal", 9);

    put(val || "", xV, ty);

    if (xEnd !== null) hline(xV, xEnd, ty + 3.2, "#b4b4b4", 0.2);
  };

  // ── TABLE ROW ────────────────────────────────────────────────────────────

  // items: [{ label, val, lw, vw }, ...]

  // Sum of all (lw + vw) MUST equal CW = 186 mm exactly.

  // Draw order: label fills → value fills → text → dividers → outer border.

  // This ensures the outer border is never painted over by a fill.

  const tableRow = (items, ty, rh) => {
    let cx = MG;

    // Draw cell borders
    items.forEach(({ lw, vw }) => {
      if (lw > 0) {
        doc
          .lineWidth(0.2)
          .strokeColor("black")
          .rect(pt(cx), pt(ty), pt(lw), pt(rh))
          .stroke();
      }
      if (vw > 0) {
        doc
          .lineWidth(0.2)
          .strokeColor("black")
          .rect(pt(cx + lw), pt(ty), pt(vw), pt(rh))
          .stroke();
      }
      cx += lw + vw;
    });

    // Draw text
    cx = MG;
    items.forEach(({ label, val, lw, vw, unit }) => {
      doc.fillColor("black");

      let alignLbl = "C";
      if (
        [
          "Poids:",
          "Taille:",
          "Conjonctives:",
          "Etat Général:",
          "TABAC:",
          "NYHA:",
          "AUTRE",
        ].includes(label)
      ) {
        alignLbl = "L";
      }

      if (lw > 0) cell(cx, lw, ty, rh, label, alignLbl, true, 8);

      if (vw > 0) {
        if (
          label === "Plaquettes:" &&
          val &&
          !String(val).includes("000/mm3")
        ) {
          val = String(val) + " 000/mm3";
        }
        let alignV = "C";
        if (label === "AUTRE") alignV = "L";
        cell(cx + lw, vw, ty, rh, val, alignV, false, 8);

        if (unit) {
          F("normal", 5.5);
          doc.fillColor("black").text(unit, pt(cx + lw), pt(ty + rh - 2.5), {
            width: pt(vw - 1),
            align: "right",
          });
        }
      }
      cx += lw + vw;
    });

    // Outer border
    doc
      .lineWidth(0.4)
      .strokeColor("#000000")
      .rect(pt(MG), pt(ty), pt(CW), pt(rh))
      .stroke();
  };

  // ── DATE ─────────────────────────────────────────────────────────────────

  let dateVal;

  if (d.date_consult) {
    const p = d.date_consult.split("-");

    dateVal = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d.date_consult;
  } else {
    const t = new Date();

    dateVal = `${String(t.getDate()).padStart(2, "0")}/${String(t.getMonth() + 1).padStart(2, "0")}/${t.getFullYear()}`;
  }

  // ════════════════════════════════════════════════════════════════════════

  //  LAYOUT  (everything fits on one A4 page = 297 mm total, margin 12 top+bot)

  // ════════════════════════════════════════════════════════════════════════

  // ── INSTITUTIONAL HEADER (16 mm) ─────────────────────────────────────────

  F("normal", 7);

  doc.fillColor("black");

  const hdrLines = [
    "REPUBLIQUE ALGERIENNE DEMOCRATIQUE ET POPULAIRE",

    "MINISTERE DE LA SANTE",

    "DIRECTION DE LA SANTE ET LA POPULATION DE LA WILAYA DE TLEMCEN",

    "ETABLISSEMENT PUBLIC DE SANTE DE PROXIMITE DE SEBDOU",

    "POLYCLINIQUE DE SEBDOU",
  ];

  const hdrStep = [3.2, 3.2, 3.2, 3.2, 3.2];

  hdrLines.forEach((hl, i) => {
    if (i < 2) {
      doc.text(hl, pt(MG), pt(y + 2), { align: "center", width: pt(CW) });
    } else {
      doc.text(hl, pt(MG), pt(y + 2), { align: "left", width: pt(CW) });
    }
    y += hdrStep[i];
  });

  // date top-right

  F("bold", 10);

  doc.fillColor("black");

  doc.text("Date: " + dateVal, pt(PAGE_W - MG - 44), pt(y - 3), {
    align: "right",

    width: pt(44),
  });

  // ── MAIN TITLE (12 mm) ───────────────────────────────────────────────────

  F("bold", 18);

  doc.fillColor("black");

  doc.text("CONSULTATION PRE-ANESTHESIQUE", pt(MG), pt(y + 2), {
    align: "center",

    width: pt(CW),
  });

  y += 10;

  hline(MG, PAGE_W - MG, y, "#000000", 0.5);

  y += 4;

  // ── PATIENT INFO + GROUPAGE BOX (30 mm) ──────────────────────────────────

  const leftW = 118;

  const rightX = MG + leftW + 3;

  const rightW = CW - leftW - 3;

  const infoY = y;

  lv("Nom:", d.nom || "", MG, y, MG + 13, MG + 98);

  y += 5;

  lv("Prénom:", d.prenom || "", MG, y, MG + 19, MG + 98);

  y += 5;

  lv("Adresse:", d.adresse || "", MG, y, MG + 21, MG + 98);

  y += 5;

  F("bold", 9);

  doc.fillColor("black");

  put("Age:", MG, y);

  F("normal", 9);

  put(d.age ? d.age + " ans" : "", MG + 11, y);

  F("bold", 9);

  put("Tél:", MG + 44, y);

  F("normal", 9);

  put(d.tel || "", MG + 54, y);

  hline(MG + 54, MG + 98, y + 3.2, "#b4b4b4", 0.2);

  y += 5;

  lv("Diagnostique Chirurgical:", d.diagnostic || "", MG, y, MG + 53, MG + 98);

  y += 5;

  const medOp =
    d.medecin_operateur === "AUTRE"
      ? d.autre_operateur || ""
      : d.medecin_operateur || "";

  lv("Médecin Opérateur:", medOp, MG, y, MG + 44, MG + 98);

  y += 3;

  // Groupage double-border box

  const grpH = y - infoY;

  drawRect(rightX, rightW, infoY, grpH, null, "#000000", 0.5);

  drawRect(
    rightX + 1.5,

    rightW - 3,

    infoY + 1.5,

    grpH - 3,

    null,

    "#000000",

    0.3,
  );

  F("bold", 10);

  doc.fillColor("black");

  doc.text("GROUPAGE-", pt(rightX), pt(infoY + grpH / 2 - 8), {
    align: "center",

    width: pt(rightW),
  });

  doc.text("RHESUS", pt(rightX), pt(infoY + grpH / 2 - 1.5), {
    align: "center",

    width: pt(rightW),
  });

  const grpTxt = (d.groupage || "?") + (d.rhesus || "");

  F("bold", 20);

  doc.fillColor("black");

  doc.text(grpTxt, pt(rightX), pt(infoY + grpH / 2 + 5), {
    align: "center",

    width: pt(rightW),
  });

  y += 3;

  // ── A.T.C.D. (28 mm) ────────────────────────────────────────────────────

  center("A.T.C.D.", "bold", 9, y + 2);

  y += 5;

  const aH = 5; // row height

  const aLW = 30; // label width

  const aVW = CW - aLW; // 156 mm

  const atcdLabels = [
    "Médicaux:",

    "Chirurgicaux:",

    "Anesthésiques:",

    "Allergiques:",

    "Autres",
  ];

  const atcdVals = [
    d.atcd_medicaux,

    d.atcd_chirurgicaux,

    d.atcd_anesthesiques,

    d.atcd_allergiques,

    d.atcd_autres,
  ];

  atcdLabels.forEach((lbl, i) => {
    // Cell borders
    doc
      .lineWidth(0.2)
      .strokeColor("black")
      .rect(pt(MG), pt(y), pt(aLW), pt(aH))
      .stroke();
    doc
      .lineWidth(0.2)
      .strokeColor("black")
      .rect(pt(MG + aLW), pt(y), pt(aVW), pt(aH))
      .stroke();

    doc.fillColor("black");
    cell(MG, aLW, y, aH, lbl, "L", true, 8);
    cell(MG + aLW, aVW, y, aH, atcdVals[i] || "", "L", false, 8);

    // Outer border
    doc
      .lineWidth(0.4)
      .strokeColor("#000000")
      .rect(pt(MG), pt(y), pt(CW), pt(aH))
      .stroke();

    y += aH;
  });

  y += 2;

  // ── ÉVALUATION CLINIQUE (14 mm) ─────────────────────────────────────────

  // FIX: all widths verified to sum exactly to CW = 186 mm

  center("ÉVALUATION CLINIQUE:", "bold", 9, y + 2);

  y += 5;

  const eH = 5; // eval row height

  // Row 1: 18+44 + 16+42 + 30+36 = 62+58+66 = 186 ✓

  tableRow(
    [
      { label: "Poids:", val: d.poids ? d.poids + " Kg" : "", lw: 18, vw: 44 },

      {
        label: "Taille:",

        val: d.taille ? d.taille + " Cm" : "",

        lw: 16,

        vw: 42,
      },

      { label: "Conjonctives:", val: d.conjonctives || "", lw: 30, vw: 36 },
    ],

    y,

    eH,
  );

  y += eH;

  // Row 2: 26+36 + 16+46 + 14+48 = 62+62+62 = 186 ✓

  tableRow(
    [
      { label: "Etat Général:", val: d.etat_general || "", lw: 26, vw: 36 },

      { label: "TABAC:", val: d.tabac || "", lw: 16, vw: 46 },

      { label: "NYHA:", val: d.nyha || "", lw: 14, vw: 48 },
    ],

    y,

    eH,
  );

  y += eH + 2;

  // ── L'EXAMEN CARDIOVASCULAIRE (24 mm) ────────────────────────────────────

  center("L'EXAMEN CARDIOVASCULAIRE", "bold", 9, y + 2);

  y += 5;

  [
    ["TA:", d.ta || ""],

    ["FC:", d.fc ? d.fc + " bpm" : ""],

    ["SF:", d.sf || ""],

    ["ECG:", d.ecg || ""],
  ].forEach(([lbl, vl]) => {
    F("bold", 8);

    doc.fillColor("black");

    put(lbl, MG, y);

    F("normal", 8);

    put(vl, MG + 10, y);

    hline(MG + 10, MG + 80, y + 3.2);

    y += 4;
  });

  // FIX: Echocoeur on its OWN line

  F("bold", 8);

  doc.fillColor("black");

  put("Echocoeur:", MG, y);

  F("normal", 8);

  put(d.echocoeur || "", MG + 23, y);

  hline(MG + 23, PAGE_W - MG, y + 3.2);

  y += 4;

  // FIX: FEVG on the NEXT separate line

  F("bold", 8);

  doc.fillColor("black");

  put("FEVG:", MG, y);

  F("normal", 8);

  put(d.fevg ? d.fevg + " %" : "", MG + 13, y);

  hline(MG + 13, PAGE_W - MG, y + 3.2);

  y += 3;

  // ── L'EXAMEN PULMONAIRE (15 mm) ──────────────────────────────────────────

  center("L'EXAMEN PULMONAIRE:", "bold", 9, y + 2);

  y += 5;

  F("bold", 8);

  doc.fillColor("black");

  put("RX:", MG, y);

  F("normal", 8);

  put(d.rx || "", MG + 9, y);

  hline(MG + 9, PAGE_W - MG, y + 3.2);

  y += 4;

  F("bold", 8);

  doc.fillColor("black");

  put("EFR:", MG, y);

  F("normal", 8);

  put(d.efr || "", MG + 10, y);

  hline(MG + 10, PAGE_W - MG, y + 3.2);

  y += 3;

  // ── L'EXAMEN NEUROLOGIQUE (14 mm) ────────────────────────────────────────

  center("L'EXAMEN NEUROLOGIQUE:", "bold", 9, y + 2);

  y += 5;

  F("normal", 8);

  doc.fillColor("black");

  put(d.neurologique || "", MG, y);

  hline(MG, PAGE_W - MG, y + 3.2);
  y += 2;

  hline(MG, PAGE_W - MG, y + 3.2);

  y += 6;

  // ── BILAN SANGUIN (30 mm) ────────────────────────────────────────────────

  center("BILAN SANGUIN:", "bold", 9, y + 2);

  // Underline the title

  hline(PAGE_W / 2 - 24, PAGE_W / 2 + 24, y + 5, "#000000", 0.35);

  y += 7;

  const bH = 5; // bilan row height

  tableRow(
    [
      { label: "Hb", val: d.hb || "", lw: 25, vw: 25 },
      { label: "Hte", val: d.hte || "", lw: 15, vw: 25 },
      {
        label: "Plaquettes:",
        val: d.plaquettes || "",
        lw: 22,
        vw: 28,
        unit: "000/mm3",
      },
      { label: "TP:", val: d.tp || "", lw: 16, vw: 30, unit: "%" },
    ],
    y,
    bH,
  );
  y += bH;

  tableRow(
    [
      { label: "Glycémie", val: d.glycemie || "", lw: 25, vw: 25 },
      { label: "Urée", val: d.uree || "", lw: 15, vw: 25 },
      { label: "Créat:", val: d.creat || "", lw: 22, vw: 74 },
    ],
    y,
    bH,
  );
  y += bH;

  tableRow(
    [
      { label: "Sérologie", val: "", lw: 50, vw: 0 },
      { label: "HIV:", val: d.hiv || "", lw: 15, vw: 25 },
      { label: "HCV:", val: d.hcv || "", lw: 22, vw: 28 },
      { label: "HBS:", val: d.hbs || "", lw: 16, vw: 30 },
    ],
    y,
    bH,
  );

  y += bH;

  // AUTRE row: 18+0 + 0+168 = 186 ✓

  tableRow(
    [{ label: "AUTRE", val: d.autre_bilan || "", lw: 18, vw: 168 }],
    y,
    bH,
  );
  y += bH + 4;

  // ── INTUBATION / DMT / TECHNIQUE (20 mm) ─────────────────────────────────

  F("bold", 8);

  doc.fillColor("black");

  put("INTUBATION : MALLAMPATI:", MG, y);

  F("normal", 8);

  put(d.mallampati || "", MG + 51, y);

  hline(MG + 51, PAGE_W / 2 - 2, y + 3.2);

  F("bold", 8);

  doc.fillColor("black");

  put("L'état bucco-dentaire:", PAGE_W / 2 + 3, y);

  F("normal", 8);

  put(d.bucco || "", PAGE_W / 2 + 42, y);

  hline(PAGE_W / 2 + 42, PAGE_W - MG, y + 3.2);

  y += 4;

  F("bold", 8);

  doc.fillColor("black");

  put("DMT:", MG, y);

  F("normal", 8);

  put(d.dmt || "", MG + 11, y);

  hline(MG + 11, PAGE_W / 2 - 5, y + 3.2);

  y += 4;

  F("bold", 8);

  doc.fillColor("black");

  put("TECHNIQUE ANESTHESIQUE:", MG, y);

  F("normal", 8);

  put(d.technique || "", MG + 51, y);

  hline(MG + 51, PAGE_W - MG, y + 3.2);

  y += 4;

  // ── DEMANDE PSL (5 mm) ───────────────────────────────────────────────────

  F("bold", 8);

  doc.fillColor("black");

  put("DEMANDE PSL:", MG, y);

  let pslX = MG + 34;

  const chk = (key) => d[key] === "on" || d[key] === true || d[key] === "true";

  ["cgr", "pfc", "cps"].forEach((id) => {
    const isOn = chk(id);

    drawRect(
      pslX,

      3.8,

      y - 1,

      3.8,

      isOn ? "#000000" : "#ffffff",

      "#000000",

      0.4,
    );

    doc.fillColor("black");

    F(isOn ? "bold" : "normal", 8);

    put(id.toUpperCase(), pslX + 5.5, y);

    pslX += 22;
  });

  y += 4;

  // ── PRÉMÉDICATION (5 mm) ─────────────────────────────────────────────────

  F("bold", 8);

  doc.fillColor("black");

  put("Prémédication:", MG, y);

  F("normal", 8);

  put(d.premedication || "", MG + 31, y);

  hline(MG + 31, PAGE_W - MG, y + 3.2);

  y += 4;

  // ── CLASSIFICATION ASA (6 mm) ────────────────────────────────────────────

  F("bold", 8);

  doc.fillColor("black");

  put("Classification ASA:", MG, y);

  F("normal", 8);

  put(d.asa || "", MG + 39, y);
  y += 4;

  // ── CONCLUSION (12 mm) ───────────────────────────────────────────────────

  // Draw label and value on the SAME line by using a fresh page position
  const conclusionY = y;
  F("bold", 8);
  doc.fillColor("black");
  doc.text("Conclusion & consignes:", pt(MG), pt(conclusionY), {
    lineBreak: false,
  });
  // Place value right after label — measure label width dynamically
  const lblWidth = doc.widthOfString("Conclusion & consignes:") / 2.834645;

  if (d.conclusion && d.conclusion.trim()) {
    const conclusionX = MG + lblWidth + 2;
    const conclusionW = CW - lblWidth - 2;
    const conclusionText = d.conclusion.trim();
    F("normal", 8);
    doc.fillColor("black");
    const opts = { width: pt(conclusionW), align: "left", lineBreak: true };
    doc.text(conclusionText, pt(conclusionX), pt(conclusionY), opts);
    y += doc.heightOfString(conclusionText, opts) / 2.834645 + 4;
  } else {
    const lblEndX = MG + lblWidth + 2;
    hline(lblEndX, PAGE_W - MG, y + 3.2);
    y += 5;
    hline(MG, PAGE_W - MG, y + 3.2);
    y += 5;
  }
  // Clamp y so signature never falls off the page.
  // A4 = 297mm; we keep the signature block (~14mm tall) above 283mm,
  // and at minimum 4mm below the last content line.
  const SIG_MAX_Y = 275; // mm from top — signature title starts here at most
  y = Math.min(y + 2, SIG_MAX_Y);

  // ── SIGNATURE (10 mm) ────────────────────────────────────────────────────

  const medAnest =
    d.medecin_anesthesiste === "AUTRE"
      ? d.autre_anesthesiste || ""
      : d.medecin_anesthesiste || "";

  F("bold", 9);
  doc.fillColor("black");
  put("LE MEDECIN ANESTHESISTE REANIMATEUR:", MG, y + 2);

  F("normal", 9);
  doc.fillColor("black");
  put(medAnest, MG + 60, y + 2);

  // ── DONE ─────────────────────────────────────────────────────────────────

  doc.end();
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>
  console.log(`Serveur prêt sur http://localhost:${PORT}`),
);
