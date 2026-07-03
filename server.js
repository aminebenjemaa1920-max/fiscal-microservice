// ============================================================
//  Micro-service FISCAL — 2 endpoints pour le workflow n8n
//  1) POST /pdf-to-images : PDF scanné -> images base64 (via pdftoppm/Poppler)
//  2) POST /build-pdf     : JSON synthèse -> PDF français mis en forme
// ============================================================

const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "25mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

function checkAuth(req, res, next) {
  const expected = process.env.API_KEY;
  if (!expected) return next();
  const got = req.header("x-api-key");
  if (got !== expected) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/", (_req, res) => res.json({ status: "ok", service: "fiscal-microservice" }));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 200 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(cmd + " failed: " + (stderr || err.message)));
      resolve({ stdout, stderr });
    });
  });
}

// ---------- 1) PDF -> IMAGES (pdftoppm) ----------
app.post("/pdf-to-images", checkAuth, upload.single("file"), async (req, res) => {
  const workId = crypto.randomBytes(8).toString("hex");
  const workDir = path.join(os.tmpdir(), "pdf_" + workId);
  const inputPdf = path.join(workDir, "input.pdf");
  const outPrefix = path.join(workDir, "page");
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "no file received (champ 'file' attendu)" });
    }
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(inputPdf, req.file.buffer);

    await run("pdftoppm", ["-jpeg", "-r", "150", inputPdf, outPrefix]);

    const files = fs.readdirSync(workDir)
      .filter((f) => f.startsWith("page") && f.endsWith(".jpg"))
      .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));

    if (files.length === 0) {
      return res.status(422).json({ error: "aucune page convertie" });
    }
    const images = files.map((f, i) => ({
      page: i + 1,
      b64: fs.readFileSync(path.join(workDir, f)).toString("base64"),
    }));
    return res.json({ pages: images.length, images });
  } catch (err) {
    console.error("pdf-to-images error:", err);
    return res.status(500).json({ error: "conversion_failed", detail: String(err.message || err) });
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_e) {}
  }
});

// ---------- 2) BUILD PDF (pdfkit) ----------
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

    const DARK = "#2E2E38", YELLOW = "#C9A400", GREY = "#595965";
    const H = (t) => {
      doc.moveDown(0.6);
      doc.fillColor(DARK).font("Helvetica-Bold").fontSize(13).text(t);
      const y = doc.y + 2;
      doc.moveTo(48, y).lineTo(547, y).lineWidth(1.5).strokeColor(YELLOW).stroke();
      doc.moveDown(0.4);
    };
    const sub = (t) => { doc.moveDown(0.35); doc.fillColor(DARK).font("Helvetica-Bold").fontSize(11).text(t); doc.moveDown(0.15); };
    const bullet = (t) => doc.fillColor("#333333").font("Helvetica").fontSize(10).text("\u2022  " + t, { indent: 8, lineGap: 1 });

    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(20).text("Synth\u00e8se du redressement fiscal");
    if (s.societe) doc.fillColor(YELLOW).font("Helvetica-Bold").fontSize(13).text(s.societe);
    doc.moveDown(0.2);
    doc.fillColor(GREY).font("Helvetica").fontSize(9);
    const meta = [];
    if (s.matricule_fiscal) meta.push("Matricule fiscal : " + s.matricule_fiscal);
    if (s.reference_redressement) meta.push("R\u00e9f. : " + s.reference_redressement);
    if (meta.length) doc.text(meta.join("   \u2022   "));

    H("P\u00e9riode v\u00e9rifi\u00e9e");
    bullet(s.periode_verifiee || "\u2014");

    H("Montant total du redressement");
    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(13).text(s.montant_total_redressement || "\u2014");

    if (Array.isArray(s.impots_concernes) && s.impots_concernes.length) {
      H("Imp\u00f4ts et taxes concern\u00e9s");
      s.impots_concernes.forEach((i) => bullet(i));
    }

    H("Principaux chefs de redressement");
    const chefs = Array.isArray(s.chefs_redressement) ? s.chefs_redressement : [];
    chefs.forEach((c, idx) => {
      sub((idx + 1) + ". " + (c.impot || "Chef de redressement"));
      if (Array.isArray(c.motifs) && c.motifs.length) {
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("Modifications / motifs :");
        c.motifs.forEach((m) => bullet(m));
      }
      if (Array.isArray(c.articles_appliques) && c.articles_appliques.length) {
        doc.moveDown(0.15);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("Articles appliqu\u00e9s :");
        c.articles_appliques.forEach((a) => {
          doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("\u2022  " + (a.article || ""), { indent: 8, continued: true });
          doc.font("Helvetica").fillColor(GREY).text("  \u2014  " + (a.source || ""));
        });
      }
      if (Array.isArray(c.montants_par_annee) && c.montants_par_annee.length) {
        doc.moveDown(0.2);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("Montants par exercice :");
        const rows = c.montants_par_annee;
        const startX = 56, colW = 120;
        let x = startX, y = doc.y + 4;
        rows.forEach((r) => {
          doc.rect(x, y, colW, 20).fillAndStroke("#2E2E38", "#2E2E38");
          doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9).text(r.annee || "", x + 6, y + 6, { width: colW - 12 });
          x += colW;
          if (x + colW > 547) { x = startX; y += 40; }
        });
        let x2 = startX, y2 = y + 20;
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
app.listen(PORT, () => console.log("Micro-service en \u00e9coute sur le port " + PORT));
