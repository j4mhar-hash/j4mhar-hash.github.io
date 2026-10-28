/**
 * Indicative demineraliser correlations, in the style of the capacity and
 * leakage charts in Dowex / AmberLite and Purolite engineering manuals
 * (gel SAC ~8% DVB, acrylic or styrenic WBA, Type I styrenic SBA).
 * They are typical curves, not a printout for a named resin grade.
 * Calibrate against your own exhaustion and leakage data.
 *
 * Silica is µg/L at the leakage outputs and mg/L on the feed analysis.
 * Capacities are eq per litre of resin. Loads elsewhere are eq/m³ of water.
 */

export type FlowMode = "co" | "counter";
export type SacAcid = "hcl" | "h2so4";

export type PredictWater = {
  t: number;
  tds: number;
  cat: number;
  ani: number;
  fma: number;
  sio2: number;
  co2In: number;
  naFrac: number;
  alkFrac: number;
  caFrac: number;
  so4Frac: number;
};

/** Linear interpolation. x is column 0, result is column 1. Ends are clamped. */
export function lut(table: number[][], x: number): number {
  if (!isFinite(x) || !table.length) return NaN;
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const a = table[i - 1], b = table[i];
      return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
  return table[table.length - 1][1];
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * SAC H-form, co-flow, HCl, reference water (about 40% Na, alk/anions 0.7,
 * 400 mg/L TDS, 25 °C). g/L as 100% HCl → operating capacity, eq/L.
 * Shape follows the usual diminishing-return regen curve (about 0.7 eq/L at
 * 40 g/L, about 1.0 eq/L near 80 g/L, flattening past 130 g/L).
 */
const SAC_HCL_CAP: number[][] = [[40, 0.70], [50, 0.80], [64, 0.92], [80, 1.02], [96, 1.10], [128, 1.20], [160, 1.26]];

/** Same reference, co-flow HCl: average Na leakage, mg/L Na. */
const SAC_HCL_NA: number[][] = [[40, 12], [50, 7], [64, 4], [80, 2.5], [100, 1.6], [128, 1.0], [160, 0.6]];

/** Capacity multiplier vs % of cations that are sodium. Reference 40%. */
const SAC_NA_CAP: number[][] = [[10, 1.08], [20, 1.05], [40, 1.00], [60, 0.94], [80, 0.88], [100, 0.82]];
/** Leakage multiplier vs % Na. Reference 40%. */
const SAC_NA_LEAK: number[][] = [[10, 0.45], [20, 0.65], [40, 1.00], [60, 1.60], [80, 2.40], [95, 3.20]];

/** Capacity multiplier vs M-alkalinity / total anions. Reference 0.70. */
const SAC_ALK_CAP: number[][] = [[0.2, 0.90], [0.4, 0.95], [0.7, 1.00], [0.9, 1.04], [1.0, 1.05]];

/** Capacity multiplier vs TDS mg/L. Reference 400. */
const SAC_TDS_CAP: number[][] = [[50, 1.06], [200, 1.03], [400, 1.00], [800, 0.96], [1500, 0.92], [3000, 0.86]];
/** Leakage multiplier vs TDS. */
const SAC_TDS_LEAK: number[][] = [[100, 0.70], [400, 1.00], [800, 1.35], [1500, 1.80]];

/** Capacity multiplier vs service temperature °C. Reference 25. */
const SAC_T_CAP: number[][] = [[5, 0.94], [15, 0.97], [25, 1.00], [35, 1.02], [45, 1.03]];
/** Leakage multiplier vs service temperature. */
const SAC_T_LEAK: number[][] = [[5, 1.12], [15, 1.04], [25, 1.00], [35, 0.95]];

/**
 * WBA, co-flow, NaOH g/L 100% → eq/L. About 1.2 eq/L near 50 g/L,
 * which matches a typical acrylic or styrenic weak-base curve.
 */
const WBA_CAP: number[][] = [[30, 0.90], [40, 1.05], [50, 1.18], [60, 1.28], [80, 1.40], [100, 1.48]];
/** WBA loses capacity as it gets warm. Reference 25 °C. */
const WBA_T: number[][] = [[5, 1.06], [15, 1.02], [25, 1.00], [35, 0.90], [45, 0.78], [55, 0.65]];

/**
 * SBA Type I, co-flow, NaOH g/L 100% → eq/L on the total anion load
 * (FMA + CO₂ + silica), low silica fraction, 25 °C.
 * About 0.45 eq/L near 70 g/L.
 */
const SBA_CAP: number[][] = [[40, 0.32], [50, 0.38], [64, 0.44], [80, 0.50], [100, 0.55], [120, 0.58], [160, 0.62]];
/** Co-flow silica leakage, µg/L SiO₂, at 25 °C caustic, modest silica fraction. */
const SBA_SI: number[][] = [[40, 250], [50, 140], [64, 80], [80, 45], [100, 30], [120, 22], [160, 15]];

/** Capacity falls as silica becomes a larger share of the SBA eq load. */
const SBA_SI_FRAC_CAP: number[][] = [[0, 1.05], [0.05, 1.00], [0.15, 0.92], [0.30, 0.84], [0.50, 0.75]];
/** Leakage rises with that same silica share. */
const SBA_SI_FRAC_LEAK: number[][] = [[0.02, 0.80], [0.08, 1.00], [0.15, 1.40], [0.30, 2.00]];
/** CO₂ fraction of the SBA load. Milder than silica. */
const SBA_CO2_FRAC_CAP: number[][] = [[0, 1.02], [0.3, 1.00], [0.6, 0.95], [0.8, 0.90]];

/** Type I service-temperature capacity factor. Reference 25 °C. */
const SBA1_T_CAP: number[][] = [[5, 0.90], [15, 0.96], [25, 1.00], [35, 1.03], [45, 1.04]];
/** Type II loses capacity once the bed is hot. */
const SBA2_T_CAP: number[][] = [[5, 0.92], [15, 0.97], [25, 1.00], [40, 0.95], [50, 0.85]];
/**
 * Silica leakage vs caustic temperature. Warm caustic (about 35–50 °C)
 * is what the manuals assume for a low silica endpoint. Reference 25 °C.
 */
const SBA_T_SI: number[][] = [[10, 3.0], [15, 2.2], [20, 1.6], [25, 1.0], [35, 0.55], [45, 0.40], [50, 0.35]];

/**
 * Mixed-bed capacity on the trace load (Na + silica), eq/L of mixed resin,
 * against the lower of the acid and caustic levels, g/L 100%.
 */
const MB_CAP: number[][] = [[60, 0.22], [80, 0.28], [100, 0.36], [120, 0.42], [150, 0.48]];

/** First-step H₂SO₄ strength (%) before CaSO₄ is likely in the resin. */
export function h2so4FirstStep(caFrac: number): number {
  if (!(caFrac > 0)) return 5;
  if (caFrac > 0.20) return 0.8;
  if (caFrac > 0.12) return 1.2;
  if (caFrac > 0.05) return 2.0;
  return 4;
}

function endFactor(endpt: number, ref: number): number {
  if (!(endpt > 0) || !(ref > 0)) return 1;
  return clamp(Math.pow(endpt / ref, 0.12), 0.82, 1.12);
}

export function sacPredict(w: PredictWater, dose: number, regen: SacAcid, flow: FlowMode, endpt: number, concPct: number): { cap: number; naLeak: number; h2so4: string | null } {
  const naPct = clamp((isFinite(w.naFrac) ? w.naFrac : 0) * 100, 0, 100);
  let cap = lut(SAC_HCL_CAP, dose) * lut(SAC_NA_CAP, naPct) * lut(SAC_ALK_CAP, w.alkFrac) * lut(SAC_TDS_CAP, w.tds) * lut(SAC_T_CAP, w.t);
  let na = lut(SAC_HCL_NA, dose) * lut(SAC_NA_LEAK, naPct) * lut(SAC_TDS_LEAK, w.tds) * lut(SAC_T_LEAK, w.t);
  if (regen === "h2so4") { cap *= 0.90; na *= 1.35; }
  if (flow === "counter") { cap *= 1.12; na *= 0.40; }
  cap *= endFactor(endpt, 1.0);
  let h2so4: string | null = null;
  if (regen === "h2so4") {
    const lim = h2so4FirstStep(w.caFrac);
    if (concPct > lim + 0.05) {
      cap *= 0.85;
      h2so4 = `H₂SO₄ at ${concPct.toFixed(1)}% with calcium about ${(w.caFrac * 100).toFixed(0)}% of cations. Typical first step is ≤ ${lim}% then a step up, or calcium sulphate can precipitate in the bed and cut capacity.`;
    }
  }
  return { cap: clamp(cap, 0.35, 1.55), naLeak: Math.max(na, 0.02), h2so4 };
}

export function wbaPredict(w: PredictWater, dose: number, flow: FlowMode): { cap: number } {
  const so4 = clamp(isFinite(w.so4Frac) ? w.so4Frac : 0, 0, 1);
  let cap = lut(WBA_CAP, dose) * lut(WBA_T, w.t) * (0.96 + 0.10 * so4);
  if (flow === "counter") cap *= 1.05;
  return { cap: clamp(cap, 0.45, 1.70) };
}

export function sbaPredict(w: PredictWater, dose: number, flow: FlowMode, type: "1" | "2", regenT: number, co2mg: number, endptUg: number): { cap: number; siLeak: number } {
  const siEq = (w.sio2 > 0 ? w.sio2 : 0) / 60.08;
  const co2Eq = (co2mg > 0 ? co2mg : 0) / 44.01;
  const load = Math.max(w.fma + siEq + co2Eq, 1e-6);
  const siFrac = siEq / load;
  const co2Frac = co2Eq / load;
  let cap = lut(SBA_CAP, dose) * lut(SBA_SI_FRAC_CAP, siFrac) * lut(SBA_CO2_FRAC_CAP, co2Frac) * lut(type === "2" ? SBA2_T_CAP : SBA1_T_CAP, w.t);
  let si = lut(SBA_SI, dose) * lut(SBA_SI_FRAC_LEAK, siFrac) * lut(SBA_T_SI, regenT);
  if (type === "2") { cap *= 1.22; si *= 2.2; }
  if (flow === "counter") { cap *= 1.10; si *= 0.55; }
  cap *= endFactor(endptUg, 50);
  return { cap: clamp(cap, 0.18, 0.85), siLeak: Math.max(si, 1) };
}

export function mbPredict(doseAcid: number, doseCaustic: number, flow: FlowMode, endpt: number): { cap: number } {
  const dose = Math.min(doseAcid > 0 ? doseAcid : doseCaustic, doseCaustic > 0 ? doseCaustic : doseAcid);
  let cap = lut(MB_CAP, dose);
  if (flow === "counter") cap *= 1.08;
  cap *= endFactor(endpt, 0.2);
  return { cap: clamp(cap, 0.12, 0.60) };
}

/**
 * Forced-draft degasser. At the design flow the residual is the design
 * figure (often ~5 mg/L). Below design it moves toward about 2 mg/L
 * (acid water against air). Above design it rises with (Q/Qdesign)²,
 * which is the same overload rule the plant mimic already uses.
 * Fan off: no stripping.
 */
export function degasPredict(co2In: number, q: number, qCap: number, design: number, fanOn: boolean): number {
  if (!(co2In > 0)) return 0;
  if (!fanOn) return co2In;
  const base = design > 0 ? design : 5;
  const load = qCap > 0 ? q / qCap : 1;
  if (!(load > 0)) return Math.min(co2In, 2);
  const residual = load <= 1 ? 2 + (base - 2) * load : base * load * load;
  return clamp(Math.min(co2In, residual), 0, co2In);
}

export function effCheck(pct: number, hints: string[]): { tone: "success" | "warning" | "danger"; text: string } {
  if (!isFinite(pct)) return { tone: "warning", text: "No theoretical throughput" };
  const shown = `${pct.toFixed(0)}% of theoretical`;
  if (pct >= 85) return { tone: "success", text: shown };
  const why = (hints.length ? hints.slice(0, 2) : ["fouling, channelling, poor regen distribution, endpoint set early, or resin age"]).join("; ");
  return { tone: pct < 70 ? "danger" : "warning", text: `${shown}. Likely: ${why}.` };
}

export type DeminUnit = {
  id: string;
  type: "sac" | "wba" | "sba" | "mb";
  status: string;
  dia: number;
  vol: number;
  cap: number;
  dose: number;
  dose2: number;
  regen: string;
  conc: number;
  rinse: number;
};

export type DeminIn = {
  units: DeminUnit[];
  load: { sac: number; wba: number; sba: number; mb: number };
  q: number;
  dem: number;
  hrs: number;
  days: number;
  pair: boolean;
  tf: boolean;
  hclPrice: number;
  hclStr: number;
  h2so4Price: number;
  h2so4Str: number;
  naohPrice: number;
  naohStr: number;
  kwhPrice: number;
  waterPrice: number;
  effPrice: number;
  resin: { sac: number; wba: number; sba: number; mb: number };
  resinLife: { sac: number; wba: number; sba: number; mb: number };
  rtSac: number;
  rtAn: number;
  rtMb: number;
  pumpN: number;
  pumpDuty: number;
  pumpQ: number;
  pumpH: number;
  pumpKw: number;
  pumpEff: number;
  pumpMeff: number;
  pumpHrs: number;
  fanKw: number;
  fanOn: boolean;
  naLeak: number;
  siLeak: number;
};

export type DeminOut = {
  thr: { sac: number; wba: number; sba: number; mb: number };
  runH: { sac: number; wba: number; sba: number; mb: number };
  regYr: { sac: number; wba: number; sba: number; mb: number };
  chemT: number;
  waste: number;
  cost: number;
  bottleneck: string;
};

const LIM: Record<string, { vMax: number; bvMax: number }> = {
  sac: { vMax: 40, bvMax: 40 }, wba: { vMax: 40, bvMax: 40 }, sba: { vMax: 40, bvMax: 40 }, mb: { vMax: 60, bvMax: 50 },
};

/** Same throughput, chemical and water totals as the plant mimic, for the what-if column. */
export function runDemin(p: DeminIn): DeminOut {
  const perKg = (price: number, str: number): number => price / 1000 / ((str > 0 ? str : 100) / 100);
  const price: Record<string, { perKg: number; str: number }> = {
    hcl: { perKg: perKg(p.hclPrice, p.hclStr), str: p.hclStr / 100 },
    h2so4: { perKg: perKg(p.h2so4Price, p.h2so4Str), str: p.h2so4Str / 100 },
    naoh: { perKg: perKg(p.naohPrice, p.naohStr), str: p.naohStr / 100 },
  };
  const stageQ = (t: string): number => (t === "mb" ? p.dem : p.q);
  const nSvc = (t: string): number => p.units.filter((u) => u.type === t && u.status === "svc").length;
  const rows = p.units.map((u) => {
    const lim = LIM[u.type];
    const area = (Math.PI * u.dia * u.dia) / 4;
    const ns = nSvc(u.type);
    const flow = u.status === "svc" && ns > 0 ? stageQ(u.type) / ns : 0;
    const regen = u.type === "wba" || u.type === "sba" ? "naoh" : (u.regen || "hcl");
    const kg1 = (u.dose * u.vol) / 1000;
    const kg2 = u.type === "mb" ? (u.dose2 * u.vol) / 1000 : 0;
    const tf = u.type === "wba" && p.tf;
    const chem = price[regen] || price.hcl;
    const regCost = tf ? 0 : kg1 * chem.perKg + kg2 * price.naoh.perKg;
    const conc = (u.conc > 0 ? u.conc : 4) / 100;
    const waste = (u.rinse * u.vol) / 1000 + (tf ? 0 : (kg1 + kg2) / conc / 1000);
    const load = p.load[u.type];
    const thr = load > 0 ? (u.vol * u.cap) / load : NaN;
    return {
      ...u, regen, flow, kg1, kg2, regCost, waste, thr,
      runH: flow > 0 && isFinite(thr) ? thr / flow : NaN,
      eqEx: u.vol * u.cap,
      hydMax: Math.min(area * lim.vMax, (u.vol * lim.bvMax) / 1000),
    };
  });
  const sum = (xs: number[]): number => xs.reduce((s, x) => s + (isFinite(x) ? x : 0), 0);
  const prodYr = p.dem * p.hrs * p.days;
  const rt = (t: string): number => (t === "sac" ? p.rtSac : t === "mb" ? p.rtMb : p.rtAn);
  const stage = (t: string, volYr: number, regOv?: number) => {
    const rs = rows.filter((r) => r.type === t);
    const av = rs.filter((r) => r.status !== "oos");
    const svc = rs.filter((r) => r.status === "svc");
    const nA = Math.max(av.length, 1);
    const mean = (f: (r: typeof rows[0]) => number): number => sum(av.map(f)) / nA;
    const meanEq = mean((r) => r.eqEx);
    const load = p.load[t as "sac" | "wba" | "sba" | "mb"];
    const regYr = regOv ?? (meanEq > 0 ? (volYr * load) / meanEq : NaN);
    let chemYr = 0;
    let wasteYr = 0;
    const kg: Record<string, number> = {};
    av.forEach((r) => {
      const share = regYr / nA;
      chemYr += r.regCost * share;
      wasteYr += r.waste * share;
      if (!(r.type === "wba" && p.tf)) kg[r.regen] = (kg[r.regen] || 0) + r.kg1 * share;
      if (r.kg2 > 0) kg.naoh = (kg.naoh || 0) + r.kg2 * share;
    });
    const runs = svc.map((r) => r.runH).filter((x) => isFinite(x));
    const thrs = (svc.length ? svc : av).map((r) => r.thr).filter((x) => isFinite(x));
    const capAll = sum(av.map((r) => r.hydMax));
    return {
      regYr, chemYr, wasteYr, kg, capAll, need: stageQ(t),
      minRunH: runs.length ? Math.min(...runs) : NaN,
      meanThr: thrs.length ? sum(thrs) / thrs.length : NaN,
      meanRun: runs.length ? sum(runs) / runs.length : NaN,
    };
  };
  const mb = stage("mb", prodYr);
  const prim0 = prodYr + mb.wasteYr;
  const wba0 = stage("wba", prim0);
  const sba0 = stage("sba", prim0);
  const primYr = prim0 + wba0.wasteYr + sba0.wasteYr;
  const sac = stage("sac", primYr);
  const pair = p.pair ? Math.max(stage("wba", primYr).regYr, stage("sba", primYr).regYr) : undefined;
  const wba = stage("wba", primYr, pair);
  const sba = stage("sba", primYr, pair);
  const stages = { sac, wba, sba, mb };
  const names = { sac: "SAC", wba: "WBA", sba: "SBA", mb: "Mixed beds" };
  let chemYr = 0, wasteYr = 0;
  const kg: Record<string, number> = {};
  (["sac", "wba", "sba", "mb"] as const).forEach((t) => {
    chemYr += stages[t].chemYr;
    wasteYr += stages[t].wasteYr;
    Object.keys(stages[t].kg).forEach((k) => { kg[k] = (kg[k] || 0) + stages[t].kg[k]; });
  });
  const chemT = Object.keys(kg).reduce((s, k) => s + kg[k] / 1000 / (price[k] ? price[k].str : 1), 0);
  const waterP = p.waterPrice + p.effPrice;
  const primHrs = p.q > 0 ? primYr / p.q : 0;
  const fanKwh = p.fanOn ? p.fanKw * primHrs : 0;
  const pd = Math.max(Math.round(p.pumpDuty) || 0, 0);
  const pq = pd > 0 ? p.dem / pd : NaN;
  const shaft = pd > 0 ? ((pq * p.pumpH) / 367) / (p.pumpEff / 100) : 0;
  const pkw = pd > 0 ? (shaft / (p.pumpMeff / 100)) * pd : 0;
  const powYr = (pkw * p.pumpHrs + fanKwh) * p.kwhPrice;
  const resinYr = p.units.reduce((s, u) => s + (u.vol * p.resin[u.type]) / p.resinLife[u.type], 0);
  const cost = chemYr + wasteYr * waterP + powYr + resinYr;
  let bottleneck = "—";
  let worst = Infinity;
  (["sac", "wba", "sba", "mb"] as const).forEach((t) => {
    const hyd = stages[t].need > 0 ? stages[t].capAll / stages[t].need : Infinity;
    const run = rt(t) > 0 && isFinite(stages[t].minRunH) ? stages[t].minRunH / rt(t) : Infinity;
    const score = Math.min(hyd, run);
    if (score < worst) { worst = score; bottleneck = names[t]; }
  });
  const dg = p.q > 0 ? (p.fanOn ? 1 : 0) : 1;
  if (dg === 0) bottleneck = "Degasser";
  return {
    thr: { sac: sac.meanThr, wba: wba.meanThr, sba: sba.meanThr, mb: mb.meanThr },
    runH: { sac: sac.meanRun, wba: wba.meanRun, sba: sba.meanRun, mb: mb.meanRun },
    regYr: { sac: sac.regYr, wba: wba.regYr, sba: sba.regYr, mb: mb.regYr },
    chemT, waste: wasteYr, cost, bottleneck,
  };
}
