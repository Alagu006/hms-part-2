const PptxGenJS = require("C:/Users/plala/AppData/Roaming/npm/node_modules/pptxgenjs");
const pptx = new PptxGenJS();

// ── Theme ──────────────────────────────────────────────────────────────────
const C = {
  navy:    "0D2137",
  teal:    "00B4D8",
  tealDk: "0096B7",
  white:   "FFFFFF",
  light:   "E8F4F8",
  gray:    "64748B",
  grayLt:  "CBD5E1",
  red:     "EF4444",
  green:   "22C55E",
  yellow:  "F59E0B",
  dark:    "1E293B",
};

pptx.layout  = "LAYOUT_WIDE";
pptx.author  = "HMS Team";
pptx.subject = "Hospital Management System";
pptx.title   = "Hospital Management System – Presentation";

// ── Helpers ────────────────────────────────────────────────────────────────
function addBg(slide, color) {
  slide.addShape(pptx.ShapeType.rect, { x:0, y:0, w:"100%", h:"100%", fill:{color: color||C.white} });
}

function addAccentBar(slide, color) {
  slide.addShape(pptx.ShapeType.rect, { x:0, y:0, w:0.18, h:"100%", fill:{color: color||C.teal} });
}

function sectionHeader(slide, text, y) {
  slide.addShape(pptx.ShapeType.rect, { x:0.3, y: y||0.28, w:9.1, h:0.55, fill:{color:C.navy}, line:{color:C.navy} });
  slide.addText(text, { x:0.3, y: y||0.28, w:9.1, h:0.55, fontSize:18, bold:true, color:C.white, align:"center", valign:"middle" });
}

function bullet(slide, items, opts) {
  const defaults = { x:0.55, y:1.05, w:8.9, h:5.2, fontSize:15, color:C.dark, bullet:{type:"bullet"}, lineSpacingMultiple:1.35, valign:"top" };
  slide.addText(items, Object.assign({}, defaults, opts));
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 1 – TITLE
// ══════════════════════════════════════════════════════════════════════════
(function() {
  const s = pptx.addSlide();
  // gradient-like bg: navy top half, teal strip
  s.addShape(pptx.ShapeType.rect, { x:0, y:0, w:"100%", h:"100%", fill:{color:C.navy} });
  s.addShape(pptx.ShapeType.rect, { x:0, y:4.8, w:"100%", h:2.3, fill:{color:C.tealDk} });
  s.addShape(pptx.ShapeType.rect, { x:0, y:4.75, w:"100%", h:0.08, fill:{color:C.teal} });

  s.addText("🏥  Hospital Management System", {
    x:0.4, y:0.7, w:9.2, h:1.1,
    fontSize:34, bold:true, color:C.white, align:"center"
  });
  s.addText("A Full-Stack, Role-Based, Secure Healthcare Platform", {
    x:0.4, y:1.85, w:9.2, h:0.6,
    fontSize:17, color:C.teal, align:"center", italic:true
  });
  s.addShape(pptx.ShapeType.rect, { x:3.5, y:2.6, w:3.0, h:0.05, fill:{color:C.teal} });

  const badges = [
    {t:"19 User Roles", x:0.5},
    {t:"30+ API Modules", x:2.7},
    {t:"40+ DB Tables", x:4.9},
    {t:"Real-Time + PWA", x:7.1},
  ];
  badges.forEach(b => {
    s.addShape(pptx.ShapeType.roundRect, { x:b.x, y:2.9, w:2.0, h:0.5, rectRadius:0.08, fill:{color:C.teal}, line:{color:C.white, pt:1} });
    s.addText(b.t, { x:b.x, y:2.9, w:2.0, h:0.5, fontSize:11, bold:true, color:C.white, align:"center", valign:"middle" });
  });

  s.addText("Presented by: [Your Name]  |  [Institution]  |  April 2026", {
    x:0.4, y:5.05, w:9.2, h:0.45,
    fontSize:12, color:C.white, align:"center"
  });
  s.addText("Speaker Notes: Introduce yourself. Explain this is a production-grade HMS covering every hospital department — clinical, admin, HR, billing, and security. Mention it supports 19 roles and is built as a PWA.", {
    x:0, y:0, w:0, h:0, fontSize:10, color:"000000"
  });
  s.addNotes("Introduce yourself. This is a production-grade Hospital Management System covering every hospital department — clinical, admin, HR, billing, and security. It supports 19 user roles and is built as a Progressive Web App.");
})();
