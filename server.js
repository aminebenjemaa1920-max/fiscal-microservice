// ============================================================
//  Micro-service FISCAL — 2 endpoints pour le workflow n8n
//  1) POST /pdf-to-images : PDF scanné  -> images base64 (par page)
//  2) POST /build-pdf     : JSON synthèse -> PDF français mis en forme
// ============================================================

const express = require("express");
const multer = require("multer");
const { fromBuffer } = require("pdf2pic");
const PDFDocument = require("pdfkit");

const app = express();
app.use(express.json({ limit: "25mb" }));

// upload en mémoire (pas d'écriture disque)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// petite clé d'API optionnelle (recommandé) : définie via variable d'env API_KEY
function checkAuth(req, res, next) {
  const expected = process.env.API_KEY;
  if (!expected) return next(); // pas de clé configurée -> ouvert
  const got = req.header("x-api-key");
  if (got !== expected) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ---------- Health check ----------
app.get("/", (_req, res) => res.json({ status: "ok", service: "fiscal-microservice" }));

// ============================================================
//  1) PDF -> IMAGES
//  Reçoit un fichier "file" (multipart/form-data)
//  Renvoie { images: [ { page, b64 } ] }
// ============================================================
app.post("/pdf-to-images", checkAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "no file received (champ 'file' attendu)" });
    }

    const convert = fromBuffer(req.file.buffer, {
      density: 150,           // DPI : 150 = bon compromis lisibilité / taille
      format: "jpeg",
      width: 1240,            // largeur de rendu (px)
      preserveAspectRatio: true,
    });

    // convertit toutes les pages, retourne du base64
    const results = await convert.bulk(-1, { responseType: "base64" });

    const images = results
      .filter((r) => r && r.base64)
      .map((r, i) => ({ page: r.page || i + 1, b64: r.base64 }));

    if (images.length === 0) {
      return res.status(422).json({ error: "aucune page convertie" });
    }

    return res.json({ pages: images.length, images });
  } catch (err) {
    console.error("pdf-to-images error:", err);
    return res.status(500).json({ error: "conversion_failed", detail: String(err.message || err) });
  }
});

// ============================================================
//  2) BUILD PDF
//  Reçoit { synthese: {...} } (le JSON produit par GPT)
//  Renvoie directement le PDF (application/pdf) en binaire
// ============================================================
app.post("/build-pdf", checkAuth, (req, res) => {
  try {
    const s = (req.body && req.body.synthese) || {};

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="synthese.pdf"');
      res.send(pdf);
    });

    // ---- Palette ----
    const DARK = "#2E2E38";
    const YELLOW = "#C9A400";
    const GREY = "#595965";

    // ---- Helpers ----
    const H = (t) => {
      doc.moveDown(0.6);
      doc.fillColor(DARK).font("Helvetica-Bold").fontSize(13).text(t);
      const y = doc.y + 2;
      doc.moveTo(48, y).lineTo(547, y).lineWidth(1.5).strokeColor(YELLOW).stroke();
      doc.moveDown(0.4);
    };
    const sub = (t) => { doc.moveDown(0.35); doc.fillColor(DARK).font("Helvetica-Bold").fontSize(11).text(t); doc.moveDown(0.15); };
    const bullet = (t) => doc.fillColor("#333333").font("Helvetica").fontSize(10).text("•  " + t, { indent: 8, lineGap: 1 });
    const kv = (k, v) => {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text(k + " ", { continued: true });
      doc.font("Helvetica").fillColor("#333333").text(v || "—");
    };

    // ---- Titre ----
    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(20).text("Synthèse du redressement fiscal");
    if (s.societe) doc.fillColor(YELLOW).font("Helvetica-Bold").fontSize(13).text(s.societe);
    doc.moveDown(0.2);
    doc.fillColor(GREY).font("Helvetica").fontSize(9);
    const meta = [];
    if (s.matricule_fiscal) meta.push("Matricule fiscal : " + s.matricule_fiscal);
    if (s.reference_redressement) meta.push("Réf. : " + s.reference_redressement);
    if (meta.length) doc.text(meta.join("   •   "));

    // ---- Méta ----
    H("Période vérifiée");
    bullet(s.periode_verifiee || "—");

    H("Montant total du redressement");
    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(13).text(s.montant_total_redressement || "—");

    if (Array.isArray(s.impots_concernes) && s.impots_concernes.length) {
      H("Impôts et taxes concernés");
      s.impots_concernes.forEach((i) => bullet(i));
    }

    // ---- Chefs de redressement ----
    H("Principaux chefs de redressement");
    const chefs = Array.isArray(s.chefs_redressement) ? s.chefs_redressement : [];
    chefs.forEach((c, idx) => {
      sub(`${idx + 1}. ${c.impot || "Chef de redressement"}`);

      if (Array.isArray(c.motifs) && c.motifs.length) {
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("Modifications / motifs :");
        c.motifs.forEach((m) => bullet(m));
      }

      if (Array.isArray(c.articles_appliques) && c.articles_appliques.length) {
        doc.moveDown(0.15);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("Articles appliqués :");
        c.articles_appliques.forEach((a) => {
          doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("•  " + (a.article || ""), { indent: 8, continued: true });
          doc.font("Helvetica").fillColor(GREY).text("  —  " + (a.source || ""));
        });
      }

      if (Array.isArray(c.montants_par_annee) && c.montants_par_annee.length) {
        doc.moveDown(0.2);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("Montants par exercice :");
        // table simple
        const rows = c.montants_par_annee;
        const startX = 56, colW = 120;
        let x = startX, y = doc.y + 4;
        rows.forEach((r) => {
          doc.rect(x, y, colW, 20).fillAndStroke("#2E2E38", "#2E2E38");
          doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9).text(r.annee || "", x + 6, y + 6, { width: colW - 12 });
          x += colW;
          if (x + colW > 547) { x = startX; y += 40; }
        });
        x = startX; y += 20;
        // deuxième ligne : montants (réaligne sous les années)
        let x2 = startX, y2 = y;
        rows.forEach((r) => {
          doc.rect(x2, y2, colW, 20).fillAndStroke("#F2F2F4", "#DDDDDD");
          doc.fillColor("#2E2E38").font("Helvetica").fontSize(9).text(r.montant || "", x2 + 6, y2 + 6, { width: colW - 12 });
          x2 += colW;
          if (x2 + colW > 547) { x2 = startX; y2 += 40; }
        });
        doc.y = y2 + 28;
      }
      doc.moveDown(0.3);
    });

    doc.end();
  } catch (err) {
    console.error("build-pdf error:", err);
    return res.status(500).json({ error: "pdf_build_failed", detail: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Micro-service en écoute sur le port ${PORT}`));
