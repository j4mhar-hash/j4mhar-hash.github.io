import {
  Page, Section, Text, Table, Grid, Input, Select, Segmented, Callout, Equation, Frac, Pow, Button, LineChart, Fragment, useState, useEffect, useGrokTheme,
  type ChangeEvent,
} from "./canvas";
import {
  sacPredict, wbaPredict, sbaPredict, mbPredict, degasPredict, effCheck, runDemin,
  type DeminUnit, type FlowMode, type PredictWater,
} from "./pm-predict";

type Vals = Record<string, string>;
type Tone = "success" | "warning" | "danger";
type Chk = { text: string; tone?: Tone };
type Row = [string, string, string, Chk | null];
type Opt = { value: string; label: string };
type IonDef = { k: string; short: string; label: string; mw: number; z: number; cat: boolean };
type An = { ion: Record<string, number>; malk: number; palk: number; ph: number; t: number; ec: number; tdsM: number; tdsMode: string; ecK: number };
type Ch = {
  an: An; cat: number; ani: number; err: number; I: number; Itds: number; A: number; g1: number; g2: number; g3: number;
  hco3: number; co3: number; oh: number; co2: number; ct: number; tdsCalc: number; tds: number; caC: number; hard: number;
  pHs: number; lsi: number; rsi: number; pHeq: number; psi: number; ls: number; ai: number;
  siCal: number; siGyp: number; siBar: number; siCel: number; siFlu: number; silSol: number; silPct: number; capi: number; palkCalc: number;
};

// ---------------- Shared analysis definitions ----------------
const AN_IONS: IonDef[] = [
  { k: "ca", short: "Ca", label: "Calcium Ca²⁺", mw: 40.078, z: 2, cat: true },
  { k: "mg", short: "Mg", label: "Magnesium Mg²⁺", mw: 24.305, z: 2, cat: true },
  { k: "na", short: "Na", label: "Sodium Na⁺", mw: 22.99, z: 1, cat: true },
  { k: "k", short: "K", label: "Potassium K⁺", mw: 39.098, z: 1, cat: true },
  { k: "ba", short: "Ba", label: "Barium Ba²⁺", mw: 137.33, z: 2, cat: true },
  { k: "sr", short: "Sr", label: "Strontium Sr²⁺", mw: 87.62, z: 2, cat: true },
  { k: "fe", short: "Fe", label: "Iron Fe²⁺", mw: 55.845, z: 2, cat: true },
  { k: "mn", short: "Mn", label: "Manganese Mn²⁺", mw: 54.938, z: 2, cat: true },
  { k: "nh4", short: "NH₄", label: "Ammonium NH₄⁺", mw: 18.039, z: 1, cat: true },
  { k: "cl", short: "Cl", label: "Chloride Cl⁻", mw: 35.453, z: 1, cat: false },
  { k: "so4", short: "SO₄", label: "Sulphate SO₄²⁻", mw: 96.06, z: 2, cat: false },
  { k: "no3", short: "NO₃", label: "Nitrate NO₃⁻", mw: 62.004, z: 1, cat: false },
  { k: "f", short: "F", label: "Fluoride F⁻", mw: 18.998, z: 1, cat: false },
  { k: "po4", short: "PO₄", label: "Phosphate PO₄³⁻", mw: 94.971, z: 3, cat: false },
  { k: "sio2", short: "SiO₂", label: "Silica SiO₂ (uncharged)", mw: 60.08, z: 0, cat: false },
];
const CATS = AN_IONS.filter((d: IonDef) => d.cat);
const ANS = AN_IONS.filter((d: IonDef) => !d.cat);
const caF = (d: IonDef): number => (50.04 * (d.z || 1)) / d.mw;
const ionDef = (k: string): IonDef => AN_IONS.find((d: IonDef) => d.k === k) ?? AN_IONS[0];

const ANA_A: Vals = {
  a_unit: "ion", a_alkmode: "malk", a_tdsmode: "calc", a_ca: "110", a_mg: "8", a_na: "30", a_k: "4", a_ba: "0.05", a_sr: "0.5",
  a_fe: "0.05", a_mn: "0.01", a_nh4: "0.05", a_cl: "40", a_so4: "50", a_no3: "30", a_f: "0.2", a_po4: "0.2", a_sio2: "12",
  a_malk: "250", a_palk: "0", a_hco3: "305", a_co3: "0", a_ph: "7.4", a_t: "12", a_ec: "650", a_tds: "450", a_eck: "0.65", a_tol: "5",
};
const ANA_B: Vals = {
  b_unit: "ion", b_alkmode: "malk", b_tdsmode: "calc", b_ca: "12", b_mg: "2", b_na: "8", b_k: "1", b_ba: "0", b_sr: "0.02",
  b_fe: "0.05", b_mn: "0.01", b_nh4: "0", b_cl: "14", b_so4: "8", b_no3: "3", b_f: "0.05", b_po4: "0", b_sio2: "4",
  b_malk: "25", b_palk: "0", b_hco3: "30", b_co3: "0", b_ph: "7.0", b_t: "10", b_ec: "100", b_tds: "80", b_eck: "0.65",
};

// ---------------- Plant mimic: demineralisation plant ----------------
type PmType = "sac" | "wba" | "sba" | "mb";
type PmUnit = { id: string; type: PmType; label: string };
const PM_UNITS: PmUnit[] = [
  { id: "sac1", type: "sac", label: "SAC-1" }, { id: "sac2", type: "sac", label: "SAC-2" }, { id: "sac3", type: "sac", label: "SAC-3" },
  { id: "wba1", type: "wba", label: "WBA-1" }, { id: "wba2", type: "wba", label: "WBA-2" }, { id: "wba3", type: "wba", label: "WBA-3" },
  { id: "sba1", type: "sba", label: "SBA-1" }, { id: "sba2", type: "sba", label: "SBA-2" }, { id: "sba3", type: "sba", label: "SBA-3" },
  { id: "mb1", type: "mb", label: "MB-1" }, { id: "mb2", type: "mb", label: "MB-2" }, { id: "mb3", type: "mb", label: "MB-3" },
  { id: "mb4", type: "mb", label: "MB-4" }, { id: "mb5", type: "mb", label: "MB-5" },
];
type PmTypeDef = { label: string; dia: string; vol: string; cap: string; regen: string; dose: string; dose2: string; conc: string; rinse: string; endpt: string; endLbl: string; rinseTyp: number; ratioMax: number; vMax: number; bvMax: number };
const PM_TYPE: Record<PmType, PmTypeDef> = {
  sac: { label: "SAC (strong acid cation, H-form)", dia: "1.6", vol: "4000", cap: "1.0", regen: "hcl", dose: "80", dose2: "0", conc: "5", rinse: "6", endpt: "1.0", endLbl: "Endpoint: Na slip (mg/L)", rinseTyp: 6, ratioMax: 3, vMax: 40, bvMax: 40 },
  wba: { label: "WBA (weak base anion)", dia: "1.6", vol: "3000", cap: "1.2", regen: "naoh", dose: "50", dose2: "0", conc: "4", rinse: "5", endpt: "50", endLbl: "Endpoint: outlet conductivity (µS/cm)", rinseTyp: 6, ratioMax: 1.6, vMax: 40, bvMax: 40 },
  sba: { label: "SBA (strong base anion, Type I)", dia: "1.1", vol: "1000", cap: "0.45", regen: "naoh", dose: "70", dose2: "0", conc: "4", rinse: "8", endpt: "100", endLbl: "Endpoint: silica (µg/L)", rinseTyp: 10, ratioMax: 4.5, vMax: 40, bvMax: 40 },
  mb: { label: "Mixed bed (polisher)", dia: "1.2", vol: "1500", cap: "0.3", regen: "hcl", dose: "100", dose2: "100", conc: "5", rinse: "10", endpt: "0.2", endLbl: "Endpoint: conductivity (µS/cm)", rinseTyp: 12, ratioMax: 99, vMax: 60, bvMax: 50 },
};
const pmDoseHi = (t: PmType, regen: string): number => (t === "sac" ? (regen === "h2so4" ? 150 : 100) : t === "wba" ? 60 : t === "sba" ? 80 : 120);
const PM_STAT: Record<string, [string, string]> = {
  sac1: ["svc", "250"], sac2: ["svc", "100"], sac3: ["stby", "0"],
  wba1: ["svc", "600"], wba2: ["svc", "200"], wba3: ["stby", "0"],
  sba1: ["svc", "600"], sba2: ["svc", "200"], sba3: ["stby", "0"],
  mb1: ["svc", "3000"], mb2: ["svc", "1200"], mb3: ["stby", "0"], mb4: ["stby", "0"], mb5: ["regen", "0"],
};
const PM_FIELDS = ["dia", "vol", "cap", "regen", "dose", "dose2", "conc", "rinse", "endpt"];
const PM_DEF: Vals = PM_UNITS.reduce((o: Vals, u: PmUnit) => {
  const t = PM_TYPE[u.type] as unknown as Record<string, string>;
  PM_FIELDS.forEach((f: string) => { o[`pm_${u.id}_${f}`] = String(t[f]); });
  const s = PM_STAT[u.id] ?? ["stby", "0"];
  o[`pm_${u.id}_status`] = s[0];
  o[`pm_${u.id}_thru`] = s[1];
  o[`pm_${u.id}_hrs`] = "";
  return o;
}, {
  pm_src: "shared", pm_q: "60", pm_dem: "50", pm_hrs: "24", pm_days: "365", pm_naleak: "1.0", pm_sileak: "50", pm_tf: "no", pm_pair: "yes",
  pm_dg_co2: "5", pm_dg_fan: "on", pm_dg_ph: "", pm_dg_cap: "80", pm_dg_kw: "4",
  pm_tk_vol: "150", pm_tk_lvl: "60", pm_tk_hi: "90", pm_tk_lo: "25",
  pm_p_n: "2", pm_p_duty: "1", pm_p_q: "60", pm_p_h: "45", pm_p_kw: "15", pm_p_eff: "65", pm_p_meff: "92", pm_p_hrs: "8760",
  pm_mb_cond: "0.1", pm_mb_si: "10", pm_rt_sac: "2.5", pm_rt_an: "4", pm_rt_mb: "6",
  pm_c_hcl: "180", pm_c_hcls: "33", pm_c_h2so4: "150", pm_c_h2so4s: "96", pm_c_naoh: "400", pm_c_naohs: "47",
  pm_c_kwh: "0.20", pm_c_water: "1.50", pm_c_eff: "1.20",
  pm_rc_sac: "4", pm_rl_sac: "10", pm_rc_wba: "8", pm_rl_wba: "8", pm_rc_sba: "10", pm_rl_sba: "6", pm_rc_mb: "12", pm_rl_mb: "6",
  pm_basis: "measured", pm_flow_sac: "counter", pm_flow_wba: "co", pm_flow_sba: "counter", pm_flow_mb: "counter",
  pm_sba_type: "1", pm_regen_t: "35",
  pm_mthr_sac: "", pm_mthr_wba: "", pm_mthr_sba: "", pm_mthr_mb: "",
  pm_sc_tds: "100", pm_sc_hard: "100", pm_sc_alk: "100", pm_sc_sio2: "100", pm_sc_t: "",
  pm_sc_dose_sac: "", pm_sc_dose_wba: "", pm_sc_dose_sba: "", pm_sc_dose_mb: "", pm_sc_dose_mb2: "",
  pm_sc_regen_sac: "", pm_sc_flow_sac: "", pm_sc_flow_wba: "", pm_sc_flow_sba: "", pm_sc_flow_mb: "",
  pm_sc_sba_type: "", pm_sc_regen_t: "",
  pm_sc_q: "", pm_sc_dem: "", pm_sc_n_sac: "", pm_sc_n_wba: "", pm_sc_n_sba: "", pm_sc_n_mb: "",
  pm_sc_end_sac: "", pm_sc_end_sba: "", pm_sc_end_mb: "",
  pm_sc_c_hcl: "", pm_sc_c_h2so4: "", pm_sc_c_naoh: "", pm_sc_c_water: "", pm_sc_c_eff: "", pm_sc_c_kwh: "",
} as Vals);
const PMW_DEF: Vals = Object.keys(ANA_A).reduce((o: Vals, k: string) => { o["pm_w_" + k.slice(2)] = ANA_A[k]; return o; }, {} as Vals);

// local ion-exchange analysis override (same keys as Water A, prefix ix_i_)
const IXI_DEF: Vals = Object.keys(ANA_A).reduce((o: Vals, k: string) => { o["ix_i_" + k.slice(2)] = ANA_A[k]; return o; }, {} as Vals);

const DEF: Vals = {
  ...ANA_A, ...ANA_B, ...IXI_DEF, ...PMW_DEF, ...PM_DEF,
  ix_isrc: "shared", ix_cv_ion: "ca", ix_cv_val: "100", ix_cv_basis: "ion",
  ix_src: "shared", ix_degas: "yes", ix_co2: "5",
  ix_type: "sac_na", ix_vol: "1000", ix_cap: "1.1", ix_load: "300", ix_margin: "10", ix_flow: "10", ix_dia: "1.2",
  ix_regen: "nacl", ix_dose: "150", ix_str: "26", ix_sg: "1.2", ix_rinse: "6", ix_target: "200", ix_vdes: "25", ix_hours: "24", ix_days: "365",
  ro_src: "shared",
  ro_qf: "24", ro_qp: "18", ro_cf: "800", ro_cp: "12", ro_pf: "12", ro_pc: "10.5", ro_pp: "0.5", ro_t: "15",
  ro_area: "37.2", ro_n: "24", ro_epv: "6", ro_stages: "2", ro_k: "2640", ro_pi: "0.00075", ro_type: "well", ro_jt: "25",
  ro_bqf: "26", ro_bqp: "19.5", ro_bcf: "750", ro_bcp: "8", ro_bpf: "11.5", ro_bpc: "10.2", ro_bpp: "0.5", ro_bt: "20",
  ro_ca: "150", ro_alk: "120", ro_ph: "7.5", ro_sio2: "15", ro_lsimax: "1.8",
  si_src: "shared", si_ph: "7.8", si_t: "25", si_mode: "tds", si_tds: "500", si_ec: "770", si_k: "0.65", si_ca: "200", si_alk: "150", si_cl: "50", si_so4: "60",
  ct_src: "shared", ct_circ: "500", ct_dt: "6", ct_k: "0.00153", ct_drift: "0.005", ct_mode: "cycles", ct_coc: "4", ct_ecm: "450", ct_ect: "1800", ct_vol: "60",
  ct_inh: "100", ct_inhsg: "1.1", ct_bio: "100", ct_biosg: "1.05", ct_hours: "8000", ct_tcoc: "6", ct_price: "2.0",
  ct_tw: "30", ct_skin: "50", ct_phmode: "enter", ct_phv: "8.6",
  ct_ca: "275", ct_alk: "250", ct_ph0: "7.4", ct_tds: "435", ct_cl: "40", ct_so4: "50", ct_sio2: "12",
  bo_src: "shared", bo_soft: "yes", bo_alk: "250",
  bo_steam: "5000", bo_mutds: "150", bo_cr: "60", bo_ctds: "10", bo_max: "3000", bo_p: "10", bo_tf: "85", bo_pfl: "0.5",
  bo_hours: "6000", bo_eff: "85", bo_fuel: "0.05", bo_scav: "sulphite", bo_o2: "2.0", bo_res: "40", bo_str: "20", bo_sg: "1.2",
  bo_sipu: "barg", bo_sip: "40", bo_sibwu: "5000", bo_siph: "10.5", bo_simc: "0.05", bo_silimu: "20", bo_sin: "1.9", bo_sisrc: "local", bo_sifwu: "100",
  cb_acid: "h2so4", cb_dose: "100", cb_co2: "5", cb_pht: "6.5", cb_q: "10",
  fm_src: "shared", fm_fe: "0.5", fm_mn: "0.1", fm_q: "50", fm_str: "140", fm_dem: "0",
  cl_src: "shared", cl_ph: "7.4", cl_t: "12", cl_nh3: "0.04", cl_free: "1.0", cl_total: "1.3", cl_dem: "1.0", cl_res: "1.0", cl_q: "50", cl_str: "140", cl_ph2: "8.0", cl_ratio: "80",
  bl_mode: "blend", bl_pa: "50", bl_coc: "4", bl_phmode: "enter", bl_phv: "8.6", bl_t: "30", bl_R: "75", bl_rej: "99",
  ww_q: "2000", ww_bod: "250", ww_cod: "500", ww_tss: "220", ww_bode: "15", ww_tsse: "20", ww_v: "1500", ww_mlss: "3000", ww_vf: "0.75",
  ww_qw: "40", ww_xw: "8000", ww_nh: "0", ww_rr: "0.75", ww_cd: "14", ww_ote: "10", ww_ds: "1",
  ww_coag: "fecl3", ww_cdose: "40", ww_phq: "10", ww_phin: "2.5", ww_pht: "7", ww_base: "naoh32", ww_acid: "h2so4",
  cv_ion: "ca", cv_val: "100", cv_dir: "ion", cv_hval: "250", cv_hunit: "caco3", cv_ec: "1000", cv_k: "0.65", cv_fval: "10", cv_funit: "m3h",
  cv_dppm: "5", cv_dq: "50", cv_dbasis: "product", cv_dstr: "100", cv_dsg: "1.2", cv_pump: "0.25", cv_bar: "10", cv_tc: "25",
};

const RESIN: Record<string, { label: string; cap: string; regen: string; dose: string; str: string; sg: string; load: string }> = {
  sac_na: { label: "Softener (SAC, Na-form)", cap: "1.1", regen: "nacl", dose: "150", str: "26", sg: "1.2", load: "total hardness (Ca + Mg + Sr + Ba) as CaCO₃" },
  sac_h: { label: "SAC, H-form (demin cation)", cap: "1.0", regen: "hcl", dose: "80", str: "33", sg: "1.16", load: "total cations as CaCO₃" },
  wac: { label: "WAC (dealkalisation)", cap: "2.0", regen: "hcl", dose: "80", str: "33", sg: "1.16", load: "the lower of hardness and M-alkalinity as CaCO₃" },
  sba1: { label: "SBA Type I", cap: "0.45", regen: "naoh", dose: "70", str: "32", sg: "1.35", load: "strong anions + CO₂ + SiO₂ as CaCO₃" },
  sba2: { label: "SBA Type II", cap: "0.6", regen: "naoh", dose: "60", str: "32", sg: "1.35", load: "strong anions + CO₂ + SiO₂ as CaCO₃" },
  wba: { label: "WBA", cap: "1.1", regen: "naoh", dose: "55", str: "32", sg: "1.35", load: "free mineral acidity (Cl + SO₄ + NO₃ + F) as CaCO₃" },
  mb: { label: "Mixed bed (anion-limited)", cap: "0.3", regen: "naoh", dose: "100", str: "32", sg: "1.35", load: "total cations as CaCO₃; normally fed with demin or RO permeate, so use a local load" },
};
const REGEN: Record<string, { label: string; short: string; ew: number }> = {
  nacl: { label: "Sodium chloride (NaCl)", short: "NaCl", ew: 58.44 },
  hcl: { label: "Hydrochloric acid (HCl)", short: "HCl", ew: 36.46 },
  h2so4: { label: "Sulphuric acid (H₂SO₄)", short: "H₂SO₄", ew: 49.04 },
  naoh: { label: "Sodium hydroxide (NaOH)", short: "NaOH", ew: 40.0 },
};
const RO_TYPES: Record<string, { label: string; lo: number; hi: number }> = {
  perm: { label: "RO permeate (SDI < 1)", lo: 30, hi: 40 },
  well: { label: "Well / borehole (SDI < 3)", lo: 22, hi: 29 },
  surfuf: { label: "Surface water, UF pretreated", lo: 20, hi: 26 },
  surfconv: { label: "Surface water, conventional", lo: 17, hi: 22 },
  ww: { label: "Tertiary wastewater, UF pretreated", lo: 14, hi: 20 },
  sw: { label: "Seawater, open intake", lo: 12, hi: 17 },
};
const SCAV: Record<string, { label: string; ratio: number; res: string; resFactor: number; volatile: boolean }> = {
  sulphite: { label: "Sodium sulphite (Na₂SO₃)", ratio: 7.88, res: "40", resFactor: 1.575, volatile: false },
  meta: { label: "Sodium metabisulphite (Na₂S₂O₅)", ratio: 5.94, res: "40", resFactor: 1.188, volatile: false },
  deha: { label: "DEHA", ratio: 1.24, res: "0.1", resFactor: 1, volatile: true },
  hydrazine: { label: "Hydrazine (N₂H₄)", ratio: 1.0, res: "0.05", resFactor: 1, volatile: true },
  carbo: { label: "Carbohydrazide", ratio: 1.41, res: "0.05", resFactor: 1, volatile: true },
};
const COAG: Record<string, { label: string; sg: number; metal: number; hyd: number; m: string }> = {
  fecl3: { label: "Ferric chloride 40%", sg: 1.42, metal: 0.138, hyd: 1.91, m: "Fe" },
  fe2so4: { label: "Ferric sulphate 12% Fe", sg: 1.55, metal: 0.12, hyd: 1.91, m: "Fe" },
  alum: { label: "Aluminium sulphate 8% Al₂O₃", sg: 1.32, metal: 0.0423, hyd: 2.89, m: "Al" },
  pac: { label: "PACl 10% Al₂O₃", sg: 1.2, metal: 0.0529, hyd: 2.89, m: "Al" },
};
const BASES: Record<string, { label: string; ew: number; str: number; sg: number }> = {
  naoh32: { label: "Caustic soda 32%", ew: 40.0, str: 32, sg: 1.35 },
  naoh47: { label: "Caustic soda 47%", ew: 40.0, str: 47, sg: 1.5 },
  lime: { label: "Lime slurry 10% Ca(OH)₂", ew: 37.05, str: 10, sg: 1.07 },
};
const ACIDS: Record<string, { label: string; ew: number; str: number; sg: number }> = {
  h2so4: { label: "Sulphuric acid 96%", ew: 49.04, str: 96, sg: 1.84 },
  hcl: { label: "Hydrochloric acid 33%", ew: 36.46, str: 33, sg: 1.16 },
};
const OXID: { label: string; fe: number; mn: number }[] = [
  { label: "Chlorine (as Cl₂)", fe: 0.64, mn: 1.29 },
  { label: "Potassium permanganate KMnO₄", fe: 0.94, mn: 1.92 },
  { label: "Oxygen (aeration)", fe: 0.14, mn: 0.29 },
  { label: "Chlorine dioxide ClO₂", fe: 1.21, mn: 2.45 },
];
const IONS: { k: string; label: string; ew: number }[] = [
  { k: "ca", label: "Calcium Ca²⁺", ew: 20.04 }, { k: "mg", label: "Magnesium Mg²⁺", ew: 12.15 }, { k: "na", label: "Sodium Na⁺", ew: 22.99 },
  { k: "k", label: "Potassium K⁺", ew: 39.1 }, { k: "nh4", label: "Ammonium NH₄⁺", ew: 18.04 }, { k: "fe", label: "Iron Fe²⁺", ew: 27.92 },
  { k: "ba", label: "Barium Ba²⁺", ew: 68.67 }, { k: "sr", label: "Strontium Sr²⁺", ew: 43.81 }, { k: "mn", label: "Manganese Mn²⁺", ew: 27.47 },
  { k: "hco3", label: "Bicarbonate HCO₃⁻", ew: 61.02 }, { k: "co3", label: "Carbonate CO₃²⁻", ew: 30.0 }, { k: "oh", label: "Hydroxide OH⁻", ew: 17.01 },
  { k: "cl", label: "Chloride Cl⁻", ew: 35.45 }, { k: "so4", label: "Sulphate SO₄²⁻", ew: 48.03 }, { k: "no3", label: "Nitrate NO₃⁻", ew: 62.0 },
  { k: "f", label: "Fluoride F⁻", ew: 19.0 }, { k: "po4", label: "Phosphate PO₄³⁻", ew: 31.66 }, { k: "sio2", label: "Silica SiO₂ (monovalent)", ew: 60.08 },
  { k: "co2", label: "Carbon dioxide CO₂ (monovalent)", ew: 44.01 },
];
const FLOW: Record<string, { label: string; f: number }> = {
  m3h: { label: "m³/h", f: 1 }, ls: { label: "L/s", f: 3.6 }, m3d: { label: "m³/day", f: 1 / 24 }, mld: { label: "ML/day", f: 1000 / 24 },
  ukgpm: { label: "UK gal/min", f: 0.272765 }, usgpm: { label: "US gal/min", f: 0.227125 },
};
const HARD: Record<string, { label: string; f: number }> = {
  caco3: { label: "mg/L as CaCO₃", f: 1 }, dh: { label: "°dH (German)", f: 17.848 }, clark: { label: "°e (Clark, English)", f: 14.254 },
  fh: { label: "°f (French)", f: 10.009 }, gpg: { label: "grains/US gal", f: 17.118 }, mmol: { label: "mmol/L", f: 100.09 }, meq: { label: "meq/L", f: 50.04 },
};
// Saturated water / steam densities, IAPWS-IF97: [bar a, rho_liquid, rho_vapour] kg/m³
const SATRHO: number[][] = [
  [1, 958.6, 0.590], [2, 942.9, 1.129], [5, 915.3, 2.668], [10, 887.1, 5.145], [15, 866.6, 7.593], [20, 849.8, 10.042],
  [25, 835.1, 12.508], [30, 821.9, 15.001], [40, 798.4, 20.090], [50, 777.4, 25.351], [60, 758.0, 30.818], [70, 739.7, 36.524],
  [80, 722.2, 42.503], [90, 705.2, 48.797], [100, 688.4, 55.452], [110, 671.8, 62.524], [120, 655.2, 70.082], [130, 638.4, 78.216],
  [140, 621.2, 87.041], [150, 603.5, 96.711], [160, 585.0, 107.433], [170, 565.2, 119.484], [180, 543.6, 133.357], [190, 519.4, 149.866],
  [200, 490.5, 170.699], [210, 452.1, 200.494], [220, 363.6, 279.593],
];
// Styrikovich: silica distribution ratio Kd = (rho_v / rho_l)^n at neutral pH
function kdSi(pA: number, nExp: number): number {
  if (!isFinite(pA) || pA <= 0 || pA >= 220.64) return NaN;
  return Math.pow(interp(SATRHO, pA, 2) / interp(SATRHO, pA, 1), nExp);
}
const kdF = (x: number): string => (!isFinite(x) ? "–" : x >= 0.001 ? String(Number(x.toPrecision(3))) : x.toExponential(2));
const p10 = (x: number): string => {
  const y = Math.pow(10, x);
  if (!isFinite(y)) return "–";
  return y >= 10 ? fmt(y, 0) : y >= 1 ? fmt(y, 1) : String(Number(y.toPrecision(2)));
};
const STEAM: number[][] = [
  [1.013, 100.0, 419.1, 2256.5], [1.5, 111.4, 467.1, 2226.5], [2, 120.2, 504.7, 2201.9], [3, 133.5, 561.5, 2163.9],
  [4, 143.6, 604.7, 2133.4], [5, 151.8, 640.2, 2107.4], [6, 158.8, 670.4, 2085.1], [7, 165.0, 697.1, 2064.9],
  [8, 170.4, 721.0, 2046.5], [9, 175.4, 742.7, 2029.5], [10, 179.9, 762.7, 2013.6], [12, 188.0, 798.5, 1984.3],
  [14, 195.0, 830.1, 1957.7], [16, 201.4, 858.6, 1933.2], [18, 207.1, 884.6, 1910.3], [20, 212.4, 908.6, 1888.6],
  [25, 224.0, 962.0, 1840.1], [30, 233.9, 1008.4, 1795.7], [40, 250.4, 1087.4, 1712.9],
];
const O2SAT: number[][] = [[0, 14.6], [10, 11.3], [20, 9.1], [30, 7.6], [40, 6.4], [50, 5.5], [60, 4.7], [70, 3.8], [80, 2.8], [90, 1.6], [100, 0]];
const STORE = "wts:values";

// ---------------- Chemistry engine ----------------
const lgK1 = (T: number): number => -356.3094 - 0.06091964 * T + 21834.37 / T + 126.8339 * Math.log10(T) - 1684915 / (T * T);
const lgK2 = (T: number): number => -107.8871 - 0.03252849 * T + 5151.79 / T + 38.92561 * Math.log10(T) - 563713.9 / (T * T);
const lgKH = (T: number): number => 108.3865 + 0.01985076 * T - 6919.53 / T - 40.45154 * Math.log10(T) + 669365 / (T * T);
const lgKw = (T: number): number => -(4470.99 / T - 6.0875 + 0.01706 * T);
const lgKcal = (T: number): number => -171.9065 - 0.077993 * T + 2839.319 / T + 71.595 * Math.log10(T);
const lgKgyp = (T: number): number => 68.2401 - 3221.51 / T - 25.0627 * Math.log10(T);
const lgKbar = (T: number): number => 136.035 - 7680.41 / T - 48.595 * Math.log10(T);
const lgKflu = (T: number): number => 66.348 - 4298.2 / T - 25.271 * Math.log10(T);
const lgKcel = (T: number): number => -6.63 + 882.2 * (1 / T - 1 / 298.15);
const pKaHOCl = (T: number): number => 3000 / T - 10.0686 + 0.0253 * T;
const silS0 = (T: number): number => Math.pow(10, 4.52 - 731 / T);

function davA(t: number): number {
  const e = 87.74 - 0.4008 * t + 9.398e-4 * t * t - 1.41e-6 * t * t * t;
  return 1.82e6 * Math.pow(e * (t + 273.15), -1.5);
}
function gam(z: number, I: number, A: number): number {
  const s = Math.sqrt(I);
  return Math.pow(10, -A * z * z * (s / (1 + s) - 0.3 * I));
}
function pHs(t: number, tds: number, ca: number, alk: number): number {
  const A = (Math.log10(tds) - 1) / 10;
  const B = -13.12 * Math.log10(t + 273) + 34.55;
  const C = Math.log10(ca) - 0.4;
  const D = Math.log10(alk);
  return 9.3 + A + B - (C + D);
}

function chem(a: An): Ch {
  const t = a.t, T = t + 273.15;
  const mol: Record<string, number> = {};
  let sz = 0, cat = 0, ani = 0, sumMg = 0;
  AN_IONS.forEach((d: IonDef) => {
    const c = a.ion[d.k] || 0;
    mol[d.k] = c / 1000 / d.mw;
    sz += mol[d.k] * d.z * d.z;
    sumMg += c;
    if (d.z > 0) {
      const meq = c / (d.mw / d.z);
      if (d.cat) cat += meq; else ani += meq;
    }
  });
  ani += a.malk / 50.04;
  const alkEq = a.malk / 50040;
  const H = Math.pow(10, -a.ph);
  const K1 = Math.pow(10, lgK1(T)), K2 = Math.pow(10, lgK2(T)), Kw = Math.pow(10, lgKw(T));
  const A = davA(t);
  let I = 0.5 * (sz + Math.max(alkEq, 0)), g1 = 1, g2 = 1, g3 = 1, hco3 = 0, co3 = 0, oh = 0, hc = 0, co2 = 0;
  for (let i = 0; i < 6; i++) {
    g1 = gam(1, I, A); g2 = gam(2, I, A); g3 = gam(3, I, A);
    oh = Kw / (H * g1); hc = H / g1;
    const r2 = (K2 * g1) / (H * g2);
    hco3 = Math.max((alkEq - oh + hc) / (1 + 2 * r2), 0);
    co3 = hco3 * r2;
    co2 = (H * hco3 * g1) / K1;
    I = 0.5 * (sz + hco3 + 4 * co3 + oh + hc);
  }
  const tdsCalc = sumMg + 0.4917 * hco3 * 61017 + co3 * 60009 + oh * 17007;
  const tds = a.tdsMode === "meas" ? a.tdsM : a.tdsMode === "ec" ? a.ec * a.ecK : tdsCalc;
  const caC = (a.ion.ca || 0) * 2.4972;
  const hard = ["ca", "mg", "sr", "ba"].reduce((s: number, k: string) => s + (a.ion[k] || 0) * caF(ionDef(k)), 0);
  const p = pHs(t, tds, caC, a.malk);
  const pHeq = 1.465 * Math.log10(a.malk) + 4.54;
  const po4 = a.ion.po4 || 0;
  const silSol = silS0(T) * (1 + Math.pow(10, a.ph - 9.83) / g1);
  return {
    an: a, cat, ani, err: ((cat - ani) / (cat + ani)) * 100, I, Itds: 2.5e-5 * tds, A, g1, g2, g3,
    hco3, co3, oh, co2, ct: co2 + hco3 + co3, tdsCalc, tds, caC, hard,
    pHs: p, lsi: a.ph - p, rsi: 2 * p - a.ph, pHeq, psi: 2 * p - pHeq,
    ls: ((a.ion.cl || 0) / 35.453 + (a.ion.so4 || 0) / 48.03) / (a.malk / 50.04),
    ai: a.ph + Math.log10(caC * a.malk),
    siCal: Math.log10(g2 * mol.ca * g2 * co3) - lgKcal(T),
    siGyp: Math.log10(g2 * mol.ca * g2 * mol.so4) - lgKgyp(T),
    siBar: Math.log10(g2 * mol.ba * g2 * mol.so4) - lgKbar(T),
    siCel: Math.log10(g2 * mol.sr * g2 * mol.so4) - lgKcel(T),
    siFlu: Math.log10(g2 * mol.ca * Math.pow(g1 * mol.f, 2)) - lgKflu(T),
    silSol, silPct: ((a.ion.sio2 || 0) / silSol) * 100,
    capi: po4 > 0 ? a.ph - (11.75 - Math.log10(caC) - Math.log10(po4) - 2 * Math.log10(t)) / 0.65 : NaN,
    palkCalc: oh * 50040 + co3 * 50043,
  };
}

function bisect(f: (x: number) => number, target: number): number {
  let lo = 0, hi = 14;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < target) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
// Solve pH for a water whose alkalinity is set, with either total carbonate (closed system) or free CO2 fixed.
function phSolve(a: An, mode: string, val: number): number {
  const T = a.t + 273.15;
  const K1 = Math.pow(10, lgK1(T)), K2 = Math.pow(10, lgK2(T)), Kw = Math.pow(10, lgKw(T));
  const alk = a.malk / 50040;
  let ph = isFinite(a.ph) ? a.ph : 7;
  for (let i = 0; i < 3; i++) {
    const c = chem({ ...a, ph });
    const g1 = isFinite(c.g1) ? c.g1 : 1, g2 = isFinite(c.g2) ? c.g2 : 1;
    ph = bisect((x: number) => {
      const H = Math.pow(10, -x);
      const r1 = K1 / (H * g1), r2 = (K2 * g1) / (H * g2);
      const w = Kw / (H * g1) - H / g1;
      if (mode === "co2") return val * (r1 + 2 * r1 * r2) + w;
      return (val * (r1 + 2 * r1 * r2)) / (1 + r1 + r1 * r2) + w;
    }, alk);
  }
  return ph;
}
function alkAtPh(c: Ch, ph: number): number {
  const T = c.an.t + 273.15;
  const K1 = Math.pow(10, lgK1(T)), K2 = Math.pow(10, lgK2(T)), Kw = Math.pow(10, lgKw(T));
  const H = Math.pow(10, -ph);
  const r1 = K1 / (H * c.g1), r2 = (K2 * c.g1) / (H * c.g2);
  return (c.ct * (r1 + 2 * r1 * r2)) / (1 + r1 + r1 * r2) + Kw / (H * c.g1) - H / c.g1;
}
function scaleAn(a: An, f: number): An {
  const ion: Record<string, number> = {};
  Object.keys(a.ion).forEach((k: string) => { ion[k] = a.ion[k] * f; });
  return { ...a, ion, malk: a.malk * f, palk: a.palk * f, ec: a.ec * f, tdsM: a.tdsM * f };
}
function concRO(a: An, c: Ch, R: number, rej: number): An {
  const f = (1 - R * (1 - rej)) / (1 - R);
  const s = scaleAn(a, f);
  return { ...s, ph: phSolve(s, "co2", c.co2) };
}
function concCycles(a: An, coc: number, t: number, mode: string, phv: number): An {
  const s: An = { ...scaleAn(a, coc), t };
  if (mode === "enter") return { ...s, ph: phv };
  const co2 = Math.pow(10, lgKH(t + 273.15)) * 4.2e-4;
  return { ...s, ph: phSolve(s, "co2", co2) };
}
function blendAn(a: An, b: An, ca: Ch, cb: Ch, fa: number): An {
  const fb = 1 - fa;
  const ion: Record<string, number> = {};
  AN_IONS.forEach((d: IonDef) => { ion[d.k] = fa * (a.ion[d.k] || 0) + fb * (b.ion[d.k] || 0); });
  const m: An = {
    ion, malk: fa * a.malk + fb * b.malk, palk: fa * a.palk + fb * b.palk, ph: fa * a.ph + fb * b.ph, t: fa * a.t + fb * b.t,
    ec: fa * a.ec + fb * b.ec, tdsM: fa * a.tdsM + fb * b.tdsM, tdsMode: "calc", ecK: a.ecK,
  };
  return { ...m, ph: phSolve(m, "ct", fa * ca.ct + fb * cb.ct) };
}
function mkAn(p: { caC: number; malk: number; ph: number; t: number; tds?: number; cl?: number; so4?: number; sio2?: number }): An {
  const ion: Record<string, number> = {};
  AN_IONS.forEach((d: IonDef) => { ion[d.k] = 0; });
  ion.ca = (p.caC || 0) / 2.4972;
  ion.cl = p.cl || 0;
  ion.so4 = p.so4 || 0;
  ion.sio2 = p.sio2 || 0;
  const catM = ion.ca / 20.039;
  const aniM = (p.malk || 0) / 50.04 + ion.cl / 35.453 + ion.so4 / 48.03;
  if (aniM > catM) ion.na = (aniM - catM) * 22.99; else ion.cl += (catM - aniM) * 35.453;
  const tds = p.tds ?? NaN;
  const hasT = isFinite(tds) && tds > 0;
  return { ion, malk: p.malk || 0, palk: 0, ph: p.ph, t: p.t, ec: NaN, tdsM: hasT ? tds : NaN, tdsMode: hasT ? "meas" : "calc", ecK: 0.65 };
}
function pmSplit(P: number, M: number): { oh: number; co3: number; hco3: number } {
  if (!(P > 0)) return { oh: 0, co3: 0, hco3: Math.max(M, 0) };
  if (P >= M) return { oh: M, co3: 0, hco3: 0 };
  if (2 * P < M) return { oh: 0, co3: 2 * P, hco3: M - 2 * P };
  return { oh: 2 * P - M, co3: 2 * (M - P), hco3: 0 };
}

function interp(tbl: number[][], x: number, col: number): number {
  if (!isFinite(x)) return NaN;
  if (x <= tbl[0][0]) return tbl[0][col];
  for (let i = 1; i < tbl.length; i++) {
    if (x <= tbl[i][0]) {
      const a = tbl[i - 1], b = tbl[i];
      return a[col] + ((x - a[0]) / (b[0] - a[0])) * (b[col] - a[col]);
    }
  }
  return tbl[tbl.length - 1][col];
}
function fmt(x: number, d: number = 2): string {
  if (!isFinite(x)) return "–";
  return x.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
}
const sig = (x: number): string => String(Number(x.toPrecision(4)));
const pf = (s: string | undefined): number => { const x = parseFloat(s ?? ""); return isFinite(x) ? x : 0; };

function lsiChk(l: number): Chk | null {
  if (!isFinite(l)) return null;
  if (l < -2) return { text: "Severely corrosive", tone: "danger" };
  if (l < -0.5) return { text: "Corrosive (under-saturated)", tone: "warning" };
  if (l <= 0.5) return { text: "Near balanced", tone: "success" };
  if (l <= 2) return { text: "Scale forming", tone: "warning" };
  return { text: "Severe scaling", tone: "danger" };
}
function rsiChk(r: number): Chk | null {
  if (!isFinite(r)) return null;
  if (r < 5) return { text: "Heavy scale", tone: "danger" };
  if (r < 6) return { text: "Light scale", tone: "warning" };
  if (r < 7) return { text: "Little scale or corrosion", tone: "success" };
  if (r < 7.5) return { text: "Significant corrosion", tone: "warning" };
  if (r < 9) return { text: "Heavy corrosion", tone: "danger" };
  return { text: "Intolerable corrosion", tone: "danger" };
}
function psiChk(p: number): Chk | null {
  if (!isFinite(p)) return null;
  if (p < 4.5) return { text: "Heavy scaling", tone: "danger" };
  if (p < 6) return { text: "Scaling", tone: "warning" };
  if (p <= 7) return { text: "Balanced", tone: "success" };
  if (p <= 8) return { text: "Corrosive", tone: "warning" };
  return { text: "Highly corrosive", tone: "danger" };
}
function siChk(si: number): Chk | null {
  if (!isFinite(si)) return null;
  if (si <= 0) return { text: "Undersaturated", tone: "success" };
  if (si <= 1) return { text: "Supersaturated – inhibitor needed", tone: "warning" };
  return { text: "Highly supersaturated", tone: "danger" };
}
function silChk(p: number): Chk | null {
  if (!isFinite(p)) return null;
  if (p <= 100) return { text: "Below solubility", tone: "success" };
  if (p <= 150) return { text: "Above solubility – silica inhibitor", tone: "warning" };
  return { text: "Well above solubility", tone: "danger" };
}
function capChk(x: number): Chk | null {
  if (!isFinite(x)) return null;
  if (x <= 0) return { text: "No Ca-phosphate tendency", tone: "success" };
  if (x <= 1.5) return { text: "Tendency – dispersant needed", tone: "warning" };
  return { text: "Strong deposition tendency", tone: "danger" };
}
function range(x: number, lo: number, hi: number, okT: string, loT: string, hiT: string, loTone: Tone = "warning", hiTone: Tone = "warning"): Chk | null {
  if (!isFinite(x)) return null;
  if (x < lo) return { text: loT, tone: loTone };
  if (x > hi) return { text: hiT, tone: hiTone };
  return { text: okT, tone: "success" };
}
const pctSat = (si: number): string => (isFinite(si) ? `SI · ${fmt(Math.pow(10, si) * 100, 0)}% of saturation` : "SI");
function satRows(c: Ch): Row[] {
  return [
    ["Calcite: LSI (simple)", fmt(c.lsi, 2), "–", lsiChk(c.lsi)],
    ["Calcite: SI (activity-corrected)", fmt(c.siCal, 2), pctSat(c.siCal), lsiChk(c.siCal)],
    ["Ryznar index", fmt(c.rsi, 2), "–", rsiChk(c.rsi)],
    ["Gypsum CaSO₄·2H₂O", fmt(c.siGyp, 2), pctSat(c.siGyp), siChk(c.siGyp)],
    ["Barite BaSO₄", fmt(c.siBar, 2), pctSat(c.siBar), siChk(c.siBar)],
    ["Celestite SrSO₄", fmt(c.siCel, 2), pctSat(c.siCel), siChk(c.siCel)],
    ["Fluorite CaF₂", fmt(c.siFlu, 2), pctSat(c.siFlu), siChk(c.siFlu)],
    ["Amorphous silica", fmt(c.silPct, 0), `% of ${fmt(c.silSol, 0)} mg/L solubility`, silChk(c.silPct)],
    ["Calcium phosphate index (pH − pHp)", fmt(c.capi, 2), "–", capChk(c.capi)],
  ];
}

// ---------- persistence: browser storage (when the viewer allows it) + file / code fallback ----------
const PROFILES = "wts:profiles";
const lsGet = (k: string): string | null => {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem(k) : null; } catch (e) { return null; }
};
const lsSet = (k: string, x: string): boolean => {
  try { if (typeof window === "undefined" || !window.localStorage) return false; window.localStorage.setItem(k, x); return window.localStorage.getItem(k) === x; } catch (e) { return false; }
};
const storageWorks = (): boolean => {
  const k = "wts:probe", x = String(Date.now());
  const ok = lsSet(k, x);
  try { if (ok) window.localStorage.removeItem(k); } catch (e) { /* ignore */ }
  return ok;
};
// keep only known keys with string values, so an imported file can't break the page
const cleanVals = (o: unknown): Vals => {
  const out: Vals = {};
  if (!o || typeof o !== "object") return out;
  const r = o as Record<string, unknown>;
  Object.keys(r).forEach((k: string) => {
    const x = r[k];
    if (k in DEF && (typeof x === "string" || typeof x === "number")) out[k] = String(x);
  });
  return out;
};
const b64enc = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b: number) => { bin += String.fromCharCode(b); });
  return btoa(bin);
};
const b64dec = (s: string): string => {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};
// accepts a saved JSON file, a raw values object, or a settings code "WTS1:..."
const parseSettings = (text: string): Vals | null => {
  try {
    let t = text.trim();
    if (t.startsWith("WTS1:")) t = b64dec(t.slice(5).replace(/\s+/g, ""));
    const j = JSON.parse(t) as Record<string, unknown>;
    const vals = cleanVals(j && typeof j.values === "object" ? j.values : j);
    return Object.keys(vals).length ? vals : null;
  } catch (e) {
    return null;
  }
};

function loadVals(): Vals {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const s = window.localStorage.getItem(STORE);
      if (s) {
        let saved: Vals;
        try {
          saved = JSON.parse(s) as Vals;
        } catch (e) {
          lsSet(STORE + ".corrupt", s); // keep unreadable data rather than overwrite it
          return DEF;
        }
        const o: Vals = { ...DEF, ...saved };
        // migrate old steam silica settings stored in mg/L to µg/L (× 1000)
        [["bo_silim", "bo_silimu"], ["bo_sibw", "bo_sibwu"], ["bo_sifw", "bo_sifwu"]].forEach((pr: string[]) => {
          const oldK = pr[0], newK = pr[1];
          if (saved[oldK] !== undefined && saved[newK] === undefined) {
            const x = parseFloat(saved[oldK]);
            if (isFinite(x) && x >= 0) o[newK] = String(Number((x * 1000).toPrecision(6)));
          }
          delete o[oldK];
        });
        return o;
      }
    }
  } catch (e) {
    return DEF;
  }
  return DEF;
}

export default function App() {
  const [v, setV] = useState<Vals>(loadVals);
  const [tab, setTab] = useState<string>("an");
  const [pmSel, setPmSel] = useState<string>("sac1");
  const pmTh = useGrokTheme();
  // persistence status + save/load tools
  const [stOk] = useState<boolean>(storageWorks);
  const [savedAt, setSavedAt] = useState<string>("");
  const [ioMsg, setIoMsg] = useState<string>("");
  const [ioScope, setIoScope] = useState<string>("all");
  const [codeOut, setCodeOut] = useState<string>("");
  const [codeIn, setCodeIn] = useState<string>("");
  const [profName, setProfName] = useState<string>("");
  const [profSel, setProfSel] = useState<string>("");
  const [profiles, setProfiles] = useState<Record<string, Vals>>(() => {
    try { const s = lsGet(PROFILES); return s ? (JSON.parse(s) as Record<string, Vals>) : {}; } catch (e) { return {}; }
  });
  const hhmm = (): string => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  // Ask the browser to keep this origin's storage (shared with the other app on the site). Best-effort; some browsers grant it only after a tap.
  useEffect(() => {
    const ask = (): void => {
      try {
        const st = navigator.storage;
        if (st && typeof st.persist === "function") void st.persist();
      } catch (e) { /* ignore */ }
    };
    ask();
    try { window.addEventListener("pointerdown", ask, { once: true }); } catch (e) { /* ignore */ }
    return () => { try { window.removeEventListener("pointerdown", ask); } catch (e) { /* ignore */ } };
  }, []);
  // autosave every change (all tabs share one store); verified by reading back
  useEffect(() => {
    if (lsSet(STORE, JSON.stringify(v))) setSavedAt(hhmm());
  }, [v]);
  // belt and braces: write again when the page is hidden or closed
  useEffect(() => {
    const flush = (): void => { lsSet(STORE, JSON.stringify(v)); };
    try {
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", flush);
    } catch (e) { /* ignore */ }
    return () => {
      try {
        window.removeEventListener("pagehide", flush);
        document.removeEventListener("visibilitychange", flush);
      } catch (e) { /* ignore */ }
    };
  }, [v]);
  const ioVals = (scope: string): Vals => {
    const o: Vals = {};
    Object.keys(v).forEach((k: string) => { if (k in DEF && (scope === "all" || k.startsWith("pm_"))) o[k] = v[k]; });
    return o;
  };
  const ioPayload = (scope: string): string =>
    JSON.stringify({ app: "water-treatment-suite", format: 1, scope: scope === "all" ? "all tabs" : "plant mimic", savedAt: new Date().toISOString(), values: ioVals(scope) }, null, 1);
  const ioApply = (vals: Vals | null, from: string): void => {
    if (!vals) { setIoMsg(`Could not read ${from}: not a Water Treatment Suite settings file or code.`); return; }
    setMany(vals);
    setIoMsg(`Loaded ${Object.keys(vals).length} values from ${from} at ${hhmm()}.`);
  };
  const saveFile = (): void => {
    try {
      const blob = new Blob([ioPayload(ioScope)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
      a.href = url;
      a.download = `water-treatment-${ioScope === "all" ? "all-tabs" : "plant"}-${d}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setIoMsg(`Download started at ${hhmm()}. If no file appears, the viewer blocks downloads: use Copy settings code instead.`);
    } catch (e) {
      setIoMsg("This viewer blocked the download. Use Copy settings code instead.");
    }
  };
  const loadFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => ioApply(parseSettings(String(rd.result ?? "")), `file ${f.name}`);
    rd.onerror = () => setIoMsg("Could not read that file.");
    rd.readAsText(f);
    e.target.value = "";
  };
  const copyCode = (): void => {
    const code = "WTS1:" + b64enc(JSON.stringify({ app: "water-treatment-suite", format: 1, values: ioVals(ioScope) }));
    setCodeOut(code);
    try {
      navigator.clipboard.writeText(code).then(
        () => setIoMsg(`Settings code copied to the clipboard at ${hhmm()}. Paste it somewhere safe (email, notes).`),
        () => setIoMsg("Clipboard blocked here: select the code in the box below and copy it by hand."),
      );
    } catch (err) {
      setIoMsg("Clipboard blocked here: select the code in the box below and copy it by hand.");
    }
  };
  const saveProfile = (): void => {
    const nm = profName.trim();
    if (!nm) { setIoMsg("Enter a profile name first."); return; }
    const p = { ...profiles, [nm]: ioVals("all") };
    if (lsSet(PROFILES, JSON.stringify(p))) { setProfiles(p); setProfSel(nm); setIoMsg(`Profile "${nm}" saved at ${hhmm()}.`); }
    else setIoMsg("Browser storage unavailable: profile not saved. Use Save to file or the settings code.");
  };
  const deleteProfile = (): void => {
    if (!profSel || !profiles[profSel]) return;
    const p = { ...profiles };
    delete p[profSel];
    lsSet(PROFILES, JSON.stringify(p));
    setProfiles(p);
    setIoMsg(`Profile "${profSel}" deleted.`);
    setProfSel("");
  };
  const taStyle = { width: "100%", minHeight: 70, boxSizing: "border-box" as const, fontFamily: "monospace", fontSize: 12, padding: 8, borderRadius: 8 };

  const set = (k: string, x: string): void => setV((p: Vals) => ({ ...p, [k]: x }));
  const setMany = (o: Vals): void => setV((p: Vals) => ({ ...p, ...o }));
  const reset = (prefix: string): void =>
    setV((p: Vals) => {
      const o: Vals = { ...p };
      Object.keys(DEF).forEach((k: string) => { if (k.startsWith(prefix)) o[k] = DEF[k]; });
      return o;
    });
  const n = (k: string): number => { const x = parseFloat(v[k] ?? ""); return isFinite(x) ? x : NaN; };
  const inp = (k: string, label: string) => (
    <Input key={k} label={label} type="number" value={v[k] ?? ""} onChange={(x: string) => set(k, x)} />
  );
  const sel = (k: string, label: string, options: Opt[], onCh?: (x: string) => void) => (
    <Select key={k} label={label} options={options} value={v[k] ?? ""} onChange={(x: string) => (onCh ? onCh(x) : set(k, x))} />
  );
  const table = (rows: Row[]) => (
    <Table
      columns={["Result", "Value", "Unit", "Check"]}
      align={["start", "end", "start", "start"]}
      rows={rows.map((r: Row) => {
        const c = r[3];
        return [r[0], r[1], r[2], c ? (c.tone ? { text: c.text, tone: c.tone } : c.text) : ""];
      })}
    />
  );
  const resetBtn = (prefix: string) => <Button label="Reset defaults" onClick={() => reset(prefix)} />;
  const opts = (rec: Record<string, { label: string }>): Opt[] => Object.keys(rec).map((k: string) => ({ value: k, label: rec[k].label }));
  const srcSel = (k: string) => sel(k, "Water data source", [{ value: "shared", label: "Shared water analysis" }, { value: "local", label: "Local inputs (override)" }]);

  // ---------- analysis readers ----------
  const readAn = (p: string): An => {
    const ion: Record<string, number> = {};
    const cc = v[p + "unit"] === "caco3";
    AN_IONS.forEach((d: IonDef) => {
      const x = n(p + d.k);
      ion[d.k] = isFinite(x) ? (cc ? x / caF(d) : x) : 0;
    });
    let malk = n(p + "malk"), palk = n(p + "palk");
    if (v[p + "alkmode"] === "ions") {
      const h = n(p + "hco3") || 0, c = n(p + "co3") || 0;
      malk = h * 0.8202 + c * 1.668;
      palk = (c * 1.668) / 2;
    }
    return { ion, malk: malk || 0, palk: palk || 0, ph: n(p + "ph"), t: n(p + "t"), ec: n(p + "ec"), tdsM: n(p + "tds"), tdsMode: v[p + "tdsmode"] ?? "calc", ecK: n(p + "eck") };
  };
  const changeUnit = (p: string, u: string): void =>
    setV((prev: Vals) => {
      if (prev[p + "unit"] === u) return prev;
      const o: Vals = { ...prev, [p + "unit"]: u };
      AN_IONS.forEach((d: IonDef) => {
        const x = parseFloat(prev[p + d.k] ?? "");
        if (isFinite(x)) o[p + d.k] = sig(u === "caco3" ? x * caF(d) : x / caF(d));
      });
      return o;
    });
  const changeAlk = (p: string, m: string): void =>
    setV((prev: Vals) => {
      if (prev[p + "alkmode"] === m) return prev;
      const o: Vals = { ...prev, [p + "alkmode"]: m };
      if (m === "ions") {
        const s = pmSplit(pf(prev[p + "palk"]), pf(prev[p + "malk"]));
        o[p + "hco3"] = sig(s.hco3 / 0.8202);
        o[p + "co3"] = sig(s.co3 / 1.668);
      } else {
        const h = pf(prev[p + "hco3"]), c = pf(prev[p + "co3"]);
        o[p + "malk"] = sig(h * 0.8202 + c * 1.668);
        o[p + "palk"] = sig((c * 1.668) / 2);
      }
      return o;
    });
  const applyBal = (p: string, which: string, c: Ch): void => {
    const diff = c.ani - c.cat;
    const d = ionDef(which);
    const cur = c.an.ion[which] || 0;
    const nv = Math.max(cur + (which === "na" ? diff : -diff) * d.mw, 0);
    set(p + which, sig(v[p + "unit"] === "caco3" ? nv * caF(d) : nv));
  };

  const anA = readAn("a_");
  const chA = chem(anA);
  const anB = readAn("b_");
  const chB = chem(anB);

  const anInputs = (p: string) => {
    const unitLbl = v[p + "unit"] === "caco3" ? "mg/L as CaCO₃" : "mg/L";
    const ionsMode = v[p + "alkmode"] === "ions";
    return (
      <Fragment>
        <Grid columns={4} plain>
          {sel(p + "unit", "Ion entry units", [{ value: "ion", label: "mg/L as ion" }, { value: "caco3", label: "mg/L as CaCO₃" }], (x: string) => changeUnit(p, x))}
          {sel(p + "alkmode", "Alkalinity entry", [{ value: "malk", label: "M and P alkalinity (as CaCO₃)" }, { value: "ions", label: "HCO₃ and CO₃ (mg/L as ion)" }], (x: string) => changeAlk(p, x))}
          {sel(p + "tdsmode", "TDS basis", [{ value: "calc", label: "Calculated from ions" }, { value: "meas", label: "Measured TDS" }, { value: "ec", label: "Conductivity × factor" }])}
        </Grid>
        <Section heading="Cations">
          <Grid columns={4} plain>{CATS.map((d: IonDef) => inp(p + d.k, `${d.short} (${unitLbl})`))}</Grid>
        </Section>
        <Section heading="Anions and alkalinity">
          <Grid columns={4} plain>
            {ionsMode ? inp(p + "hco3", "HCO₃ (mg/L as ion)") : inp(p + "malk", "M-alkalinity (mg/L as CaCO₃)")}
            {ionsMode ? inp(p + "co3", "CO₃ (mg/L as ion)") : inp(p + "palk", "P-alkalinity (mg/L as CaCO₃)")}
            {ANS.map((d: IonDef) => inp(p + d.k, `${d.short} (${unitLbl})`))}
          </Grid>
        </Section>
        <Section heading="Physical">
          <Grid columns={4} plain>
            {inp(p + "ph", "pH")}
            {inp(p + "t", "Temperature (°C)")}
            {inp(p + "ec", "Conductivity (µS/cm)")}
            {v[p + "tdsmode"] === "meas" ? inp(p + "tds", "Measured TDS (mg/L)") : null}
            {v[p + "tdsmode"] === "ec" ? inp(p + "eck", "TDS factor (mg/L per µS/cm)") : null}
          </Grid>
        </Section>
      </Fragment>
    );
  };
  const anTable = (c: Ch) => (
    <Table
      columns={["Ion", "mg/L as ion", "mg/L as CaCO₃", "meq/L"]}
      align={["start", "end", "end", "end"]}
      rows={[
        ...AN_IONS.map((d: IonDef) => {
          const x = c.an.ion[d.k] || 0;
          return [d.label, fmt(x, 2), fmt(x * caF(d), 1), d.z > 0 ? fmt(x / (d.mw / d.z), 3) : "–"];
        }),
        ["Bicarbonate HCO₃⁻ (from pH)", fmt(c.hco3 * 61017, 1), fmt(c.hco3 * 50040, 1), fmt(c.hco3 * 1000, 3)],
        ["Carbonate CO₃²⁻ (from pH)", fmt(c.co3 * 60009, 2), fmt(c.co3 * 100087, 1), fmt(c.co3 * 2000, 3)],
        ["Hydroxide OH⁻ (from pH)", fmt(c.oh * 17007, 3), fmt(c.oh * 50040, 2), fmt(c.oh * 1000, 4)],
        ["Free CO₂ (from pH)", fmt(c.co2 * 44010, 1), fmt(c.co2 * 50040, 1), "–"],
        ["Total cations", "", "", fmt(c.cat, 3)],
        ["Total anions (incl. M-alkalinity)", "", "", fmt(c.ani, 3)],
      ]}
    />
  );
  const tol = n("a_tol");
  const balChk = (c: Ch): Chk | null => (isFinite(c.err) ? (Math.abs(c.err) <= tol ? { text: `Pass (within ±${fmt(tol, 0)}%)`, tone: "success" } : { text: `Fail (outside ±${fmt(tol, 0)}%)`, tone: "danger" }) : null);
  const hardClass = (h: number): string => (!isFinite(h) ? "" : h < 100 ? "Soft" : h < 200 ? "Moderately hard" : h < 300 ? "Hard" : "Very hard");
  const summaryRows = (c: Ch): Row[] => [
    ["TDS calculated from ions", fmt(c.tdsCalc, 0), "mg/L", null],
    ["TDS used in calculations", fmt(c.tds, 0), "mg/L", null],
    ["TDS / conductivity ratio", fmt(c.tdsCalc / c.an.ec, 2), "mg/L per µS/cm", range(c.tdsCalc / c.an.ec, 0.55, 0.8, "Consistent (0.55–0.80)", "Low – check analysis", "High – check analysis")],
    ["Total hardness", fmt(c.hard, 0), "mg/L as CaCO₃", { text: hardClass(c.hard) }],
    ["Ion balance error", fmt(c.err, 2), "%", balChk(c)],
    ["Ionic strength", fmt(c.I, 4), "mol/L", null],
    ["Free CO₂", fmt(c.co2 * 44010, 1), "mg/L", null],
    ["LSI (simple) / calcite SI (activity)", `${fmt(c.lsi, 2)} / ${fmt(c.siCal, 2)}`, "–", lsiChk(c.siCal)],
  ];

  // ---------- Carbonate / acid / degassing ----------
  const acid = ACIDS[v.cb_acid] ?? ACIDS.h2so4;
  const acidEq = n("cb_dose") / acid.ew / 1000;
  const afterAcidBase: An = {
    ...anA,
    malk: anA.malk - acidEq * 50040,
    ion: { ...anA.ion, so4: (anA.ion.so4 || 0) + (v.cb_acid === "h2so4" ? n("cb_dose") * (96.06 / 98.08) : 0), cl: (anA.ion.cl || 0) + (v.cb_acid === "hcl" ? n("cb_dose") * (35.453 / 36.46) : 0) },
  };
  const afterAcid: An = { ...afterAcidBase, ph: phSolve(afterAcidBase, "ct", chA.ct) };
  const chAcid = chem(afterAcid);
  const co2AcidMg = (chA.ct - Math.max(afterAcid.malk, 0) / 50040) * 44010;
  const co2Res = n("cb_co2") / 44010;
  const phAcidDegas = phSolve(afterAcid, "co2", Math.min(co2Res, Math.max(co2AcidMg / 44010, 0)));
  const phDegas = phSolve(anA, "co2", Math.min(co2Res, chA.co2));
  const co2Air = Math.pow(10, lgKH(anA.t + 273.15)) * 4.2e-4;
  const phAir = phSolve(anA, "co2", co2Air);
  const alkT = alkAtPh(chA, n("cb_pht"));
  const acidNeedEq = anA.malk / 50040 - alkT;
  const acidNeedMg = acidNeedEq * 1000 * acid.ew;
  const split = pmSplit(anA.palk, anA.malk);

  // ---------- Fe / Mn ----------
  const fmFe = v.fm_src === "shared" ? anA.ion.fe || 0 : n("fm_fe");
  const fmMn = v.fm_src === "shared" ? anA.ion.mn || 0 : n("fm_mn");

  // ---------- Chlorine ----------
  const clPh = v.cl_src === "shared" ? anA.ph : n("cl_ph");
  const clT = v.cl_src === "shared" ? anA.t : n("cl_t");
  const clN = v.cl_src === "shared" ? (anA.ion.nh4 || 0) * (14.007 / 18.039) : n("cl_nh3");
  const pKa = pKaHOCl(clT + 273.15);
  const hoclFrac = 1 / (1 + Math.pow(10, clPh - pKa));
  const bpDose = 7.6 * clN + n("cl_dem") + n("cl_res");
  const clLh = (bpDose * n("cl_q")) / n("cl_str");
  const clPts = [5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5];
  const hFrac = (ph: number): number => 1 / (1 + Math.pow(10, ph - pKa));
  const clFree = n("cl_free");
  const clPh2 = n("cl_ph2");
  const clRatio = n("cl_ratio");
  const fH1 = hFrac(clPh), fH2 = hFrac(clPh2);
  const eff1 = clFree * (fH1 + (1 - fH1) / clRatio);
  const eff2 = clFree * (fH2 + (1 - fH2) / clRatio);
  const clEquiv = (clFree * fH1) / fH2;
  const clAnn = [{ ph: clPh, label: "Current" }, { ph: clPh2, label: "Target" }]
    .map((o: { ph: number; label: string }) => ({ at: Math.round((o.ph - 5.5) / 0.5), label: `${o.label} pH ${fmt(o.ph, 1)}` }))
    .filter((o: { at: number; label: string }) => isFinite(o.at) && o.at >= 0 && o.at <= 8);

  // ---------- Ion exchange ----------
  const rp = RESIN[v.ix_type] ?? RESIN.sac_na;
  const rg = REGEN[v.ix_regen] ?? REGEN.nacl;
  const meqA = (k: string): number => (anA.ion[k] || 0) / (ionDef(k).mw / ionDef(k).z);
  // water used for the ion exchange loads: shared analysis, or a local ion-by-ion override
  const ixIonShared = v.ix_isrc !== "local";
  const ixAn: An = ixIonShared ? anA : { ...readAn("ix_i_"), tdsMode: "calc" };
  const ixCh: Ch = ixIonShared ? chA : chem(ixAn);
  const meqI = (k: string): number => (ixAn.ion[k] || 0) / (ionDef(k).mw / ionDef(k).z);
  const co2ToAnion = v.ix_degas === "yes" ? n("ix_co2") : ixCh.ct * 44010;
  const ixFma = meqI("cl") + meqI("so4") + meqI("no3") + meqI("f"); // meq/L
  const ixLoads: Record<string, number> = {
    sac_na: ixCh.hard,
    sac_h: ixCh.cat * 50.04,
    wac: Math.min(ixCh.hard, ixAn.malk),
    sba1: (ixFma + meqI("po4")) * 50.04 + co2ToAnion * 1.137 + (ixAn.ion.sio2 || 0) * 0.833,
    wba: ixFma * 50.04,
    mb: ixCh.cat * 50.04,
  };
  ixLoads.sba2 = ixLoads.sba1;
  const ixShared = v.ix_src === "shared";
  const ixLoad = ixShared ? ixLoads[v.ix_type] ?? NaN : n("ix_load");
  const ixV = n("ix_vol"), ixCap = n("ix_cap"), ixQ = n("ix_flow"), ixD = n("ix_dia");
  const loadEq = ixLoad / 50.04; // eq/m³ = meq/L (CaCO₃ equivalent weight 50.04)
  const capEff = ixCap * (1 - n("ix_margin") / 100);
  const capTot = ixV * capEff;
  const thr = capTot / loadEq;
  const runH = thr / ixQ;
  const bvh = (ixQ * 1000) / ixV;
  const ixArea = (Math.PI * ixD * ixD) / 4;
  const vel = ixQ / ixArea;
  const depth = ixV / 1000 / ixArea;
  const regPure = (n("ix_dose") * ixV) / 1000;
  const regProdKg = regPure / (n("ix_str") / 100);
  const regProdL = regProdKg / n("ix_sg");
  const ratio = n("ix_dose") / rg.ew / ixCap;
  const eff = 100 / ratio;
  const rinseM3 = (n("ix_rinse") * ixV) / 1000;
  const selfUse = (rinseM3 / thr) * 100;
  const annual = ixQ * n("ix_hours") * n("ix_days");
  const regensYr = annual / thr;
  const vReq = (n("ix_target") * loadEq) / capEff;
  const dReq = Math.sqrt((4 * ixQ) / (Math.PI * n("ix_vdes")));
  const depthReq = vReq / 1000 / ((Math.PI * dReq * dReq) / 4);
  const bvhChk = (x: number) => range(x, 5, 40, "Within typical 5–40 BV/h", "Low – risk of channelling", "High – above typical 40 BV/h", "warning", "danger");
  const velChk = (x: number) => range(x, 5, 40, "Within typical 5–40 m/h", "Low – poor distribution", "High – check leakage and ΔP");
  const depthChk = (x: number) => range(x, 0.75, 3, "OK (0.75–3 m)", "Shallow – below 0.75 m", "Deep – check pressure drop");

  // ---------- Ionic load (eq/L) table ----------
  type IxIon = { name: string; mg: number; ew: number; meq: number; sac: string; wac: string; sba: string; wba: string };
  const HARDK = ["ca", "mg", "sr", "ba"];
  const ixIonRows: IxIon[] = [
    ...CATS.map((d: IonDef): IxIon => {
      const mg = ixAn.ion[d.k] || 0, ew = d.mw / d.z;
      const hd = HARDK.includes(d.k);
      return { name: d.label, mg, ew, meq: mg / ew, sac: hd ? "✓ Na- and H-form" : "✓ H-form only", wac: hd ? "✓ temporary hardness" : "–", sba: "–", wba: "–" };
    }),
    ...["cl", "so4", "no3", "f", "po4"].map((k: string): IxIon => {
      const d = ionDef(k), mg = ixAn.ion[k] || 0, ew = d.mw / d.z;
      return { name: d.label, mg, ew, meq: mg / ew, sac: "–", wac: "–", sba: "✓", wba: k === "po4" ? "–" : "✓ FMA" };
    }),
    { name: "Bicarbonate HCO₃⁻ (from M-alk)", mg: ixCh.hco3 * 61017, ew: 61.02, meq: ixCh.hco3 * 1000, sac: "–", wac: "–", sba: "✓ as CO₂ after SAC", wba: "–" },
    { name: "Carbonate CO₃²⁻", mg: ixCh.co3 * 60009, ew: 30.0, meq: ixCh.co3 * 2000, sac: "–", wac: "–", sba: "✓ as CO₂ after SAC", wba: "–" },
    { name: "Hydroxide OH⁻", mg: ixCh.oh * 17007, ew: 17.01, meq: ixCh.oh * 1000, sac: "–", wac: "–", sba: "✓", wba: "–" },
    { name: "Free CO₂ (monovalent basis)", mg: ixCh.co2 * 44010, ew: 44.01, meq: ixCh.co2 * 1000, sac: "–", wac: "–", sba: "✓", wba: "–" },
    { name: "Silica SiO₂ (monovalent basis)", mg: ixAn.ion.sio2 || 0, ew: 60.08, meq: (ixAn.ion.sio2 || 0) / 60.08, sac: "–", wac: "–", sba: "✓ SBA only", wba: "–" },
  ];
  const ixHardMeq = ixCh.hard / 50.04;
  const ixAlkMeq = ixAn.malk / 50.04;
  const ixCo2NoDg = ixCh.ct * 1000; // all carbonate as CO₂ after SAC, meq/L
  const ixCo2Dg = n("ix_co2") / 44.01;
  const ixSiMeq = (ixAn.ion.sio2 || 0) / 60.08;
  const ixTotRows: [string, number, string][] = [
    ["Total cations", ixCh.cat, "SAC H-form, mixed bed"],
    ["Total anions (incl. alkalinity)", ixCh.ani, "Check against cations"],
    ["Total hardness (Ca + Mg + Sr + Ba)", ixHardMeq, "SAC Na-form softener"],
    ["Temporary hardness (lower of hardness and M-alk)", Math.min(ixHardMeq, ixAlkMeq), "WAC"],
    ["M-alkalinity", ixAlkMeq, "Becomes CO₂ after SAC"],
    ["FMA (Cl + SO₄ + NO₃ + F)", ixFma, "WBA"],
    ["CO₂ to anion, no degasser", ixCo2NoDg, "SBA"],
    [`CO₂ to anion, with degasser (${fmt(n("ix_co2"), 1)} mg/L residual)`, ixCo2Dg, "SBA"],
    ["Silica SiO₂", ixSiMeq, "SBA only"],
    [`SBA load (FMA + PO₄ + CO₂ ${v.ix_degas === "yes" ? "with" : "without"} degasser + SiO₂)`, ixLoads.sba1 / 50.04, "SBA"],
  ];
  const cvIon = IONS.find((x: { k: string; label: string; ew: number }) => x.k === v.ix_cv_ion) ?? IONS[0];
  const cvMeq = v.ix_cv_basis === "caco3" ? n("ix_cv_val") / 50.04 : n("ix_cv_val") / cvIon.ew;
  const copyIxShared = (): void => {
    const o: Vals = { ix_isrc: "local" };
    AN_IONS.forEach((d: IonDef) => { o["ix_i_" + d.k] = sig(anA.ion[d.k] || 0); });
    o.ix_i_malk = sig(anA.malk); o.ix_i_palk = sig(anA.palk); o.ix_i_ph = String(anA.ph); o.ix_i_t = String(anA.t);
    o.ix_i_unit = "ion"; o.ix_i_alkmode = "malk";
    setMany(o);
  };

  // ---------- Plant mimic: demineralisation plant ----------
  type PmRes = { id: string; type: PmType; label: string; status: string; area: number; depth: number; vol: number; cap: number; flow: number; vel: number; bvh: number; eqEx: number; thr: number; thru: number; used: number; remM3: number; remH: number; runH: number; regen: string; dose: number; kg1: number; kg2: number; ratio: number; regCost: number; wasteM3: number; hydMax: number };
  const pmLocal = v.pm_src === "local";
  const pmAn: An = pmLocal ? { ...readAn("pm_w_"), tdsMode: "calc" } : anA;
  const pmCh: Ch = pmLocal ? chem(pmAn) : chA;
  const pmMeq = (k: string): number => (pmAn.ion[k] || 0) / (ionDef(k).mw / ionDef(k).z);
  const pmSum = (a: number[]): number => a.reduce((s: number, x: number) => s + (isFinite(x) ? x : 0), 0);
  const pmQ = n("pm_q"), pmDem = n("pm_dem");
  const pmHrsYr = n("pm_hrs") * n("pm_days");
  const pmProdYr = pmDem * pmHrsYr;
  const pmS = (id: string): string => v[`pm_${id}_status`] ?? "stby";
  const pmF = (id: string, f: string): number => n(`pm_${id}_${f}`);
  const pmFma = pmMeq("cl") + pmMeq("so4") + pmMeq("no3") + pmMeq("f");
  const pmCo2In = pmCh.ct * 44010;
  const pmDgCap = n("pm_dg_cap");
  const pmDgOver = pmQ > pmDgCap;
  const pmCo2Out = v.pm_dg_fan === "off" ? pmCo2In : Math.min(pmCo2In, n("pm_dg_co2") * (pmDgOver ? Math.pow(pmQ / pmDgCap, 2) : 1));
  const pmSi = pmAn.ion.sio2 || 0;
  const pmPhIn = -Math.log10((Math.max(pmFma, 1e-6) / 1000) * (isFinite(pmCh.g1) ? pmCh.g1 : 1));
  const pmUsePred = v.pm_basis === "predicted";
  const pmMode = (k: string, dflt: FlowMode): FlowMode => (v[k] === "co" || v[k] === "counter" ? v[k] as FlowMode : dflt);
  const pmRegenT = n("pm_regen_t");
  const pmWater: PredictWater = {
    t: pmAn.t, tds: pmCh.tds, cat: pmCh.cat, ani: pmCh.ani, fma: pmFma, sio2: pmSi, co2In: pmCo2In,
    naFrac: pmCh.cat > 0 ? pmMeq("na") / pmCh.cat : 0,
    alkFrac: pmCh.ani > 0 ? (pmAn.malk / 50.04) / pmCh.ani : 0,
    caFrac: pmCh.cat > 0 ? pmMeq("ca") / pmCh.cat : 0,
    so4Frac: pmFma > 0 ? pmMeq("so4") / pmFma : 0,
  };
  const pmCo2Pred = degasPredict(pmCo2In, pmQ, pmDgCap, n("pm_dg_co2"), v.pm_dg_fan !== "off");
  const pmSbaType: "1" | "2" = v.pm_sba_type === "2" ? "2" : "1";
  type PmVp = { cap: number; naLeak: number; siLeak: number; h2so4: string | null };
  const pmVp: Record<string, PmVp> = {};
  PM_UNITS.forEach((u: PmUnit) => {
    const dose = pmF(u.id, "dose");
    const regen = u.type === "wba" || u.type === "sba" ? "naoh" : (v[`pm_${u.id}_regen`] || "hcl");
    const endpt = pmF(u.id, "endpt");
    if (u.type === "sac") {
      const r = sacPredict(pmWater, dose, regen === "h2so4" ? "h2so4" : "hcl", pmMode("pm_flow_sac", "counter"), endpt, pmF(u.id, "conc"));
      pmVp[u.id] = { cap: r.cap, naLeak: r.naLeak, siLeak: NaN, h2so4: r.h2so4 };
    } else if (u.type === "wba") {
      const r = wbaPredict(pmWater, dose, pmMode("pm_flow_wba", "co"));
      pmVp[u.id] = { cap: r.cap, naLeak: NaN, siLeak: NaN, h2so4: null };
    } else if (u.type === "sba") {
      const r = sbaPredict(pmWater, dose, pmMode("pm_flow_sba", "counter"), pmSbaType, pmRegenT, pmCo2Pred, endpt);
      pmVp[u.id] = { cap: r.cap, naLeak: NaN, siLeak: r.siLeak, h2so4: null };
    } else {
      const r = mbPredict(dose, pmF(u.id, "dose2"), pmMode("pm_flow_mb", "counter"), endpt);
      pmVp[u.id] = { cap: r.cap, naLeak: NaN, siLeak: NaN, h2so4: null };
    }
  });
  const pmMeanSvc = (type: PmType, pick: (id: string) => number): number => {
    const svc = PM_UNITS.filter((u: PmUnit) => u.type === type && pmS(u.id) === "svc");
    const use = svc.length ? svc : PM_UNITS.filter((u: PmUnit) => u.type === type);
    const xs = use.map((u: PmUnit) => pick(u.id)).filter((x: number) => isFinite(x));
    return xs.length ? xs.reduce((s: number, x: number) => s + x, 0) / xs.length : NaN;
  };
  const pmNaPred = pmMeanSvc("sac", (id: string) => pmVp[id].naLeak);
  const pmSiPred = pmMeanSvc("sba", (id: string) => pmVp[id].siLeak);
  const pmNaUsed = pmUsePred ? pmNaPred : n("pm_naleak");
  const pmSiUsed = pmUsePred ? pmSiPred : n("pm_sileak");
  const pmCo2Model = pmUsePred ? pmCo2Pred : pmCo2Out;
  const pmLoad: Record<PmType, number> = {
    sac: pmCh.cat,
    wba: pmFma,
    sba: pmCo2Model / 44.01 + pmSi / 60.08 + pmMeq("po4"),
    mb: pmNaUsed / 22.99 + pmSiUsed / 60080,
  };
  const pmChemOf = (k: string): { ew: number; perKg: number; short: string } =>
    k === "naoh" ? { ew: 40.0, perKg: n("pm_c_naoh") / 1000 / (n("pm_c_naohs") / 100), short: "NaOH" }
    : k === "h2so4" ? { ew: 49.04, perKg: n("pm_c_h2so4") / 1000 / (n("pm_c_h2so4s") / 100), short: "H₂SO₄" }
    : { ew: 36.46, perKg: n("pm_c_hcl") / 1000 / (n("pm_c_hcls") / 100), short: "HCl" };
  const pmStageQ = (t: PmType): number => (t === "mb" ? pmDem : pmQ);
  const pmNSvc = (t: PmType): number => PM_UNITS.filter((u: PmUnit) => u.type === t && pmS(u.id) === "svc").length;
  const pmTf = v.pm_tf === "yes";
  const pmRes: PmRes[] = PM_UNITS.map((u: PmUnit): PmRes => {
    const td = PM_TYPE[u.type];
    const status = pmS(u.id);
    const dia = pmF(u.id, "dia"), vol = pmF(u.id, "vol");
    const cap = pmUsePred && pmVp[u.id] && isFinite(pmVp[u.id].cap) ? pmVp[u.id].cap : pmF(u.id, "cap");
    const area = (Math.PI * dia * dia) / 4;
    const ns = pmNSvc(u.type);
    const flow = status === "svc" && ns > 0 ? pmStageQ(u.type) / ns : 0;
    const eqEx = vol * cap;
    const thr = eqEx / pmLoad[u.type];
    const thruIn = pmF(u.id, "thru"), hrsIn = pmF(u.id, "hrs");
    const thru = isFinite(thruIn) && thruIn > 0 ? thruIn : isFinite(hrsIn) && hrsIn > 0 ? hrsIn * flow : 0;
    const used = (thru / thr) * 100;
    const remM3 = Math.max(thr - thru, 0);
    const regen = u.type === "wba" || u.type === "sba" ? "naoh" : v[`pm_${u.id}_regen`] ?? td.regen;
    const c1 = pmChemOf(regen), cN = pmChemOf("naoh");
    const dose = pmF(u.id, "dose");
    const kg1 = (dose * vol) / 1000;
    const kg2 = u.type === "mb" ? (pmF(u.id, "dose2") * vol) / 1000 : 0;
    const ratio = u.type === "mb" ? NaN : (kg1 * 1000) / c1.ew / eqEx;
    const wbaTf = u.type === "wba" && pmTf;
    const regCost = wbaTf ? 0 : kg1 * c1.perKg + kg2 * cN.perKg;
    const conc = pmF(u.id, "conc") / 100;
    const wasteM3 = (pmF(u.id, "rinse") * vol) / 1000 + (wbaTf ? 0 : (kg1 + kg2) / conc / 1000);
    const hydMax = Math.min(area * td.vMax, (vol * td.bvMax) / 1000);
    return {
      id: u.id, type: u.type, label: u.label, status, area, depth: vol / 1000 / area, vol, cap, flow, vel: flow / area, bvh: (flow * 1000) / vol,
      eqEx, thr, thru, used, remM3, remH: flow > 0 ? remM3 / flow : NaN, runH: flow > 0 ? thr / flow : NaN,
      regen, dose, kg1, kg2, ratio, regCost, wasteM3, hydMax,
    };
  });
  const pmRT: Record<PmType, number> = { sac: n("pm_rt_sac"), wba: n("pm_rt_an"), sba: n("pm_rt_an"), mb: n("pm_rt_mb") };
  const PM_SNAME: Record<PmType, string> = { sac: "SAC", wba: "WBA", sba: "SBA", mb: "Mixed beds" };
  type PmStage = { t: PmType; rs: PmRes[]; av: PmRes[]; nAvail: number; nSvc: number; need: number; capAll: number; capN1: number; meanEq: number; volYr: number; regYr: number; chemYr: number; wasteYr: number; kgYr: Record<string, number>; runN1: number; okN1: boolean; minRunH: number; doseMean: number; rinseMean: number; ratioMean: number; volMean: number };
  const pmStage = (t: PmType, volYr: number, regOv?: number): PmStage => {
    const rs = pmRes.filter((r: PmRes) => r.type === t);
    const av = rs.filter((r: PmRes) => r.status !== "oos");
    const svc = rs.filter((r: PmRes) => r.status === "svc");
    const nA = Math.max(av.length, 1);
    const mean = (f: (r: PmRes) => number): number => pmSum(av.map(f)) / nA;
    const capAll = pmSum(av.map((r: PmRes) => r.hydMax));
    const capN1 = capAll - Math.max(0, ...av.map((r: PmRes) => r.hydMax));
    const need = pmStageQ(t);
    const meanEq = mean((r: PmRes) => r.eqEx);
    const regYr = regOv ?? (volYr * pmLoad[t]) / meanEq;
    const kgYr: Record<string, number> = {};
    av.forEach((r: PmRes) => {
      const share = regYr / nA;
      if (!(r.type === "wba" && pmTf)) kgYr[r.regen] = (kgYr[r.regen] || 0) + r.kg1 * share;
      if (r.kg2 > 0) kgYr.naoh = (kgYr.naoh || 0) + r.kg2 * share;
    });
    const runN1 = av.length > 1 ? meanEq / pmLoad[t] / (need / (av.length - 1)) : NaN;
    const runs = svc.map((r: PmRes) => r.runH).filter((x: number) => isFinite(x));
    return {
      t, rs, av, nAvail: av.length, nSvc: svc.length, need, capAll, capN1, meanEq, volYr, regYr,
      chemYr: regYr * mean((r: PmRes) => r.regCost), wasteYr: regYr * mean((r: PmRes) => r.wasteM3), kgYr,
      runN1, okN1: av.length > 1 && capN1 >= need && runN1 > pmRT[t], minRunH: runs.length ? Math.min(...runs) : NaN,
      doseMean: mean((r: PmRes) => r.dose), rinseMean: mean((r: PmRes) => pmF(r.id, "rinse")), ratioMean: mean((r: PmRes) => r.ratio), volMean: mean((r: PmRes) => r.vol),
    };
  };
  const pmMb = pmStage("mb", pmProdYr);
  const pmPrim0 = pmProdYr + pmMb.wasteYr;
  const pmPrimYr = pmPrim0 + pmStage("wba", pmPrim0).wasteYr + pmStage("sba", pmPrim0).wasteYr;
  const pmSac = pmStage("sac", pmPrimYr);
  const pmWbaOwn = pmStage("wba", pmPrimYr).regYr, pmSbaOwn = pmStage("sba", pmPrimYr).regYr;
  const pmPairReg = v.pm_pair === "yes" ? Math.max(pmWbaOwn, pmSbaOwn) : undefined;
  const pmWba = pmStage("wba", pmPrimYr, pmPairReg), pmSba = pmStage("sba", pmPrimYr, pmPairReg);
  const pmStages: PmStage[] = [pmSac, pmWba, pmSba, pmMb];
  // pumps, power, totals
  const pmPn = Math.max(Math.round(n("pm_p_n")) || 0, 0), pmPd = Math.max(Math.round(n("pm_p_duty")) || 0, 0);
  const pmPq = pmPd > 0 ? pmDem / pmPd : NaN;
  const pmPhyd = pmPd > 0 ? (pmPq * n("pm_p_h")) / 367 : NaN;
  const pmPshaft = pmPhyd / (n("pm_p_eff") / 100);
  const pmPkw = pmPd > 0 ? (pmPshaft / (n("pm_p_meff") / 100)) * pmPd : 0;
  const pmPload = (pmPshaft / n("pm_p_kw")) * 100;
  const pmPkwh = pmPkw * n("pm_p_hrs");
  const pmPrimHrs = pmPrimYr / pmQ;
  const pmFanKwh = v.pm_dg_fan === "off" ? 0 : n("pm_dg_kw") * pmPrimHrs;
  const pmPowYr = (pmPkwh + pmFanKwh) * n("pm_c_kwh");
  const pmChemYr = pmSum(pmStages.map((s: PmStage) => s.chemYr));
  const pmWaterP = n("pm_c_water") + n("pm_c_eff");
  const pmWasteYr = pmSum(pmStages.map((s: PmStage) => s.wasteYr));
  const pmWaterYr = pmWasteYr * pmWaterP;
  const pmResinYr = pmSum(pmRes.map((r: PmRes) => (r.vol * n(`pm_rc_${r.type}`)) / n(`pm_rl_${r.type}`)));
  const pmTotYr = pmChemYr + pmWaterYr + pmPowYr + pmResinYr;
  const pmCostM3 = pmTotYr / pmProdYr;
  const pmKgYr: Record<string, number> = {};
  pmStages.forEach((s: PmStage) => Object.keys(s.kgYr).forEach((k: string) => { pmKgYr[k] = (pmKgYr[k] || 0) + s.kgYr[k]; }));
  const pmStr = (k: string): number => n(k === "naoh" ? "pm_c_naohs" : k === "h2so4" ? "pm_c_h2so4s" : "pm_c_hcls") / 100;
  const pmTkVol = n("pm_tk_vol");
  const pmTkHrs = (pmTkVol * (n("pm_tk_lvl") - n("pm_tk_lo"))) / 100 / pmDem;
  const pmTkUse = (pmTkVol * (n("pm_tk_hi") - n("pm_tk_lo"))) / 100 / pmDem;
  const pmQneed = pmPrimYr / pmHrsYr;
  const pmRtMax = Math.max(pmRT.sac, pmRT.wba, pmRT.mb);
  const pmN1 = pmStages.every((s: PmStage) => s.okN1) && pmPn > pmPd;
  const pmUnitCost = (s: PmStage): number => (s.regYr > 0 ? (s.chemYr + s.wasteYr * pmWaterP) / s.regYr : 0);

  // diagnostics
  type PmDiag = { tone: Tone; text: string; save: number };
  const pmDiag: PmDiag[] = [];
  const pmAdd = (tone: Tone, text: string, save: number = 0): void => { pmDiag.push({ tone, text, save: isFinite(save) ? Math.max(save, 0) : 0 }); };
  type PmHyd = { name: string; cap: number; need: number };
  const pmHyd: PmHyd[] = [
    { name: "SAC", cap: pmSac.capAll, need: pmQ }, { name: "Degasser", cap: pmDgCap, need: pmQ },
    { name: "WBA", cap: pmWba.capAll, need: pmQ }, { name: "SBA", cap: pmSba.capAll, need: pmQ },
    { name: "Transfer pumps (duty)", cap: pmPd * n("pm_p_q"), need: pmDem }, { name: "Mixed beds", cap: pmMb.capAll, need: pmDem },
  ];
  const pmBn = pmHyd.reduce((a: PmHyd, b: PmHyd) => (b.cap / b.need < a.cap / a.need ? b : a));
  pmAdd(pmBn.cap < pmBn.need ? "danger" : pmBn.cap < 1.2 * pmBn.need ? "warning" : "success",
    `Hydraulic bottleneck: ${pmBn.name}, ${fmt(pmBn.cap, 0)} m³/h maximum with all available units against ${fmt(pmBn.need, 0)} m³/h required (${fmt((pmBn.cap / pmBn.need) * 100, 0)}%).`);
  const pmShort = pmStages.filter((s: PmStage) => isFinite(s.minRunH)).reduce((a: PmStage | null, b: PmStage) => (!a || b.minRunH / pmRT[b.t] < a.minRunH / pmRT[a.t] ? b : a), null as PmStage | null);
  if (pmShort) pmAdd(pmShort.minRunH < 3 * pmRT[pmShort.t] ? "warning" : "success", `Capacity bottleneck: ${PM_SNAME[pmShort.t]} has the shortest run relative to its regeneration time, ${fmt(pmShort.minRunH, 1)} h per cycle at the current flow split against ${fmt(pmRT[pmShort.t], 1)} h to regenerate.`);
  if (pmQ < pmQneed) pmAdd("danger", `Feed flow ${fmt(pmQ, 0)} m³/h is below the average ${fmt(pmQneed, 1)} m³/h needed for demand plus regeneration water.`);
  else pmAdd("success", `The primary plant must run about ${fmt((pmQneed / pmQ) * 100, 0)}% of the time at ${fmt(pmQ, 0)} m³/h to meet demand plus regeneration water (self-use ${fmt(((pmPrimYr - pmProdYr) / pmPrimYr) * 100, 1)}%).`);
  pmStages.forEach((s: PmStage) => {
    if (!s.okN1) pmAdd("danger", `${PM_SNAME[s.t]}: N−1 not met. With one unit regenerating, ${s.nAvail - 1} available unit(s) give ${fmt(s.capN1, 0)} m³/h hydraulic (need ${fmt(s.need, 0)}) and run ${fmt(s.runN1, 1)} h per cycle against ${fmt(pmRT[s.t], 1)} h to regenerate.`);
  });
  pmAdd(pmTkUse < 8 ? "warning" : "success", `Degasser is a single unit with no standby; tank storage between setpoints covers ${fmt(pmTkUse, 1)} h at demand if it trips.`);
  if (pmPn <= pmPd) pmAdd("danger", "No standby transfer pump: one pump failure stops product supply.");
  pmRes.forEach((r: PmRes) => {
    const td = PM_TYPE[r.type];
    if (r.status === "svc") {
      if (r.vel > td.vMax || r.bvh > td.bvMax) pmAdd("warning", `${r.label}: ${fmt(r.vel, 1)} m/h and ${fmt(r.bvh, 1)} BV/h, above typical maximum (${td.vMax} m/h, ${td.bvMax} BV/h): more leakage and pressure drop.`);
      else if (r.vel < 5 || r.bvh < 5) pmAdd("warning", `${r.label}: ${fmt(r.vel, 1)} m/h and ${fmt(r.bvh, 1)} BV/h, below about 5: risk of channelling and early leakage.`);
    }
    if (r.status !== "regen" && r.status !== "oos" && r.used >= 100) pmAdd("danger", `${r.label} is ${r.status === "svc" ? "in service" : "on standby"} past its calculated capacity (${fmt(r.used, 0)}% used). Check the endpoint instrument and regenerate.`);
  });
  pmStages.forEach((s: PmStage) => {
    if (s.t === "wba" && pmTf) return;
    const rg = s.av[0]?.regen ?? "hcl";
    const hi = pmDoseHi(s.t, rg);
    if (s.doseMean > hi) pmAdd("warning", `${PM_SNAME[s.t]} regen level ${fmt(s.doseMean, 0)} g/L is above the typical ${fmt(hi, 0)} g/L: likely over-regenerating. Trial a step reduction while watching leakage and run length.`, (s.chemYr * (s.doseMean - hi)) / s.doseMean);
    if (s.t !== "mb" && s.ratioMean > PM_TYPE[s.t].ratioMax) pmAdd("warning", `${PM_SNAME[s.t]}: regenerant is ${fmt(s.ratioMean, 2)}× stoichiometric (${fmt(100 / s.ratioMean, 0)}% efficiency), poorer than the typical ≤ ${PM_TYPE[s.t].ratioMax}×. Check the operating capacity, regen level, injection strength and contact time.`);
    const typ = PM_TYPE[s.t].rinseTyp;
    if (s.rinseMean > 1.25 * typ) pmAdd("warning", `${PM_SNAME[s.t]} backwash + rinse ${fmt(s.rinseMean, 1)} BV is high (typical about ${typ} BV). Check the rinse endpoint or recycle rinse water.`, ((s.regYr * s.volMean * (s.rinseMean - typ)) / 1000) * pmWaterP);
  });
  const pmCo2Extra = Math.max(pmCo2Model - 5, 0) / 44.01;
  const pmCo2Cost = pmSba.meanEq > 0 ? ((pmPrimYr * pmCo2Extra) / pmSba.meanEq) * pmUnitCost(pmSba) : 0;
  if (v.pm_dg_fan === "off") pmAdd("danger", `Degasser fan off: all ${fmt(pmCo2In, 0)} mg/L CO₂ goes to the SBA units.`, pmCo2Cost);
  else if (pmCo2Model > 5) pmAdd("warning", `Degasser outlet CO₂ ${fmt(pmCo2Model, 1)} mg/L is above about 5 mg/L${pmDgOver ? ` (hydraulically overloaded at ${fmt((pmQ / pmDgCap) * 100, 0)}% of capacity)` : ""}: extra SBA load.`, pmCo2Cost);
  const pmPhM = n("pm_dg_ph");
  if (isFinite(pmPhM) && pmPhM > pmPhIn + 0.5) pmAdd("warning", `Degasser inlet pH ${fmt(pmPhM, 2)} is above the ${fmt(pmPhIn, 2)} expected from the FMA: a SAC unit may be leaking or exhausted.`);
  const pmWT = pmWba.meanEq / pmLoad.wba, pmST = pmSba.meanEq / pmLoad.sba;
  if (isFinite(pmWT) && isFinite(pmST)) {
    const lim = pmST < pmWT ? "SBA" : "WBA";
    const frac = 1 - Math.min(pmWT, pmST) / Math.max(pmWT, pmST);
    const pairCost = (pmWba.regYr - pmWbaOwn) * pmUnitCost(pmWba) + (pmSba.regYr - pmSbaOwn) * pmUnitCost(pmSba);
    if (frac > 0.2) pmAdd("warning", `${lim} exhausts first: WBA ${fmt(pmWT, 0)} m³ against SBA ${fmt(pmST, 0)} m³ per cycle, so ${fmt(frac * 100, 0)}% of the other resin's capacity is unused when they are regenerated as a pair.${lim === "SBA" ? " SBA running out first lets silica through; check SBA capacity and resin age, and CO₂ from the degasser." : " Consider more WBA resin or regenerating the WBA on its own endpoint."}`, v.pm_pair === "yes" ? pairCost : 0);
  }
  if (pmTf) {
    const sbaEx = (pmSum(pmSba.av.map((r: PmRes) => (r.kg1 * 1000) / 40 - r.eqEx)) / Math.max(pmSba.nAvail, 1)) * pmSba.regYr;
    const wbaReq = pmWba.meanEq * 1.2 * pmWba.regYr;
    if (sbaEx < wbaReq) pmAdd("warning", `Thoroughfare caustic: SBA excess NaOH is about ${fmt(sbaEx / 1000, 0)} keq/yr against about ${fmt(wbaReq / 1000, 0)} keq/yr needed by the WBA (120% of its capacity), so the WBA may be under-regenerated.`);
  }
  const pmMbNew = 0.5 / 22.99 + pmSiUsed / 60080;
  const pmMbSave = pmNaUsed > 0.5 ? (pmMb.chemYr + pmMb.wasteYr * pmWaterP) * (1 - pmMbNew / pmLoad.mb) : 0;
  if (isFinite(pmMb.minRunH) && pmMb.minRunH < 168) pmAdd("warning", `Mixed beds run only ${fmt(pmMb.minRunH, 0)} h (${fmt(pmMb.minRunH / 24, 1)} days) per cycle: upstream leakage is high.`);
  if (pmMbSave > 0) pmAdd("warning", `SAC sodium leakage ${fmt(pmNaUsed, 2)} mg/L loads the mixed beds. Bringing it to 0.5 mg/L (for example counter-flow regeneration, acid quality and level, or SAC endpoint) cuts MB regenerations by ${fmt((1 - pmMbNew / pmLoad.mb) * 100, 0)}%.`, pmMbSave);
  if (pmSiUsed > 200) pmAdd("warning", `SBA silica leakage ${fmt(pmSiUsed, 0)} µg/L is high for mixed-bed feed; the ${fmt(n("pm_mb_si"), 0)} µg/L product target is at risk.`);
  const pmPeffSave = n("pm_p_eff") < 75 ? pmPkwh * (1 - n("pm_p_eff") / 75) * n("pm_c_kwh") : 0;
  if (pmPeffSave > 0) pmAdd("warning", `Transfer pump efficiency ${fmt(n("pm_p_eff"), 0)}%: a pump at about 75% would cut pumping energy by ${fmt((1 - n("pm_p_eff") / 75) * 100, 0)}%.`, pmPeffSave);
  if (pmPd > 0 && (n("pm_p_q") > 1.3 * pmPq || pmPload < 60)) pmAdd("warning", `Transfer pumps look oversized: ${fmt(pmPq, 0)} m³/h per duty pump against ${fmt(n("pm_p_q"), 0)} m³/h rated, motor ${fmt(pmPload, 0)}% loaded. A VSD or impeller trim typically saves 10–20% (15% used here).`, 0.15 * pmPkwh * n("pm_c_kwh"));
  pmStages.forEach((s: PmStage) => {
    const rem = s.rs.filter((r: PmRes) => r.status === "svc" && isFinite(r.remH) && r.remH > 0).map((r: PmRes) => r.remH).sort((a: number, b: number) => a - b);
    for (let i = 1; i < rem.length; i++) {
      if (rem[i] - rem[i - 1] < pmRT[s.t]) { pmAdd("warning", `${PM_SNAME[s.t]}: two in-service units exhaust within ${fmt(rem[i] - rem[i - 1], 1)} h of each other (regeneration takes ${fmt(pmRT[s.t], 1)} h). Stagger the runs.`); break; }
    }
  });
  if (n("pm_tk_lvl") <= n("pm_tk_lo")) pmAdd("danger", `Tank at ${fmt(n("pm_tk_lvl"), 0)}%, at or below the low setpoint.`);
  if (pmTkUse < pmRtMax) pmAdd("warning", `Tank storage between setpoints covers ${fmt(pmTkUse, 1)} h at demand, less than the longest regeneration (${fmt(pmRtMax, 1)} h).`);
  const pmRank: Record<Tone, number> = { danger: 0, warning: 1, success: 2 };
  const pmDiagSorted = [...pmDiag].sort((a: PmDiag, b: PmDiag) => b.save - a.save || pmRank[a.tone] - pmRank[b.tone]);
  const pmSaveTot = pmSum(pmDiag.map((d: PmDiag) => d.save));
  const pmApplyAll = (id: string): void => {
    const u = PM_UNITS.find((x: PmUnit) => x.id === id);
    if (!u) return;
    const o: Vals = {};
    PM_UNITS.filter((x: PmUnit) => x.type === u.type && x.id !== id).forEach((x: PmUnit) => {
      PM_FIELDS.forEach((f: string) => { o[`pm_${x.id}_${f}`] = v[`pm_${id}_${f}`] ?? ""; });
    });
    setMany(o);
  };
  const copyPmShared = (): void => {
    const o: Vals = { pm_src: "local" };
    AN_IONS.forEach((d: IonDef) => { o["pm_w_" + d.k] = sig(anA.ion[d.k] || 0); });
    o.pm_w_malk = sig(anA.malk); o.pm_w_palk = sig(anA.palk); o.pm_w_ph = String(anA.ph); o.pm_w_t = String(anA.t);
    o.pm_w_unit = "ion"; o.pm_w_alkmode = "malk";
    setMany(o);
  };

  // ---------- RO ----------
  const roShared = v.ro_src === "shared";
  const K = n("ro_k"), piC = n("ro_pi");
  const tcf = (t: number): number => Math.exp(K * (1 / 298 - 1 / (273 + t)));
  const osm = (c: number, t: number): number => (piC * c * (t + 273)) / 298;
  const roCalc = (qf: number, qp: number, cf: number, cp: number, pfd: number, pc: number, pp: number, t: number) => {
    const qc = qf - qp;
    const R = qp / qf;
    const cc = (qf * cf - qp * cp) / qc;
    const cfc = (cf * Math.log(1 / (1 - R))) / R;
    const ndp = pfd - (pfd - pc) / 2 - pp - (osm(cfc, t) - osm(cp, t));
    return { qc, R, cc, cfc, ndp, sp: (cp / cf) * 100, dp: pfd - pc, tcf: tcf(t) };
  };
  const roT = n("ro_t");
  const roFeed: An = roShared
    ? { ...anA, t: roT }
    : mkAn({ caC: n("ro_ca"), malk: n("ro_alk"), ph: n("ro_ph"), t: roT, tds: n("ro_cf"), sio2: n("ro_sio2") });
  const roFeedCh = chem(roFeed);
  const roCf = roShared ? roFeedCh.tds : n("ro_cf");
  const ra = roCalc(n("ro_qf"), n("ro_qp"), roCf, n("ro_cp"), n("ro_pf"), n("ro_pc"), n("ro_pp"), roT);
  const rb = roCalc(n("ro_bqf"), n("ro_bqp"), n("ro_bcf"), n("ro_bcp"), n("ro_bpf"), n("ro_bpc"), n("ro_bpp"), n("ro_bt"));
  const npf = n("ro_qp") * (rb.ndp / ra.ndp) * (rb.tcf / ra.tcf);
  const npfChg = (npf / n("ro_bqp") - 1) * 100;
  const nsp = ra.sp * (ra.ndp / rb.ndp) * ((rb.cfc / n("ro_bcf")) / (ra.cfc / roCf));
  const nspChg = (nsp / rb.sp - 1) * 100;
  const dpNorm = ra.dp * Math.pow((n("ro_bqf") + rb.qc) / (n("ro_qf") + ra.qc), 1.5);
  const dpChg = (dpNorm / rb.dp - 1) * 100;
  const flux = (n("ro_qp") * 1000) / (n("ro_n") * n("ro_area"));
  const rtype = RO_TYPES[v.ro_type] ?? RO_TYPES.well;
  const nReq = (n("ro_qp") * 1000) / (n("ro_jt") * n("ro_area"));
  const vesReq = Math.ceil(Math.ceil(nReq) / n("ro_epv"));
  const dpStage = ra.dp / n("ro_stages");
  const rej = 100 - ra.sp;
  const rejF = isFinite(rej) && rej > 0 && rej <= 100 ? rej / 100 : 0.99;
  const roConc = concRO(roFeed, roFeedCh, ra.R, rejF);
  const roConcCh = chem(roConc);
  let rMaxLsi = NaN, rMaxSil = NaN;
  for (let r = 0.3; r <= 0.955; r += 0.01) {
    const c = chem(concRO(roFeed, roFeedCh, r, rejF));
    if (c.lsi <= n("ro_lsimax")) rMaxLsi = r;
    if (c.silPct <= 100) rMaxSil = r;
  }

  // ---------- Indices ----------
  const siAn: An = v.si_src === "shared"
    ? anA
    : mkAn({ caC: n("si_ca"), malk: n("si_alk"), ph: n("si_ph"), t: n("si_t"), tds: v.si_mode === "ec" ? n("si_ec") * n("si_k") : n("si_tds"), cl: n("si_cl"), so4: n("si_so4") });
  const siCh = chem(siAn);
  const aiChk: Chk | null = !isFinite(siCh.ai) ? null : siCh.ai < 10 ? { text: "Very aggressive", tone: "danger" } : siCh.ai < 12 ? { text: "Moderately aggressive", tone: "warning" } : { text: "Non-aggressive", tone: "success" };
  const lsChk: Chk | null = !isFinite(siCh.ls) ? null : siCh.ls < 0.8 ? { text: "Low – Cl/SO₄ unlikely to interfere", tone: "success" } : siCh.ls <= 1.2 ? { text: "Moderate – may interfere with films", tone: "warning" } : { text: "High – localised corrosion likely", tone: "danger" };
  const sweep = [5, 15, 25, 35, 50, 65, 80];

  // ---------- Cooling towers ----------
  const circ = n("ct_circ");
  const evap = n("ct_k") * n("ct_dt") * circ;
  const drift = (n("ct_drift") / 100) * circ;
  const coc = v.ct_mode === "cond" ? n("ct_ect") / n("ct_ecm") : n("ct_coc");
  const bdTot = coc > 1 ? evap / (coc - 1) : NaN;
  const bleed = bdTot - drift;
  const mu = evap + bdTot;
  const hti = (0.693 * n("ct_vol")) / bdTot;
  const t90 = (2.303 * n("ct_vol")) / bdTot;
  const inhKg = (n("ct_inh") * bdTot * 24) / 1000;
  const bioKg = (n("ct_bio") * n("ct_vol")) / 1000;
  const tcoc = n("ct_tcoc");
  const muT = tcoc > 1 ? (evap * tcoc) / (tcoc - 1) : NaN;
  const saveM3 = (mu - muT) * n("ct_hours");
  const cocPts = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  const cocMu = cocPts.map((c: number) => (evap * c) / (c - 1));
  const cocBd = cocPts.map((c: number) => evap / (c - 1));
  const cocIdx = Math.round(coc - 2);
  const ctMu: An = v.ct_src === "shared"
    ? anA
    : mkAn({ caC: n("ct_ca"), malk: n("ct_alk"), ph: n("ct_ph0"), t: n("ct_tw"), tds: n("ct_tds"), cl: n("ct_cl"), so4: n("ct_so4"), sio2: n("ct_sio2") });
  const ctTw = concCycles(ctMu, coc, n("ct_tw"), v.ct_phmode, n("ct_phv"));
  const ctCh = chem(ctTw);
  const ctSkin = chem({ ...ctTw, t: n("ct_skin") });
  const ctMaxSil = ctCh.silSol / (ctMu.ion.sio2 || NaN);

  // ---------- Boilers ----------
  const boShared = v.bo_src === "shared";
  const softAdd = ["ca", "mg", "sr", "ba"].reduce((s: number, k: string) => s + meqA(k) * (22.99 - ionDef(k).mw / ionDef(k).z), 0);
  const boMuTds = boShared ? chA.tds + (v.bo_soft === "yes" ? softAdd : 0) : n("bo_mutds");
  const boMuAlk = boShared ? anA.malk : n("bo_alk");
  const steam = n("bo_steam");
  const cr = n("bo_cr") / 100;
  const tdsF = boMuTds * (1 - cr) + n("bo_ctds") * cr;
  const tdsB = n("bo_max");
  const boCoc = tdsB / tdsF;
  const bdKg = (steam * tdsF) / (tdsB - tdsF);
  const feedKg = steam + bdKg;
  const bdPctFeed = (tdsF / tdsB) * 100;
  const muM3 = (feedKg * (1 - cr)) / 1000;
  const pAbs = n("bo_p") + 1.013;
  const hfB = interp(STEAM, pAbs, 2);
  const tSat = interp(STEAM, pAbs, 1);
  const hfFeed = 4.19 * n("bo_tf");
  const qBd = (bdKg * (hfB - hfFeed)) / 3600;
  const pFl = n("bo_pfl") + 1.013;
  const flashFrac = (hfB - interp(STEAM, pFl, 2)) / interp(STEAM, pFl, 3);
  const flashKg = bdKg * flashFrac;
  const flashKw = (flashKg * interp(STEAM, pFl, 3)) / 3600;
  const bdCost = ((qBd * n("bo_hours")) / (n("bo_eff") / 100)) * n("bo_fuel");
  const sc = SCAV[v.bo_scav] ?? SCAV.sulphite;
  const maint = sc.volatile ? n("bo_res") : (n("bo_res") * sc.resFactor) / boCoc;
  const scDose = sc.ratio * n("bo_o2") + maint;
  const scKgD = (scDose * feedKg * 24) / 1e6;
  const scProdKg = scKgD / (n("bo_str") / 100);
  const o2Sat = interp(O2SAT, n("bo_tf"), 1);
  const crRows = [0, 20, 40, 60, 80, 90];
  const co2Steam = 0.79 * boMuAlk * (1 - cr);

  // ---------- Boiler steam silica (Styrikovich) ----------
  const siU = v.bo_sipu;
  const siPA = siU === "boiler" ? n("bo_p") + 1.013 : siU === "bara" ? n("bo_sip") : siU === "psig" ? n("bo_sip") * 0.0689476 + 1.013 : n("bo_sip") + 1.013;
  const siN = n("bo_sin");
  const siPSrc = siU === "boiler"
    ? `using ${v.bo_p ?? ""} bar g from "Boiler pressure" in Boilers: inputs`
    : `using ${v.bo_sip ?? ""} ${siU === "bara" ? "bar a" : siU === "psig" ? "psig" : "bar g"} from the drum pressure entered above`;
  const siPh = n("bo_siph");
  const siPhF = isFinite(siPh) ? 1 / (1 + Math.pow(10, siPh - 12)) : 1;
  const siMc = (isFinite(n("bo_simc")) ? n("bo_simc") : 0) / 100;
  const siLimU = n("bo_silimu"); // steam silica limit, µg/L
  const siLim = siLimU / 1000; // mg/L, used internally (boiler water silica is mg/L)
  const siRl = interp(SATRHO, siPA, 1);
  const siRv = interp(SATRHO, siPA, 2);
  const siKd0 = kdSi(siPA, siN);
  const siKd = siKd0 * siPhF;
  const siBw = n("bo_sibwu") / 1000; // boiler water silica: input µg/L, internal mg/L
  const siVap = siBw * siKd;
  const siMech = siBw * siMc;
  const siSteam = siVap + siMech;
  const siMaxBw = siLim / (siKd + siMc);
  const siFeed = v.bo_sisrc === "shared" ? (anA.ion.sio2 || 0) * (1 - cr) : n("bo_sifwu") / 1000; // internal mg/L (shared analysis is mg/L; local input µg/L)
  const siMaxCoc = siMaxBw / siFeed;
  const siBwAtCoc = siFeed * boCoc;
  const siChartP = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
  const siAltU = siLimU === 10 ? 20 : 10; // comparison limit, µg/L
  const siAlt = siAltU / 1000;
  const siCurve = (lim: number): number[] => siChartP.map((p: number) => Math.log10((1000 * lim) / (kdSi(p, siN) * siPhF + siMc))); // log10 of µg/L
  const siLogA = siCurve(siLim);
  const siLogB = siCurve(siAlt);
  const siLogAll = [...siLogA, ...siLogB].filter((x: number) => isFinite(x));
  const siFloor = siLogAll.length ? Math.floor(Math.min(...siLogAll)) : -1;
  const siCeil = siLogAll.length ? Math.ceil(Math.max(...siLogAll)) : 3;
  const siIdx = Math.round(siPA / 10) - 1;
  const siRows = [10, 20, 30, 40, 60, 80, 100, 120, 140, 160];
  const siBw_ = [[1000, 0.003], [1500, 0.010], [2000, 0.027], [2500, 0.075], [3000, 0.225]];

  // ---------- Blend / concentrate ----------
  const blMode = v.bl_mode;
  const blAn: An = blMode === "blend"
    ? blendAn(anA, anB, chA, chB, n("bl_pa") / 100)
    : blMode === "cycles"
      ? concCycles(anA, n("bl_coc"), n("bl_t"), v.bl_phmode, n("bl_phv"))
      : concRO({ ...anA, t: n("bl_t") }, chem({ ...anA, t: n("bl_t") }), n("bl_R") / 100, n("bl_rej") / 100);
  const blCh = chem(blAn);
  const blWarn = satRows(blCh).filter((r: Row) => r[3] && r[3].tone && r[3].tone !== "success").length;

  // ---------- Wastewater ----------
  const Q = n("ww_q"), Vw = n("ww_v"), mlss = n("ww_mlss"), vf = n("ww_vf");
  const hrt = (Vw / Q) * 24;
  const bodKg = (Q * n("ww_bod")) / 1000;
  const codKg = (Q * n("ww_cod")) / 1000;
  const tssKg = (Q * n("ww_tss")) / 1000;
  const fm = bodKg / ((Vw * mlss * vf) / 1000);
  const vlr = bodKg / Vw;
  const pxTss = (n("ww_qw") * n("ww_xw") + (Q - n("ww_qw")) * n("ww_tsse")) / 1000;
  const srt = (Vw * mlss) / 1000 / pxTss;
  const pxVss = pxTss * vf;
  const dBod = (Q * (n("ww_bod") - n("ww_bode"))) / 1000;
  const o2 = dBod / 0.68 - 1.42 * pxVss + (4.57 * Q * n("ww_nh")) / 1000;
  const airNm3h = o2 / (0.3 * (n("ww_ote") / 100)) / 24;
  const yObs = pxTss / dBod;
  const sludgeM3 = pxTss / ((n("ww_ds") / 100) * 1000);
  const clA = (Math.PI * n("ww_cd") * n("ww_cd")) / 4;
  const sor = Q / clA;
  const slr = (Q * (1 + n("ww_rr")) * mlss) / 1000 / clA / 24;
  const bc = n("ww_bod") / n("ww_cod");
  const cg = COAG[v.ww_coag] ?? COAG.fecl3;
  const cgKg = (n("ww_cdose") * Q) / 1000;
  const cgL = cgKg / cg.sg;
  const cgSludge = cgKg * cg.metal * cg.hyd;
  const netH = (ph: number): number => Math.pow(10, -ph) - Math.pow(10, ph - 14);
  const dMol = netH(n("ww_phin")) - netH(n("ww_pht"));
  const needBase = dMol > 0;
  const rgt = needBase ? (BASES[v.ww_base] ?? BASES.naoh32) : (ACIDS[v.ww_acid] ?? ACIDS.h2so4);
  const phPure = Math.abs(dMol) * n("ww_phq") * rgt.ew;
  const phProd = phPure / (rgt.str / 100);
  const fmRegime = !isFinite(fm) ? "" : fm < 0.15 ? "Extended aeration range" : fm <= 0.5 ? "Conventional activated sludge range" : "High-rate range";

  // ---------- Conversions ----------
  const ion = IONS.find((i: { k: string }) => i.k === v.cv_ion) ?? IONS[0];
  const cvF = 50.04 / ion.ew;
  const cvVal = n("cv_val");
  const asIon = v.cv_dir === "ion" ? cvVal : cvVal / cvF;
  const asCaco3 = v.cv_dir === "ion" ? cvVal * cvF : cvVal;
  const hBase = n("cv_hval") * (HARD[v.cv_hunit] ?? HARD.caco3).f;
  const fBase = n("cv_fval") * (FLOW[v.cv_funit] ?? FLOW.m3h).f;
  const dStr = v.cv_dbasis === "active" ? n("cv_dstr") / 100 : 1;
  const dKgH = (n("cv_dppm") * n("cv_dq")) / 1000 / dStr;
  const dLh = dKgH / n("cv_dsg");
  const pumpPpm = (n("cv_pump") * n("cv_dsg") * 1000) / n("cv_dq");

  // ---------- Plant mimic: drawing + unit panel helpers ----------
  const PM_STATUS_OPTS: Opt[] = [{ value: "svc", label: "In service" }, { value: "stby", label: "Standby" }, { value: "regen", label: "Regenerating" }, { value: "oos", label: "Out of service" }];
  const pmUnitOpts: Opt[] = [
    { value: "feed", label: "Raw water feed & demand" },
    ...PM_UNITS.filter((u: PmUnit) => u.type === "sac").map((u: PmUnit) => ({ value: u.id, label: u.label })),
    { value: "dg", label: "Degasser" },
    ...PM_UNITS.filter((u: PmUnit) => u.type === "wba" || u.type === "sba").map((u: PmUnit) => ({ value: u.id, label: u.label })),
    { value: "tk", label: "Demin storage tank" },
    { value: "pp", label: "Transfer pumps" },
    ...PM_UNITS.filter((u: PmUnit) => u.type === "mb").map((u: PmUnit) => ({ value: u.id, label: u.label })),
  ];
  const pmTone = (r: PmRes): { s: string; f: string; lbl: string; short: string } => {
    if (r.status === "oos") return { s: pmTh.text.tertiary, f: pmTh.bg.subtle, lbl: "Out of service", short: "OUT OF SVC" };
    if (r.status === "regen") return { s: pmTh.text.accent, f: pmTh.fill.accentSubtle, lbl: "Regenerating", short: "REGEN" };
    if (r.used >= 100) return { s: pmTh.text.danger, f: pmTh.fill.dangerSubtle, lbl: "Exhausted (alarm)", short: "EXHAUSTED" };
    if (r.status === "svc" && r.used >= 90) return { s: pmTh.text.warning, f: pmTh.fill.warningSubtle, lbl: "Near exhaustion", short: "≥90% USED" };
    if (r.status === "svc") return { s: pmTh.text.success, f: pmTh.fill.successSubtle, lbl: "In service", short: "SERVICE" };
    return { s: pmTh.text.secondary, f: pmTh.bg.elevated, lbl: "Standby", short: "STANDBY" };
  };
  const pmById = (id: string): PmRes => pmRes.find((r: PmRes) => r.id === id) ?? pmRes[0];
  const pmPipe = (x1: number, y1: number, x2: number, y2: number, key: string, arrow: boolean = false) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={pmTh.border.strong} strokeWidth={3} markerEnd={arrow ? "url(#pmArr)" : undefined} />
  );
  const pmTxt = (x: number, y: number, s: string, key: string, size: number = 11, color: string = "", weight: number = 400) => (
    <text key={key} x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={weight} fill={color || pmTh.text.primary} fontFamily={pmTh.font.family}>{s}</text>
  );
  const pmVessel = (r: PmRes, x: number, y: number, w: number, h: number) => {
    const c = pmTone(r);
    const sel = pmSel === r.id;
    const fillH = (Math.max(0, Math.min(isFinite(r.used) ? r.used : 0, 100)) / 100) * (h - 14);
    return (
      <g key={r.id} onClick={() => setPmSel(r.id)} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={w} height={h} rx={Math.min(w / 2, 14)} fill={c.f} stroke={sel ? pmTh.border.focus : c.s} strokeWidth={sel ? 4 : 2} />
        <rect x={x + 5} y={y + h - 7 - fillH} width={w - 10} height={fillH} fill={c.s} opacity={0.22} />
        {pmTxt(x + w / 2, y + 17, r.label, r.id + "l", 11, "", 600)}
        {pmTxt(x + w / 2, y + h / 2 + 5, isFinite(r.used) ? `${fmt(r.used, 0)}%` : "–", r.id + "p", 12, "", 600)}
        {pmTxt(x + w / 2, y + h - 10, c.short, r.id + "s", 7, c.s, 600)}
      </g>
    );
  };
  const pmMimic = () => {
    const rows = [85, 210, 335];
    const mbY = [49, 131, 213, 295, 377];
    const np = Math.min(Math.max(pmPn, 1), 4);
    const pY = Array.from({ length: np }, (_: unknown, i: number) => 210 + (i - (np - 1) / 2) * 60);
    const lvl = Math.max(0, Math.min(isFinite(n("pm_tk_lvl")) ? n("pm_tk_lvl") : 0, 100));
    const tkY = 110, tkH = 200;
    const lvH = ((tkH - 6) * lvl) / 100;
    const tkC = lvl <= n("pm_tk_lo") ? pmTh.text.danger : lvl >= n("pm_tk_hi") ? pmTh.text.warning : pmTh.text.accent;
    const fanOn = v.pm_dg_fan !== "off";
    const selS = (id: string): string => (pmSel === id ? pmTh.border.focus : pmTh.border.strong);
    const selW = (id: string): number => (pmSel === id ? 4 : 2);
    const sp = (y: number): number => tkY + tkH * (1 - Math.max(0, Math.min(y, 100)) / 100);
    const legend: { c: string; f: string; l: string }[] = [
      { c: pmTh.text.success, f: pmTh.fill.successSubtle, l: "In service" },
      { c: pmTh.text.warning, f: pmTh.fill.warningSubtle, l: "≥90% of run used" },
      { c: pmTh.text.danger, f: pmTh.fill.dangerSubtle, l: "Exhausted (alarm)" },
      { c: pmTh.text.accent, f: pmTh.fill.accentSubtle, l: "Regenerating" },
      { c: pmTh.text.secondary, f: pmTh.bg.elevated, l: "Standby" },
      { c: pmTh.text.tertiary, f: pmTh.bg.subtle, l: "Out of service" },
    ];
    return (
      <div style={{ overflowX: "auto", width: "100%" }}>
        <svg viewBox="0 0 900 452" width="100%" style={{ minWidth: 720, display: "block" }} role="img" aria-label="Demineralisation plant mimic">
          <defs>
            <marker id="pmArr" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={pmTh.text.secondary} />
            </marker>
          </defs>
          {pmTxt(37, 22, "Feed", "h0", 11, pmTh.text.secondary, 600)}
          {pmTxt(128, 22, "SAC", "h1", 11, pmTh.text.secondary, 600)}
          {pmTxt(240, 22, "Degasser", "h2", 11, pmTh.text.secondary, 600)}
          {pmTxt(386, 22, "WBA → SBA trains", "h3", 11, pmTh.text.secondary, 600)}
          {pmTxt(545, 22, "Demin tank", "h4", 11, pmTh.text.secondary, 600)}
          {pmTxt(647, 22, "Pumps", "h5", 11, pmTh.text.secondary, 600)}
          {pmTxt(750, 12, "Mixed beds", "h6", 11, pmTh.text.secondary, 600)}
          {pmTxt(868, 22, "Product", "h7", 11, pmTh.text.secondary, 600)}

          {/* feed */}
          <g onClick={() => setPmSel("feed")} style={{ cursor: "pointer" }}>
            <rect x={6} y={178} width={62} height={64} rx={8} fill={pmTh.fill.accentSubtle} stroke={selS("feed")} strokeWidth={selW("feed")} />
            {pmTxt(37, 200, "Raw water", "f1", 10, "", 600)}
            {pmTxt(37, 215, `${fmt(pmQ, 0)} m³/h`, "f2", 10)}
            {pmTxt(37, 230, `${fmt(pmCh.cat, 2)} meq/L`, "f3", 8, pmTh.text.secondary)}
          </g>
          {pmPipe(68, 210, 80, 210, "sf")}
          {pmPipe(80, 85, 80, 335, "sm1")}
          {rows.map((y: number, i: number) => (
            <g key={`sacr${i}`}>
              {pmPipe(80, y, 99, y, `sa${i}`, true)}
              {pmPipe(156, y, 180, y, `sb${i}`)}
              {pmVessel(pmById(`sac${i + 1}`), 100, y - 45, 56, 90)}
            </g>
          ))}
          {pmPipe(180, 85, 180, 335, "sm2")}
          {pmPipe(180, 210, 214, 210, "sd", true)}

          {/* degasser */}
          <g onClick={() => setPmSel("dg")} style={{ cursor: "pointer" }}>
            <rect x={215} y={70} width={50} height={215} rx={8} fill={pmTh.bg.elevated} stroke={selS("dg")} strokeWidth={selW("dg")} />
            {[0, 1, 2, 3, 4, 5].map((i: number) => (
              <line key={`pk${i}`} x1={219} y1={100 + i * 26} x2={261} y2={114 + i * 26} stroke={pmTh.border.default} strokeWidth={1} />
            ))}
            <text x={240} y={182} textAnchor="middle" fontSize={10} fontWeight={600} fill={pmTh.text.secondary} fontFamily={pmTh.font.family} transform="rotate(-90 240 182)">FORCED-DRAUGHT CO₂ STRIPPER</text>
            <line x1={240} y1={62} x2={240} y2={70} stroke={pmTh.border.strong} strokeWidth={2} />
            <circle cx={240} cy={48} r={14} fill={fanOn ? pmTh.fill.successSubtle : pmTh.fill.dangerSubtle} stroke={fanOn ? pmTh.text.success : pmTh.text.danger} strokeWidth={2} />
            {[0, 120, 240].map((a: number) => (
              <line key={`bl${a}`} x1={240} y1={48} x2={240 + 11 * Math.cos((a * Math.PI) / 180)} y2={48 + 11 * Math.sin((a * Math.PI) / 180)} stroke={fanOn ? pmTh.text.success : pmTh.text.danger} strokeWidth={2} />
            ))}
            {pmTxt(278, 46, fanOn ? "Fan on" : "Fan OFF", "fan", 9, fanOn ? pmTh.text.success : pmTh.text.danger, 600)}
            {pmPipe(240, 285, 240, 292, "dgs")}
            <rect x={205} y={292} width={70} height={46} rx={6} fill={pmTh.fill.accentSubtle} stroke={selS("dg")} strokeWidth={selW("dg")} />
            {pmTxt(240, 310, "Sump", "sump", 10, "", 600)}
            {pmTxt(240, 327, `CO₂ ${fmt(pmCo2Model, 1)} mg/L`, "co2", 8, pmCo2Model > 5 ? pmTh.text.warning : pmTh.text.secondary)}
          </g>
          {pmPipe(275, 315, 299, 315, "tr", true)}

          {/* anion trains */}
          {pmPipe(300, 85, 300, 335, "am1")}
          {rows.map((y: number, i: number) => (
            <g key={`anr${i}`}>
              {pmPipe(300, y, 319, y, `aa${i}`, true)}
              {pmPipe(372, y, 399, y, `ab${i}`, true)}
              {pmPipe(452, y, 475, y, `ac${i}`)}
              {pmVessel(pmById(`wba${i + 1}`), 320, y - 45, 52, 90)}
              {pmVessel(pmById(`sba${i + 1}`), 400, y - 45, 52, 90)}
            </g>
          ))}
          {pmPipe(475, 85, 475, 335, "am2")}
          {pmPipe(475, 210, 499, 210, "tki", true)}

          {/* tank */}
          <g onClick={() => setPmSel("tk")} style={{ cursor: "pointer" }}>
            <rect x={500} y={tkY} width={90} height={tkH} rx={6} fill={pmTh.bg.elevated} stroke={selS("tk")} strokeWidth={selW("tk")} />
            <rect x={503} y={tkY + tkH - 3 - lvH} width={84} height={lvH} fill={tkC} opacity={0.3} />
            <line x1={500} y1={sp(n("pm_tk_hi"))} x2={590} y2={sp(n("pm_tk_hi"))} stroke={pmTh.text.warning} strokeWidth={1} strokeDasharray="4 3" />
            <line x1={500} y1={sp(n("pm_tk_lo"))} x2={590} y2={sp(n("pm_tk_lo"))} stroke={pmTh.text.danger} strokeWidth={1} strokeDasharray="4 3" />
            {pmTxt(510, sp(n("pm_tk_hi")) - 3, "H", "tkh", 8, pmTh.text.warning, 600)}
            {pmTxt(510, sp(n("pm_tk_lo")) - 3, "L", "tkl", 8, pmTh.text.danger, 600)}
            {pmTxt(545, tkY + tkH / 2 - 6, `${fmt(lvl, 0)}%`, "tk1", 15, "", 600)}
            {pmTxt(545, tkY + tkH / 2 + 11, `${fmt((pmTkVol * lvl) / 100, 0)} of ${fmt(pmTkVol, 0)} m³`, "tk2", 9)}
            {pmTxt(545, tkY + tkH / 2 + 25, `${fmt(pmTkHrs, 1)} h to low`, "tk3", 9, pmTh.text.secondary)}
          </g>

          {/* pumps */}
          {pmPipe(590, 210, 615, 210, "po")}
          {np > 1 ? pmPipe(615, pY[0], 615, pY[np - 1], "ph1") : null}
          {np > 1 ? pmPipe(680, pY[0], 680, pY[np - 1], "ph2") : null}
          <g onClick={() => setPmSel("pp")} style={{ cursor: "pointer" }}>
            {pY.map((y: number, i: number) => {
              const duty = i < pmPd;
              const col = duty ? pmTh.text.success : pmTh.text.secondary;
              return (
                <g key={`pu${i}`}>
                  {pmPipe(615, y, 629, y, `pi${i}`)}
                  {pmPipe(661, y, 680, y, `pd${i}`)}
                  <circle cx={645} cy={y} r={16} fill={duty ? pmTh.fill.successSubtle : pmTh.bg.elevated} stroke={pmSel === "pp" ? pmTh.border.focus : col} strokeWidth={pmSel === "pp" ? 4 : 2} />
                  <path d={`M638,${y - 8} L655,${y} L638,${y + 8} z`} fill={col} />
                  {pmTxt(645, y + 27, `P-${i + 1} ${duty ? "duty" : "standby"}`, `pl${i}`, 8, col, 600)}
                </g>
              );
            })}
          </g>
          {pmPipe(680, 210, 704, 210, "pmo", true)}

          {/* mixed beds */}
          {pmPipe(705, 49, 705, 377, "mm1")}
          {mbY.map((y: number, i: number) => (
            <g key={`mbr${i}`}>
              {pmPipe(705, y, 724, y, `ma${i}`, true)}
              {pmPipe(775, y, 800, y, `mb${i}`)}
              {pmVessel(pmById(`mb${i + 1}`), 725, y - 31, 50, 62)}
            </g>
          ))}
          {pmPipe(800, 49, 800, 377, "mm2")}
          {pmPipe(800, 213, 846, 213, "prd", true)}
          <g onClick={() => setPmSel("feed")} style={{ cursor: "pointer" }}>
            {pmTxt(870, 200, `${fmt(pmDem, 0)} m³/h`, "pr1", 11, "", 600)}
            {pmTxt(870, 232, `£${fmt(pmCostM3, 2)}/m³`, "pr2", 10, pmTh.text.secondary)}
          </g>

          {/* legend */}
          {legend.map((g: { c: string; f: string; l: string }, i: number) => (
            <g key={`lg${i}`}>
              <rect x={10 + i * 146} y={428} width={14} height={14} rx={3} fill={g.f} stroke={g.c} strokeWidth={2} />
              <text x={30 + i * 146} y={439} fontSize={10} fill={pmTh.text.secondary} fontFamily={pmTh.font.family}>{g.l}</text>
            </g>
          ))}
        </svg>
      </div>
    );
  };

  const scOn = (key: string): boolean => {
    const x = (v["pm_sc_" + key] ?? "").trim();
    if (!x) return false;
    if (key === "tds" || key === "hard" || key === "alk" || key === "sio2") return Math.abs(pf(x) - 100) > 0.001;
    return true;
  };
  const scNum = (key: string): number => { const x = parseFloat(v["pm_sc_" + key] ?? ""); return isFinite(x) ? x : NaN; };
  const scFlow = (key: string, dflt: FlowMode): FlowMode => {
    const x = v["pm_sc_" + key];
    return x === "co" || x === "counter" ? x : dflt;
  };
  const pmPo4 = pmMeq("po4");
  const pmVesselsOf = (type: PmType): PmUnit[] => {
    const svc = PM_UNITS.filter((u: PmUnit) => u.type === type && pmS(u.id) === "svc");
    return svc.length ? svc : PM_UNITS.filter((u: PmUnit) => u.type === type);
  };
  const pmAvg = (xs: number[]): number => { const f = xs.filter((x: number) => isFinite(x)); return f.length ? f.reduce((s: number, x: number) => s + x, 0) / f.length : NaN; };
  const pmYourThr = (type: PmType): number => {
    const measured = n(`pm_mthr_${type}`);
    if (isFinite(measured) && measured > 0) return measured;
    const load = type === "sba" ? pmCo2Out / 44.01 + pmSi / 60.08 + pmPo4 : type === "mb" ? n("pm_naleak") / 22.99 + n("pm_sileak") / 60080 : pmLoad[type];
    return pmAvg(pmVesselsOf(type).map((u: PmUnit) => (pmF(u.id, "vol") * pmF(u.id, "cap")) / load));
  };
  const pmPredThr = (type: PmType): number => {
    const load = type === "sba" ? pmCo2Pred / 44.01 + pmSi / 60.08 + pmPo4 : type === "mb" ? pmNaPred / 22.99 + pmSiPred / 60080 : pmLoad[type];
    return pmAvg(pmVesselsOf(type).map((u: PmUnit) => (pmF(u.id, "vol") * pmVp[u.id].cap) / load));
  };
  const pmEffHints = (type: PmType): string[] => {
    const h: string[] = [];
    const bvh = pmAvg(pmVesselsOf(type).map((u: PmUnit) => { const r = pmRes.find((x: PmRes) => x.id === u.id); return r ? r.bvh : NaN; }));
    if (bvh > 0 && bvh < 5) h.push("low velocity (channelling)");
    if (bvh > (type === "mb" ? 50 : 40)) h.push("high velocity (early leakage)");
    if (type === "sac" && pmMeanSvc("sac", (id: string) => pmF(id, "endpt")) + 1e-9 < pmNaPred) h.push("Na endpoint set below the predicted slip");
    if (type === "sba" && pmMeanSvc("sba", (id: string) => pmF(id, "endpt")) + 1e-9 < pmSiPred) h.push("silica endpoint set below the predicted leakage");
    const acid = PM_UNITS.find((u: PmUnit) => u.type === "sac" && pmVp[u.id] && pmVp[u.id].h2so4);
    if (type === "sac" && acid && pmVp[acid.id].h2so4) h.push("calcium sulphate precipitation in the SAC");
    if (type === "wba" && pmAn.t > 35) h.push("WBA capacity falls when the bed is warm");
    return h;
  };
  const pmCurve = (kind: "sac" | "sba"): { dose: number; thr: number; cost: number }[] => {
    const doses = kind === "sac" ? [40, 60, 80, 100, 120, 150] : [40, 50, 70, 80, 100, 120, 150];
    const units = PM_UNITS.filter((u: PmUnit) => u.type === kind && pmS(u.id) !== "oos");
    const vol = units.length ? pmAvg(units.map((u: PmUnit) => pmF(u.id, "vol"))) : (kind === "sac" ? 4000 : 1000);
    const id0 = kind === "sac" ? "sac1" : "sba1";
    const load = kind === "sac" ? pmLoad.sac : pmCo2Pred / 44.01 + pmSi / 60.08 + pmPo4;
    const regen = kind === "sac" && v.pm_sac1_regen === "h2so4" ? "h2so4" : "hcl";
    const price = kind === "sba" ? pmChemOf("naoh").perKg : pmChemOf(regen).perKg;
    return doses.map((dose: number) => {
      const cap = kind === "sac"
        ? sacPredict(pmWater, dose, regen, pmMode("pm_flow_sac", "counter"), pmF(id0, "endpt"), pmF(id0, "conc")).cap
        : sbaPredict(pmWater, dose, pmMode("pm_flow_sba", "counter"), pmSbaType, pmRegenT, pmCo2Pred, pmF(id0, "endpt")).cap;
      const thr = (vol * cap) / load;
      return { dose, thr, cost: (dose * vol / 1000) * price / thr };
    });
  };
  const pmSacCurve = pmCurve("sac");
  const pmSbaCurve = pmCurve("sba");
  const pmBest = (pts: { cost: number }[]): number => pts.reduce((bi: number, p: { cost: number }, i: number) => (isFinite(p.cost) && p.cost < pts[bi].cost ? i : bi), 0);
  const waterSc = scOn("tds") || scOn("hard") || scOn("alk") || scOn("sio2") || scOn("t");
  const scActive = waterSc || ["dose_sac", "dose_wba", "dose_sba", "dose_mb", "dose_mb2", "regen_sac", "flow_sac", "flow_wba", "flow_sba", "flow_mb", "sba_type", "regen_t", "q", "dem", "n_sac", "n_wba", "n_sba", "n_mb", "end_sac", "end_sba", "end_mb", "c_hcl", "c_h2so4", "c_naoh", "c_water", "c_eff", "c_kwh"].some(scOn);
  const pmScUnits = (): DeminUnit[] => {
    const tdsF = (scOn("tds") ? scNum("tds") : 100) / 100;
    const hardF = (scOn("hard") ? scNum("hard") : 100) / 100;
    const alkF = (scOn("alk") ? scNum("alk") : 100) / 100;
    const siF = (scOn("sio2") ? scNum("sio2") : 100) / 100;
    let water = pmWater;
    let co2 = pmCo2Model;
    let po4 = pmPo4;
    const q = scOn("q") ? scNum("q") : pmQ;
    if (waterSc) {
      const ion: Record<string, number> = {};
      AN_IONS.forEach((d: IonDef) => {
        let x = (pmAn.ion[d.k] || 0) * tdsF;
        if (d.k === "ca" || d.k === "mg" || d.k === "sr" || d.k === "ba") x *= hardF;
        if (d.k === "sio2") x *= siF;
        ion[d.k] = x;
      });
      const tSc = scNum("t");
      const anSc: An = { ...pmAn, ion, malk: pmAn.malk * tdsF * alkF, palk: pmAn.palk * tdsF * alkF, t: isFinite(tSc) ? tSc : pmAn.t, ec: pmAn.ec * tdsF, tdsM: pmAn.tdsM * tdsF };
      const chSc = chem(anSc);
      const fma = (ion.cl || 0) / (ionDef("cl").mw / ionDef("cl").z) + (ion.so4 || 0) / (ionDef("so4").mw / ionDef("so4").z) + (ion.no3 || 0) / (ionDef("no3").mw / ionDef("no3").z) + (ion.f || 0) / (ionDef("f").mw / ionDef("f").z);
      po4 = (ion.po4 || 0) / (ionDef("po4").mw / ionDef("po4").z);
      water = {
        t: anSc.t, tds: chSc.tds, cat: chSc.cat, ani: chSc.ani, fma, sio2: ion.sio2 || 0, co2In: chSc.ct * 44010,
        naFrac: chSc.cat > 0 ? (ion.na || 0) / (ionDef("na").mw / ionDef("na").z) / chSc.cat : 0,
        alkFrac: chSc.ani > 0 ? (anSc.malk / 50.04) / chSc.ani : 0,
        caFrac: chSc.cat > 0 ? (ion.ca || 0) / (ionDef("ca").mw / ionDef("ca").z) / chSc.cat : 0,
        so4Frac: fma > 0 ? (ion.so4 || 0) / (ionDef("so4").mw / ionDef("so4").z) / fma : 0,
      };
      co2 = degasPredict(water.co2In, q, n("pm_dg_cap"), n("pm_dg_co2"), v.pm_dg_fan !== "off");
    } else if (scOn("q")) {
      co2 = degasPredict(pmCo2In, q, n("pm_dg_cap"), n("pm_dg_co2"), v.pm_dg_fan !== "off");
    }
    const sbaType: "1" | "2" = scOn("sba_type") ? (v.pm_sc_sba_type === "2" ? "2" : "1") : pmSbaType;
    const regenT = scOn("regen_t") ? scNum("regen_t") : pmRegenT;
    const doseFor = (type: PmType, key: string, own: number): number => (scOn(key) ? scNum(key) : own);
      const changed = (type: PmType): boolean => waterSc || (type === "sac" && (scOn("dose_sac") || scOn("regen_sac") || scOn("flow_sac") || scOn("end_sac"))) || (type === "wba" && (scOn("dose_wba") || scOn("flow_wba"))) || (type === "sba" && (scOn("dose_sba") || scOn("flow_sba") || scOn("end_sba") || scOn("sba_type") || scOn("regen_t") || scOn("q"))) || (type === "mb" && (scOn("dose_mb") || scOn("dose_mb2") || scOn("flow_mb") || scOn("end_mb")));
    const units: DeminUnit[] = PM_UNITS.map((u: PmUnit) => {
      const live = pmRes.find((r: PmRes) => r.id === u.id) as PmRes;
      let dose = doseFor(u.type, u.type === "sac" ? "dose_sac" : u.type === "wba" ? "dose_wba" : u.type === "sba" ? "dose_sba" : "dose_mb", live.dose);
      let dose2 = u.type === "mb" ? doseFor("mb", "dose_mb2", pmF(u.id, "dose2")) : 0;
      let regen = live.regen;
      if (u.type === "sac" && scOn("regen_sac")) regen = v.pm_sc_regen_sac === "h2so4" ? "h2so4" : "hcl";
      const endpt = u.type === "sac" && scOn("end_sac") ? scNum("end_sac") : u.type === "sba" && scOn("end_sba") ? scNum("end_sba") : u.type === "mb" && scOn("end_mb") ? scNum("end_mb") : pmF(u.id, "endpt");
      let cap = live.cap;
      let naLeak = NaN, siLeak = NaN;
      if (changed(u.type)) {
        if (u.type === "sac") {
          const r = sacPredict(water, dose, regen === "h2so4" ? "h2so4" : "hcl", scFlow("flow_sac", pmMode("pm_flow_sac", "counter")), endpt, pmF(u.id, "conc"));
          cap = r.cap; naLeak = r.naLeak;
        } else if (u.type === "wba") cap = wbaPredict(water, dose, scFlow("flow_wba", pmMode("pm_flow_wba", "co"))).cap;
        else if (u.type === "sba") {
          const r = sbaPredict(water, dose, scFlow("flow_sba", pmMode("pm_flow_sba", "counter")), sbaType, regenT, co2, endpt);
          cap = r.cap; siLeak = r.siLeak;
        } else cap = mbPredict(dose, dose2, scFlow("flow_mb", pmMode("pm_flow_mb", "counter")), endpt).cap;
      }
      return { id: u.id, type: u.type, status: live.status, dia: pmF(u.id, "dia"), vol: live.vol, cap, dose, dose2, regen, conc: pmF(u.id, "conc"), rinse: pmF(u.id, "rinse"), naLeak, siLeak };
    });
    (["sac", "wba", "sba", "mb"] as PmType[]).forEach((type: PmType) => {
      if (!scOn(`n_${type}`)) return;
      const nKeep = Math.round(scNum(`n_${type}`));
      let i = 0;
      units.forEach((u: DeminUnit) => {
        if (u.type !== type || u.status === "oos") return;
        u.status = i < nKeep ? "svc" : "stby";
        i += 1;
      });
    });
    const svcMean = (type: PmType, pick: (u: DeminUnit) => number): number => {
      const svc = units.filter((u: DeminUnit) => u.type === type && u.status === "svc");
      const use = svc.length ? svc : units.filter((u: DeminUnit) => u.type === type);
      return pmAvg(use.map(pick));
    };
    const na = changed("sac") ? svcMean("sac", (u: DeminUnit) => u.naLeak) : pmNaUsed;
    const si = changed("sba") ? svcMean("sba", (u: DeminUnit) => u.siLeak) : pmSiUsed;
    const load = {
      sac: water.cat,
      wba: water.fma,
      sba: co2 / 44.01 + water.sio2 / 60.08 + po4,
      mb: na / 22.99 + si / 60080,
    };
    if (!waterSc && !changed("sba")) load.sba = pmLoad.sba;
    if (!changed("sac") && !changed("sba") && !waterSc) load.mb = pmLoad.mb;
    if (!waterSc) { load.sac = pmLoad.sac; load.wba = pmLoad.wba; }
    return { units, load, q, na, si };
  };
  const svcThr = (type: PmType): number => pmAvg(pmRes.filter((r: PmRes) => r.type === type && r.status === "svc").map((r: PmRes) => r.thr));
  const svcRun = (type: PmType): number => pmAvg(pmRes.filter((r: PmRes) => r.type === type && r.status === "svc").map((r: PmRes) => r.runH));
  const curChemT = Object.keys(pmKgYr).reduce((s: number, k: string) => s + (pmStr(k) > 0 ? pmKgYr[k] / 1000 / pmStr(k) : 0), 0);
  const pmScenario = (): { thr: Record<PmType, number>; runH: Record<PmType, number>; regYr: Record<PmType, number>; chemT: number; waste: number; cost: number; na: number; si: number; bottleneck: string } => {
    const cur = {
      thr: { sac: svcThr("sac"), wba: svcThr("wba"), sba: svcThr("sba"), mb: svcThr("mb") } as Record<PmType, number>,
      runH: { sac: svcRun("sac"), wba: svcRun("wba"), sba: svcRun("sba"), mb: svcRun("mb") } as Record<PmType, number>,
      regYr: { sac: pmSac.regYr, wba: pmWba.regYr, sba: pmSba.regYr, mb: pmMb.regYr } as Record<PmType, number>,
      chemT: Object.keys(pmKgYr).reduce((s: number, k: string) => s + (pmStr(k) > 0 ? pmKgYr[k] / 1000 / pmStr(k) : 0), 0),
      waste: pmWasteYr, cost: pmTotYr, na: pmNaUsed, si: pmSiUsed,
      bottleneck: pmBn.name,
    };
    if (!scActive) return cur;
    const built = pmScUnits();
    const out = runDemin({
      units: built.units, load: built.load, q: built.q, dem: scOn("dem") ? scNum("dem") : pmDem,
      hrs: n("pm_hrs"), days: n("pm_days"), pair: v.pm_pair === "yes", tf: v.pm_tf === "yes",
      hclPrice: scOn("c_hcl") ? scNum("c_hcl") : n("pm_c_hcl"), hclStr: n("pm_c_hcls"),
      h2so4Price: scOn("c_h2so4") ? scNum("c_h2so4") : n("pm_c_h2so4"), h2so4Str: n("pm_c_h2so4s"),
      naohPrice: scOn("c_naoh") ? scNum("c_naoh") : n("pm_c_naoh"), naohStr: n("pm_c_naohs"),
      kwhPrice: scOn("c_kwh") ? scNum("c_kwh") : n("pm_c_kwh"),
      waterPrice: scOn("c_water") ? scNum("c_water") : n("pm_c_water"),
      effPrice: scOn("c_eff") ? scNum("c_eff") : n("pm_c_eff"),
      resin: { sac: n("pm_rc_sac"), wba: n("pm_rc_wba"), sba: n("pm_rc_sba"), mb: n("pm_rc_mb") },
      resinLife: { sac: n("pm_rl_sac"), wba: n("pm_rl_wba"), sba: n("pm_rl_sba"), mb: n("pm_rl_mb") },
      rtSac: n("pm_rt_sac"), rtAn: n("pm_rt_an"), rtMb: n("pm_rt_mb"),
      pumpN: n("pm_p_n"), pumpDuty: n("pm_p_duty"), pumpQ: n("pm_p_q"), pumpH: n("pm_p_h"), pumpKw: n("pm_p_kw"),
      pumpEff: n("pm_p_eff"), pumpMeff: n("pm_p_meff"), pumpHrs: n("pm_p_hrs"),
      fanKw: n("pm_dg_kw"), fanOn: v.pm_dg_fan !== "off", naLeak: built.na, siLeak: built.si,
    });
    return { thr: out.thr, runH: out.runH, regYr: out.regYr, chemT: out.chemT, waste: out.waste, cost: out.cost, na: built.na, si: built.si, bottleneck: out.bottleneck };
  };
  const pmScNow = pmScenario();
  const resetScenario = (): void => {
    const o: Vals = {};
    Object.keys(DEF).forEach((k: string) => { if (k.startsWith("pm_sc_")) o[k] = DEF[k]; });
    setMany(o);
  };
  const applyScenario = (): void => {
    const o: Vals = { pm_basis: "predicted" };
    const putDose = (type: PmType, key: string, field: string): void => {
      if (!scOn(key)) return;
      PM_UNITS.filter((u: PmUnit) => u.type === type).forEach((u: PmUnit) => { o[`pm_${u.id}_${field}`] = v["pm_sc_" + key]; });
    };
    putDose("sac", "dose_sac", "dose"); putDose("wba", "dose_wba", "dose"); putDose("sba", "dose_sba", "dose"); putDose("mb", "dose_mb", "dose"); putDose("mb", "dose_mb2", "dose2");
    if (scOn("regen_sac")) PM_UNITS.filter((u: PmUnit) => u.type === "sac").forEach((u: PmUnit) => { o[`pm_${u.id}_regen`] = v.pm_sc_regen_sac; });
    if (scOn("q")) o.pm_q = v.pm_sc_q;
    if (scOn("dem")) o.pm_dem = v.pm_sc_dem;
    (["sac", "wba", "sba", "mb"] as PmType[]).forEach((type: PmType) => { if (scOn(`flow_${type}`)) o[`pm_flow_${type}`] = v[`pm_sc_flow_${type}`]; });
    if (scOn("sba_type")) o.pm_sba_type = v.pm_sc_sba_type;
    if (scOn("regen_t")) o.pm_regen_t = v.pm_sc_regen_t;
    ([["sac", "end_sac"], ["sba", "end_sba"], ["mb", "end_mb"]] as [PmType, string][]).forEach((pr: [PmType, string]) => {
      if (!scOn(pr[1])) return;
      PM_UNITS.filter((u: PmUnit) => u.type === pr[0]).forEach((u: PmUnit) => { o[`pm_${u.id}_endpt`] = v["pm_sc_" + pr[1]]; });
    });
    (["c_hcl", "c_h2so4", "c_naoh", "c_water", "c_eff", "c_kwh"] as string[]).forEach((key: string) => { if (scOn(key)) o["pm_" + key] = v["pm_sc_" + key]; });
    (["sac", "wba", "sba", "mb"] as PmType[]).forEach((type: PmType) => {
      if (!scOn(`n_${type}`)) return;
      const nKeep = Math.round(scNum(`n_${type}`));
      let i = 0;
      PM_UNITS.forEach((u: PmUnit) => {
        if (u.type !== type || v[`pm_${u.id}_status`] === "oos") return;
        o[`pm_${u.id}_status`] = i < nKeep ? "svc" : "stby";
        i += 1;
      });
    });
    if (waterSc) {
      const tdsF = (scOn("tds") ? scNum("tds") : 100) / 100;
      const hardF = (scOn("hard") ? scNum("hard") : 100) / 100;
      const alkF = (scOn("alk") ? scNum("alk") : 100) / 100;
      const siF = (scOn("sio2") ? scNum("sio2") : 100) / 100;
      const pfx = v.pm_src === "local" ? "pm_w_" : "a_";
      const scaleKey = (suffix: string, f: number): void => {
        const cur = parseFloat(v[pfx + suffix] ?? "");
        if (isFinite(cur)) o[pfx + suffix] = sig(cur * f);
      };
      AN_IONS.forEach((d: IonDef) => {
        let f = tdsF;
        if (d.k === "ca" || d.k === "mg" || d.k === "sr" || d.k === "ba") f *= hardF;
        if (d.k === "sio2") f *= siF;
        scaleKey(d.k, f);
      });
      scaleKey("malk", tdsF * alkF); scaleKey("palk", tdsF * alkF);
      if (scOn("t")) o[pfx + "t"] = v.pm_sc_t;
    }
    Object.keys(DEF).forEach((k: string) => { if (k.startsWith("pm_sc_")) o[k] = DEF[k]; });
    setMany(o);
  };
  const pmDelta = (now: number, next: number, d: number): string => {
    if (!isFinite(now) || !isFinite(next)) return "–";
    const x = next - now;
    return `${x > 0 ? "+" : ""}${fmt(x, d)}`;
  };

  const sharedNote = (c: Ch) => (
    <Text>{`Using the shared water analysis: pH ${fmt(c.an.ph, 2)}, ${fmt(c.an.t, 1)} °C, TDS ${fmt(c.tds, 0)} mg/L, Ca hardness ${fmt(c.caC, 0)} and M-alkalinity ${fmt(c.an.malk, 0)} mg/L as CaCO₃, silica ${fmt(c.an.ion.sio2 || 0, 1)} mg/L.`}</Text>
  );

  const tabs: Opt[] = [
    { value: "an", label: "Water analysis" },
    { value: "ch", label: "Water chemistry" },
    { value: "si", label: "Scaling indices" },
    { value: "bl", label: "Blend & concentrate" },
    { value: "ro", label: "Reverse osmosis" },
    { value: "ix", label: "Ion exchange" },
    { value: "ct", label: "Cooling towers" },
    { value: "bo", label: "Boilers" },
    { value: "cl", label: "Chlorine" },
    { value: "ww", label: "Wastewater" },
    { value: "cv", label: "Conversions" },
    { value: "pm", label: "Plant Mimic" },
  ];

  const pmPanel = () => {
    const u = PM_UNITS.find((x: PmUnit) => x.id === pmSel);
    const r = pmRes.find((x: PmRes) => x.id === pmSel);
    if (u && r) {
      const td = PM_TYPE[u.type];
      const id = u.id;
      const c = pmTone(r);
      const st = pmStages.find((s: PmStage) => s.t === u.type) ?? pmSac;
      const ch1 = pmChemOf(r.regen);
      const tf = u.type === "wba" && pmTf;
      const isSvc = r.status === "svc";
      const rows: Row[] = [
        ["Status", c.lbl, "", r.used >= 100 && r.status !== "regen" ? { text: "Past calculated capacity", tone: "danger" } : null],
        ["Flow through this vessel", fmt(r.flow, 1), "m³/h", isSvc ? null : { text: "Not in service" }],
        ["Superficial velocity", fmt(r.vel, 1), "m/h", isSvc ? range(r.vel, 5, td.vMax, `Within 5–${td.vMax}`, "Low: channelling risk", "High: leakage / ΔP") : null],
        ["Specific flow", fmt(r.bvh, 1), "BV/h", isSvc ? range(r.bvh, 5, td.bvMax, `Within 5–${td.bvMax}`, "Low: channelling risk", "High: leakage") : null],
        ["Bed depth (resin volume ÷ area)", fmt(r.depth, 2), "m", range(r.depth, 0.75, 3, "Typical 0.75–3", "Shallow: early leakage", "Deep: check ΔP")],
        ["Ionic load on this stage", fmt(pmLoad[u.type], 3), "eq/m³ (meq/L)", null],
        ["Capacity per cycle", fmt(r.eqEx, 0), "eq", null],
        ["Predicted operating capacity", fmt(pmVp[id] ? pmVp[id].cap : NaN, 2), "eq/L resin", pmVp[id] && pmF(id, "cap") > 0 ? effCheck((pmF(id, "cap") / pmVp[id].cap) * 100, pmVp[id].h2so4 ? [pmVp[id].h2so4] : []) : null],
        ["Throughput per cycle", fmt(r.thr, 0), "m³", null],
        ["Run length at current flow", fmt(r.runH, 1), "h", null],
        ["Throughput since regeneration", fmt(r.thru, 0), "m³", null],
        ["Run used", fmt(r.used, 0), "%", r.used >= 100 ? { text: "Exhausted", tone: "danger" } : r.used >= 90 ? { text: "Near exhaustion", tone: "warning" } : { text: "OK", tone: "success" }],
        ["Remaining run", fmt(r.remM3, 0), "m³", null],
        ["Remaining run", fmt(r.remH, 1), "h", null],
        [`${ch1.short} per regeneration (100%)`, fmt(r.kg1, 1), "kg", tf ? { text: "Thoroughfare: spent SBA caustic" } : null],
        [`${ch1.short} per regeneration (as delivered ${fmt(pmStr(r.regen) * 100, 0)}%)`, fmt(r.kg1 / pmStr(r.regen), 0), "kg", null],
      ];
      if (u.type === "mb") rows.push(["NaOH per regeneration (100%)", fmt(r.kg2, 1), "kg", null], ["NaOH per regeneration (as delivered)", fmt(r.kg2 / pmStr("naoh"), 0), "kg", null]);
      else rows.push(
        ["Regenerant ratio", fmt(r.ratio, 2), "× stoichiometric", r.ratio > td.ratioMax ? { text: `Above typical ${td.ratioMax}×`, tone: "warning" } : { text: "Typical", tone: "success" }],
        ["Regeneration efficiency", fmt(100 / r.ratio, 0), "%", null],
      );
      rows.push(
        ["Chemical cost per regeneration", fmt(r.regCost, 0), "£", null],
        ["Waste water per regeneration (rinse + dilute regenerant)", fmt(r.wasteM3, 1), "m³", null],
        [`${PM_SNAME[u.type]} stage regenerations`, fmt((st.regYr / 365) * 7, 1), "per week", null],
      );
      return (
        <Fragment>
          <Text>{`${td.label}. Status: ${c.lbl}.`}</Text>
          <Grid columns={4} plain>
            {sel(`pm_${id}_status`, "Status", PM_STATUS_OPTS)}
            {inp(`pm_${id}_thru`, "Throughput since last regen (m³)")}
            {inp(`pm_${id}_hrs`, "or hours in service (used if m³ is blank/0)")}
            {inp(`pm_${id}_dia`, "Vessel diameter (m)")}
            {inp(`pm_${id}_vol`, "Resin volume (L)")}
            {inp(`pm_${id}_cap`, "Operating capacity (eq/L resin)")}
            {u.type === "sac" || u.type === "mb" ? sel(`pm_${id}_regen`, u.type === "mb" ? "Acid regenerant" : "Regenerant", [{ value: "hcl", label: "HCl" }, { value: "h2so4", label: "H₂SO₄" }]) : null}
            {inp(`pm_${id}_dose`, u.type === "mb" ? "Acid level (g/L of mixed bed, 100%)" : `Regen level (g/L resin, 100% ${ch1.short})`)}
            {u.type === "mb" ? inp(`pm_${id}_dose2`, "NaOH level (g/L of mixed bed, 100%)") : null}
            {inp(`pm_${id}_conc`, "Regenerant injection strength (%)")}
            {inp(`pm_${id}_rinse`, "Backwash + rinse water (BV)")}
            {inp(`pm_${id}_endpt`, td.endLbl)}
          </Grid>
          <Button label={`Apply these settings to all ${PM_SNAME[u.type]} vessels (not status/throughput)`} onClick={() => pmApplyAll(id)} />
          {table(rows)}
        </Fragment>
      );
    }
    if (pmSel === "dg") return (
      <Fragment>
        <Grid columns={4} plain>
          {inp("pm_dg_co2", "Design CO₂ out (mg/L)")}
          {sel("pm_dg_fan", "Fan", [{ value: "on", label: "Running" }, { value: "off", label: "Off / tripped" }])}
          {inp("pm_dg_ph", "Measured inlet pH (optional)")}
          {inp("pm_dg_cap", "Flow capacity (m³/h)")}
          {inp("pm_dg_kw", "Fan power (kW)")}
        </Grid>
        {table([
          ["CO₂ into degasser (all alkalinity converted by SAC)", fmt(pmCo2In, 1), "mg/L", null],
          ["CO₂ out (design, raised if overloaded)", fmt(pmCo2Out, 1), "mg/L", pmCo2Out > 5 ? { text: "Above about 5 mg/L", tone: "warning" } : { text: "OK", tone: "success" }],
          ["Predicted residual CO₂", fmt(pmCo2Pred, 1), "mg/L", pmCo2Pred > 5 ? { text: "Above about 5 mg/L", tone: "warning" } : { text: "Indicative", tone: "success" }],
          ["CO₂ removal", fmt((1 - pmCo2Out / pmCo2In) * 100, 1), "%", null],
          ["Hydraulic loading", fmt((pmQ / pmDgCap) * 100, 0), "% of capacity", range(pmQ / pmDgCap, 0, 1, "Within capacity", "", "Overloaded", "warning", "danger")],
          ["Expected inlet pH (FMA as mineral acid)", fmt(pmPhIn, 2), "", null],
          ["Measured inlet pH", fmt(n("pm_dg_ph"), 2), "", isFinite(n("pm_dg_ph")) ? (n("pm_dg_ph") > pmPhIn + 0.5 ? { text: "High: SAC leakage?", tone: "warning" } : { text: "Consistent", tone: "success" }) : null],
          ["SBA load from residual CO₂", fmt(pmCo2Out / 44.01, 3), "eq/m³", { text: `${fmt(((pmCo2Out / 44.01) / pmLoad.sba) * 100, 0)}% of SBA load` }],
          ["Fan energy", fmt(pmFanKwh, 0), "kWh/yr", null],
        ])}
      </Fragment>
    );
    if (pmSel === "tk") return (
      <Fragment>
        <Grid columns={4} plain>
          {inp("pm_tk_vol", "Tank volume (m³)")}
          {inp("pm_tk_lvl", "Current level (%)")}
          {inp("pm_tk_hi", "High setpoint (%)")}
          {inp("pm_tk_lo", "Low setpoint (%)")}
        </Grid>
        {table([
          ["Volume now", fmt((pmTkVol * n("pm_tk_lvl")) / 100, 0), "m³", null],
          ["Hours to low level at demand (no inflow)", fmt(pmTkHrs, 1), "h", range(pmTkHrs, pmRtMax, 1e9, "Covers longest regen", "Less than longest regen", "", "warning")],
          ["Usable storage between setpoints", fmt(pmTkUse, 1), "h at demand", range(pmTkUse, pmRtMax, 1e9, "Covers longest regen", "Less than longest regen", "", "warning")],
          ["Longest regeneration time", fmt(pmRtMax, 1), "h", null],
        ])}
      </Fragment>
    );
    if (pmSel === "pp") return (
      <Fragment>
        <Grid columns={4} plain>
          {inp("pm_p_n", "Number of pumps")}
          {inp("pm_p_duty", "Duty pumps")}
          {inp("pm_p_q", "Rated flow per pump (m³/h)")}
          {inp("pm_p_h", "Head (m)")}
          {inp("pm_p_kw", "Motor rating (kW)")}
          {inp("pm_p_eff", "Pump efficiency (%)")}
          {inp("pm_p_meff", "Motor efficiency (%)")}
          {inp("pm_p_hrs", "Running hours per year")}
        </Grid>
        {table([
          ["Duty / standby", `${pmPd} / ${Math.max(pmPn - pmPd, 0)}`, "pumps", pmPn > pmPd ? { text: "Standby available", tone: "success" } : { text: "No standby", tone: "danger" }],
          ["Flow per duty pump at demand", fmt(pmPq, 1), "m³/h", { text: `${fmt((pmPq / n("pm_p_q")) * 100, 0)}% of rated` }],
          ["Hydraulic power per pump", fmt(pmPhyd, 2), "kW", null],
          ["Shaft power per pump", fmt(pmPshaft, 2), "kW", null],
          ["Motor loading", fmt(pmPload, 0), "%", range(pmPload, 60, 100, "OK", "Lightly loaded: oversized", "Overloaded", "warning", "danger")],
          ["Electrical power (all duty pumps)", fmt(pmPkw, 2), "kW", null],
          ["Energy", fmt(pmPkwh, 0), "kWh/yr", null],
          ["Pumping cost", fmt(pmPkwh * n("pm_c_kwh"), 0), "£/yr", null],
          ["Specific energy", fmt(pmPkw / pmDem, 3), "kWh/m³", null],
        ])}
      </Fragment>
    );
    return (
      <Fragment>
        <Grid columns={4} plain>
          {srcSel("pm_src")}
          {inp("pm_q", "Feed flow to primary plant (m³/h)")}
          {inp("pm_dem", "Product water demand (m³/h, average)")}
          {inp("pm_hrs", "Demand hours per day")}
          {inp("pm_days", "Operating days per year")}
          {inp("pm_naleak", "SAC Na leakage to MBs (mg/L Na)")}
          {inp("pm_sileak", "SBA silica leakage to MBs (µg/L SiO₂)")}
          {inp("pm_mb_cond", "MB outlet conductivity target (µS/cm)")}
          {inp("pm_mb_si", "MB outlet silica target (µg/L)")}
          {sel("pm_tf", "WBA regenerated by SBA spent caustic", [{ value: "yes", label: "Yes (thoroughfare)" }, { value: "no", label: "No (separate caustic)" }])}
          {sel("pm_pair", "WBA + SBA regenerated as a pair", [{ value: "yes", label: "Yes" }, { value: "no", label: "No, each on own endpoint" }])}
          {pmLocal ? <Button label="Copy shared analysis into local" onClick={copyPmShared} /> : null}
        </Grid>
        {pmLocal ? (
          <Grid columns={4} plain>
            {AN_IONS.map((d: IonDef) => inp("pm_w_" + d.k, `${d.short} (mg/L as ion)`))}
            {inp("pm_w_malk", "M-alkalinity (mg/L as CaCO₃)")}
            {inp("pm_w_ph", "pH")}
            {inp("pm_w_t", "Temperature (°C)")}
          </Grid>
        ) : sharedNote(pmCh)}
        {table([
          ["Product demand", fmt(pmDem * n("pm_hrs"), 0), "m³/day", null],
          ["Total cations (SAC load)", fmt(pmLoad.sac, 3), "eq/m³", null],
          ["Free mineral acidity, Cl + SO₄ + NO₃ + F (WBA load)", fmt(pmLoad.wba, 3), "eq/m³", null],
          ["CO₂ after SAC", fmt(pmCo2In, 1), "mg/L", null],
          ["SBA load: residual CO₂ + silica (+ PO₄)", fmt(pmLoad.sba, 3), "eq/m³", null],
          ["MB load: Na + silica leakage", fmt(pmLoad.mb, 4), "eq/m³", null],
          ["Average primary flow needed (demand + regen water)", fmt(pmQneed, 1), "m³/h", pmQ >= pmQneed ? { text: "Feed sufficient", tone: "success" } : { text: "Feed too low", tone: "danger" }],
        ])}
      </Fragment>
    );
  };

  return (
    <Page
      title="Water Treatment Calculator Suite"
      summary="Live water chemistry and process calculators built around one shared water analysis: ion balance, carbonate system, saturation indices, blending, RO, ion exchange, cooling towers, boilers, chlorination and wastewater. SI units throughout."
      width="wide"
    >
      <Segmented options={tabs} value={tab} onChange={(x: string) => setTab(x)} />
      {stOk ? (
        savedAt ? <Text>{`Autosaved at ${savedAt}`}</Text> : null
      ) : (
        <Callout tone="warning" lead="Browser storage unavailable.">
          Entries stay only while this page is open. Use Backup & transfer at the bottom of the page before you leave.
        </Callout>
      )}

      {/* ================= WATER ANALYSIS ================= */}
      {tab === "an" && (
        <Section
          heading="Shared water analysis"
          actions={
            <Fragment>
              <Button label="Reset to example" onClick={() => reset("a_")} />
              <Button label="Clear all saved inputs" onClick={() => setV(DEF)} />
            </Fragment>
          }
        >
          <Text>Every tab set to the shared analysis reads from these values. The example is a typical UK hard groundwater. Inputs are kept in this browser where storage is available.</Text>
          {anInputs("a_")}
        </Section>
      )}
      {tab === "an" && (
        <Section heading="Analysis summary">
          {table(summaryRows(chA))}
        </Section>
      )}
      {tab === "an" && (
        <Section heading="Full ion table">
          {anTable(chA)}
        </Section>
      )}

      {/* ================= WATER CHEMISTRY ================= */}
      {tab === "ch" && (
        <Section
          heading="Ion balance"
          actions={
            <Fragment>
              <Button label="Balance with Na" onClick={() => applyBal("a_", "na", chA)} />
              <Button label="Balance with Cl" onClick={() => applyBal("a_", "cl", chA)} />
            </Fragment>
          }
        >
          <Grid columns={4} plain>{inp("a_tol", "Acceptance tolerance (±%)")}</Grid>
          {table([
            ["Sum of cations", fmt(chA.cat, 3), "meq/L", null],
            ["Sum of anions (incl. M-alkalinity)", fmt(chA.ani, 3), "meq/L", null],
            ["Difference (cations − anions)", fmt(chA.cat - chA.ani, 3), "meq/L", null],
            ["Balance error", fmt(chA.err, 2), "%", balChk(chA)],
            ["Na needed to balance", fmt(Math.max(chA.ani - chA.cat, 0) * 22.99, 1), "mg/L added", chA.ani < chA.cat ? { text: "Cations already in excess – use Cl" } : null],
            ["Cl needed to balance", fmt(Math.max(chA.cat - chA.ani, 0) * 35.453, 1), "mg/L added", chA.cat < chA.ani ? { text: "Anions already in excess – use Na" } : null],
          ])}
          <Text>Balance error = (Σcations − Σanions) ÷ (Σcations + Σanions) × 100. The buttons add Na or Cl to the shared analysis to close the gap; they never reduce an ion.</Text>
        </Section>
      )}
      {tab === "ch" && (
        <Section heading="Carbonate system and alkalinity">
          <Table
            columns={["Alkalinity form (mg/L as CaCO₃)", "From P and M titration", "From pH speciation"]}
            align={["start", "end", "end"]}
            rows={[
              ["Hydroxide OH⁻", fmt(split.oh, 1), fmt(chA.oh * 50040, 2)],
              ["Carbonate CO₃²⁻", fmt(split.co3, 1), fmt(chA.co3 * 100087, 1)],
              ["Bicarbonate HCO₃⁻", fmt(split.hco3, 1), fmt(chA.hco3 * 50040, 1)],
              ["P-alkalinity", fmt(anA.palk, 1), fmt(chA.palkCalc, 2)],
              ["M-alkalinity", fmt(anA.malk, 1), fmt(anA.malk, 1)],
            ]}
          />
          {table([
            ["pK₁ / pK₂ at water temperature", `${fmt(-lgK1(anA.t + 273.15), 3)} / ${fmt(-lgK2(anA.t + 273.15), 3)}`, "–", null],
            ["Free CO₂", fmt(chA.co2 * 44010, 1), "mg/L", null],
            ["Total inorganic carbon (Cᴛ)", fmt(chA.ct * 1000, 3), "mmol/L", null],
            ["pH if CO₂ equilibrated with air", fmt(phAir, 2), "–", null],
          ])}
        </Section>
      )}
      {tab === "ch" && (
        <Section heading="Acid dosing and CO₂ degassing">
          <Grid columns={4} plain>
            {sel("cb_acid", "Acid", [{ value: "h2so4", label: "Sulphuric acid 96%" }, { value: "hcl", label: "Hydrochloric acid 33%" }])}
            {inp("cb_dose", "Acid dose (mg/L as 100%)")}
            {inp("cb_co2", "CO₂ after degasser (mg/L)")}
            {inp("cb_pht", "Target pH")}
            {inp("cb_q", "Water flow (m³/h)")}
          </Grid>
          {table([
            ["Alkalinity after acid dose", fmt(afterAcid.malk, 1), "mg/L as CaCO₃", afterAcid.malk < 0 ? { text: "Acid exceeds alkalinity – free mineral acidity", tone: "danger" } : null],
            ["pH after acid dose (CO₂ retained)", fmt(afterAcid.ph, 2), "–", null],
            ["Free CO₂ after acid dose", fmt(co2AcidMg, 1), "mg/L", null],
            ["LSI after acid dose", fmt(chAcid.lsi, 2), "–", lsiChk(chAcid.lsi)],
            ["pH after acid and degassing", fmt(phAcidDegas, 2), "–", null],
            ["pH after degassing only (no acid)", fmt(phDegas, 2), "–", null],
            [`Acid to reach pH ${fmt(n("cb_pht"), 1)}`, fmt(acidNeedMg, 1), "mg/L as 100%", acidNeedMg < 0 ? { text: "Target above current pH – alkali needed" } : null],
            ["Acid product rate", fmt((acidNeedMg * n("cb_q")) / 1000 / (acid.str / 100) / acid.sg, 2), `L/h of ${acid.label}`, null],
          ])}
          <Text>Acid converts alkalinity to CO₂ in a closed system (total carbonate unchanged). Degassing then strips CO₂ to the residual entered with alkalinity unchanged.</Text>
        </Section>
      )}
      {tab === "ch" && (
        <Section heading="Ionic strength and activity">
          {table([
            ["Ionic strength from ions", fmt(chA.I, 4), "mol/L", chA.I > 0.5 ? { text: "Above Davies validity (0.5)", tone: "warning" } : null],
            ["Ionic strength from TDS (2.5 × 10⁻⁵ × TDS)", fmt(chA.Itds, 4), "mol/L", null],
            ["Davies constant A at temperature", fmt(chA.A, 4), "–", null],
            ["Activity coefficient γ, monovalent", fmt(chA.g1, 3), "–", null],
            ["Activity coefficient γ, divalent", fmt(chA.g2, 3), "–", null],
            ["Activity coefficient γ, trivalent", fmt(chA.g3, 3), "–", null],
            ["LSI, simple (A, B, C, D method)", fmt(chA.lsi, 2), "–", lsiChk(chA.lsi)],
            ["LSI, activity-corrected (calcite SI)", fmt(chA.siCal, 2), "–", lsiChk(chA.siCal)],
            ["Difference", fmt(chA.siCal - chA.lsi, 2), "–", null],
          ])}
        </Section>
      )}
      {tab === "ch" && (
        <Section heading="Mineral saturation">
          {table(satRows(chA))}
          <Text>SI = log₁₀(ion activity product ÷ Ksp). Above 0 the water is supersaturated. Antiscalant limits differ by product, so check supplier software for allowable supersaturation.</Text>
        </Section>
      )}
      {tab === "ch" && (
        <Section heading="Amorphous silica solubility" caption="mg/L as SiO₂, by temperature and pH. Silicic acid pKa 9.83.">
          <Table
            columns={["Temperature", "pH 7.0", "pH 8.0", "pH 8.5", "pH 9.0", "pH 9.5", "pH 10.0"]}
            align={["start", "end", "end", "end", "end", "end", "end"]}
            rows={[10, 20, 30, 40, 60, 80].map((t: number) => [
              `${t} °C`,
              ...[7, 8, 8.5, 9, 9.5, 10].map((ph: number) => fmt(silS0(t + 273.15) * (1 + Math.pow(10, ph - 9.83) / chA.g1), 0)),
            ])}
          />
        </Section>
      )}
      {tab === "ch" && (
        <Section heading="Iron and manganese oxidation">
          <Grid columns={4} plain>
            {srcSel("fm_src")}
            {v.fm_src === "local" ? inp("fm_fe", "Iron Fe²⁺ (mg/L)") : null}
            {v.fm_src === "local" ? inp("fm_mn", "Manganese Mn²⁺ (mg/L)") : null}
            {inp("fm_dem", "Other oxidant demand (mg/L)")}
            {inp("fm_q", "Water flow (m³/h)")}
            {inp("fm_str", "NaOCl strength (g/L available Cl₂)")}
          </Grid>
          <Table
            columns={["Oxidant", "mg per mg Fe", "mg per mg Mn", "Dose (mg/L)", "kg/day"]}
            align={["start", "end", "end", "end", "end"]}
            rows={OXID.map((o: { label: string; fe: number; mn: number }) => {
              const d = o.fe * fmFe + o.mn * fmMn + n("fm_dem");
              return [o.label, fmt(o.fe, 2), fmt(o.mn, 2), fmt(d, 2), fmt((d * n("fm_q") * 24) / 1000, 2)];
            })}
          />
          {table([
            ["Fe and Mn treated", `${fmt(fmFe, 2)} / ${fmt(fmMn, 2)}`, "mg/L", null],
            ["Sodium hypochlorite for chlorine route", fmt(((0.64 * fmFe + 1.29 * fmMn + n("fm_dem")) * n("fm_q")) / n("fm_str"), 3), "L/h", null],
            ["Fe(OH)₃ sludge", fmt((1.91 * fmFe * n("fm_q") * 24) / 1000, 2), "kg/day", null],
            ["MnO₂ sludge", fmt((1.58 * fmMn * n("fm_q") * 24) / 1000, 2), "kg/day", null],
          ])}
          <Text>Air oxidises iron quickly above about pH 7, but manganese only above about pH 9.5 or on catalytic media. Permanganate overdose turns water pink, so dose to demand.</Text>
        </Section>
      )}
      {tab === "ch" && (
        <Section heading="Water chemistry: formulas and sources" collapsible defaultOpen={false}>
          <Equation>{"I = ½ Σ cᵢ zᵢ²     log γ = −A z² "}<Frac num="√I" den="1 + √I" />{" + 0.3 A z² I  (Davies)"}</Equation>
          <Equation>{"[HCO₃⁻] = "}<Frac num="Alk − [OH⁻] + [H⁺]" den="1 + 2 K₂ γ₁ ⁄ ({H⁺} γ₂)" />{"     CO₂ = "}<Frac num="{H⁺} γ₁ [HCO₃⁻]" den="K₁" /></Equation>
          <Equation>{"SI = log₁₀ "}<Frac num="IAP" den="Ksp(T)" />{"     Calcite IAP = γ₂[Ca²⁺] · γ₂[CO₃²⁻]"}</Equation>
          <Equation>{"pHp = "}<Frac num="11.75 − log Ca − log PO₄ − 2 log T" den="0.65" />{"  (Ca as CaCO₃, PO₄ mg/L, T °C)"}</Equation>
          <Text>Carbonate constants K₁, K₂, K_H and calcite Ksp: Plummer and Busenberg (1982). Kw: Harned-Owen fit. Gypsum, barite and fluorite Ksp: PHREEQC phreeqc.dat analytical expressions. Celestite: log K −6.63 at 25 °C with van 't Hoff correction (ΔH −16.9 kJ/mol). Amorphous silica: log S = 4.52 − 731/T (Fournier and Rowe), raised by ionisation above pH 8. Calcium phosphate: Green and Holmes practical pHp index. Davies A from the dielectric constant of water. Fe/Mn oxidant ratios are standard stoichiometric values.</Text>
          <Text>Simplifications: ion pairs (CaSO₄⁰, CaHCO₃⁺, MgSO₄⁰) are not modelled, so SI for sulphate and carbonate minerals reads somewhat high at high sulphate or high TDS. Alkalinity is treated as carbonate alkalinity. Air equilibrium uses 420 ppm CO₂. Use a full speciation model (e.g. PHREEQC) for brines and final designs.</Text>
        </Section>
      )}

      {/* ================= SCALING INDICES ================= */}
      {tab === "si" && (
        <Section heading="Scaling and corrosion indices: inputs" actions={resetBtn("si_")}>
          <Grid columns={4} plain>{srcSel("si_src")}</Grid>
          {v.si_src === "shared" ? sharedNote(siCh) : null}
          {v.si_src === "local" ? (
            <Grid columns={4} plain>
              {inp("si_ph", "pH")}
              {inp("si_t", "Temperature (°C)")}
              {sel("si_mode", "TDS from", [{ value: "tds", label: "TDS (mg/L)" }, { value: "ec", label: "Conductivity (µS/cm)" }])}
              {v.si_mode === "ec" ? inp("si_ec", "Conductivity (µS/cm)") : inp("si_tds", "TDS (mg/L)")}
              {v.si_mode === "ec" ? inp("si_k", "TDS factor (mg/L per µS/cm)") : null}
              {inp("si_ca", "Calcium hardness (mg/L as CaCO₃)")}
              {inp("si_alk", "M-alkalinity (mg/L as CaCO₃)")}
              {inp("si_cl", "Chloride (mg/L as Cl)")}
              {inp("si_so4", "Sulphate (mg/L as SO₄)")}
            </Grid>
          ) : null}
        </Section>
      )}
      {tab === "si" && (
        <Section heading="Scaling and corrosion indices: results">
          {table([
            ["TDS used", fmt(siCh.tds, 0), "mg/L", null],
            ["Ionic strength", fmt(siCh.I, 4), "mol/L", null],
            ["pH of saturation (pHs)", fmt(siCh.pHs, 2), "–", null],
            ["Langelier Saturation Index (LSI)", fmt(siCh.lsi, 2), "–", lsiChk(siCh.lsi)],
            ["LSI, activity-corrected (calcite SI)", fmt(siCh.siCal, 2), "–", lsiChk(siCh.siCal)],
            ["Ryznar Stability Index (RSI)", fmt(siCh.rsi, 2), "–", rsiChk(siCh.rsi)],
            ["Equilibrium pH (Puckorius)", fmt(siCh.pHeq, 2), "–", null],
            ["Puckorius Scaling Index (PSI)", fmt(siCh.psi, 2), "–", psiChk(siCh.psi)],
            ["Larson-Skold Index", fmt(siCh.ls, 2), "–", lsChk],
            ["Aggressive Index (AWWA)", fmt(siCh.ai, 2), "–", aiChk],
          ])}
        </Section>
      )}
      {tab === "si" && (
        <Section heading="Indices across temperature" caption="Same water heated, e.g. heat exchanger skin or boiler feed.">
          <Table
            columns={["Temperature (°C)", "pHs", "LSI (simple)", "LSI (activity)", "RSI"]}
            align={["start", "end", "end", "end", "end"]}
            rows={sweep.map((t: number) => {
              const c = chem({ ...siAn, t });
              const lc = lsiChk(c.lsi), ac = lsiChk(c.siCal), rc = rsiChk(c.rsi);
              return [
                fmt(t, 0),
                fmt(c.pHs, 2),
                lc && lc.tone ? { text: `${fmt(c.lsi, 2)} · ${lc.text}`, tone: lc.tone } : fmt(c.lsi, 2),
                ac && ac.tone ? { text: fmt(c.siCal, 2), tone: ac.tone } : fmt(c.siCal, 2),
                rc && rc.tone ? { text: `${fmt(c.rsi, 2)} · ${rc.text}`, tone: rc.tone } : fmt(c.rsi, 2),
              ];
            })}
          />
        </Section>
      )}
      {tab === "si" && (
        <Section heading="Indices: formulas and bands" collapsible defaultOpen={false}>
          <Equation>{"pHs = (9.3 + A + B) − (C + D)"}</Equation>
          <Text>A = (log₁₀ TDS − 1)/10; B = −13.12 × log₁₀(T °C + 273) + 34.55; C = log₁₀(Ca as CaCO₃) − 0.4; D = log₁₀(M-alk as CaCO₃).</Text>
          <Equation>{"LSI = pH − pHs     RSI = 2 pHs − pH     PSI = 2 pHs − pHeq,  pHeq = 1.465 log₁₀(Alk) + 4.54"}</Equation>
          <Equation>{"Larson-Skold = "}<Frac num="Cl⁻ (meq/L) + SO₄²⁻ (meq/L)" den="HCO₃⁻ + CO₃²⁻ (meq/L)" />{"     AI = pH + log₁₀(Ca × Alk)"}</Equation>
          <Table
            columns={["Index", "Scale forming", "Balanced", "Corrosive"]}
            rows={[
              ["LSI", "> +0.5", "−0.5 to +0.5", "< −0.5"],
              ["RSI", "< 6.0", "6.0–7.0", "> 7.0 (heavy > 7.5)"],
              ["PSI", "< 6.0", "6.0–7.0", "> 7.0"],
              ["Larson-Skold", "–", "< 0.8", "0.8–1.2 moderate, > 1.2 high"],
              ["Aggressive Index", "–", "≥ 12", "10–12 moderate, < 10 very"],
            ]}
          />
          <Text>The activity-corrected LSI is the calcite saturation index from Davies activities and temperature-dependent constants; it is the better figure above about 2,000 mg/L TDS. Local inputs are charge-balanced with Na or Cl to estimate ionic strength.</Text>
        </Section>
      )}

      {/* ================= BLEND & CONCENTRATE ================= */}
      {tab === "bl" && (
        <Section heading="Blend or concentrate the shared analysis" actions={resetBtn("bl_")}>
          <Grid columns={4} plain>
            {sel("bl_mode", "Operation", [{ value: "blend", label: "Blend water A with water B" }, { value: "cycles", label: "Concentrate by cycles (cooling)" }, { value: "ro", label: "Concentrate by RO recovery" }])}
            {blMode === "blend" ? inp("bl_pa", "Water A in blend (%)") : null}
            {blMode === "cycles" ? inp("bl_coc", "Cycles of concentration") : null}
            {blMode === "cycles" ? sel("bl_phmode", "Concentrated pH", [{ value: "enter", label: "Enter measured pH" }, { value: "air", label: "CO₂ in equilibrium with air" }]) : null}
            {blMode === "cycles" && v.bl_phmode === "enter" ? inp("bl_phv", "pH of concentrated water") : null}
            {blMode === "ro" ? inp("bl_R", "Recovery (%)") : null}
            {blMode === "ro" ? inp("bl_rej", "Salt rejection (%)") : null}
            {blMode !== "blend" ? inp("bl_t", "Temperature of result (°C)") : null}
          </Grid>
          <Text>Water A is the shared analysis. Blends conserve total carbonate and solve pH; RO concentrate keeps feed CO₂ (it passes the membrane); cooling water uses a measured pH or air-equilibrium CO₂.</Text>
        </Section>
      )}
      {tab === "bl" && blMode === "blend" && (
        <Section heading="Water B analysis" collapsible defaultOpen={false} actions={resetBtn("b_")}>
          {anInputs("b_")}
        </Section>
      )}
      {tab === "bl" && (
        <Section heading="Resulting water">
          <Table
            columns={blMode === "blend" ? ["Parameter", "Water A", "Water B", "Result"] : ["Parameter", "Water A", "Result"]}
            align={blMode === "blend" ? ["start", "end", "end", "end"] : ["start", "end", "end"]}
            rows={[
              ...AN_IONS.map((d: IonDef) => {
                const r = [d.label + " (mg/L)", fmt(anA.ion[d.k] || 0, 2)];
                if (blMode === "blend") r.push(fmt(anB.ion[d.k] || 0, 2));
                r.push(fmt(blAn.ion[d.k] || 0, 2));
                return r;
              }),
              ...[
                ["M-alkalinity (mg/L as CaCO₃)", fmt(anA.malk, 1), fmt(anB.malk, 1), fmt(blAn.malk, 1)],
                ["Total hardness (mg/L as CaCO₃)", fmt(chA.hard, 0), fmt(chB.hard, 0), fmt(blCh.hard, 0)],
                ["TDS (mg/L)", fmt(chA.tds, 0), fmt(chB.tds, 0), fmt(blCh.tds, 0)],
                ["Free CO₂ (mg/L)", fmt(chA.co2 * 44010, 1), fmt(chB.co2 * 44010, 1), fmt(blCh.co2 * 44010, 1)],
                ["pH", fmt(anA.ph, 2), fmt(anB.ph, 2), fmt(blAn.ph, 2)],
                ["Temperature (°C)", fmt(anA.t, 1), fmt(anB.t, 1), fmt(blAn.t, 1)],
                ["Ion balance error (%)", fmt(chA.err, 2), fmt(chB.err, 2), fmt(blCh.err, 2)],
              ].map((r: string[]) => (blMode === "blend" ? r : [r[0], r[1], r[3]])),
            ]}
          />
        </Section>
      )}
      {tab === "bl" && (
        <Section heading="Indices and saturation of the result">
          {table([
            ...satRows(blCh),
            ["Puckorius index", fmt(blCh.psi, 2), "–", psiChk(blCh.psi)],
            ["Larson-Skold index", fmt(blCh.ls, 2), "–", null],
            ["Ionic strength", fmt(blCh.I, 4), "mol/L", null],
          ])}
          <Text>{blWarn === 0 ? "No scaling warnings for the resulting water." : `${blWarn} saturation or index warnings for the resulting water; see the check column.`}</Text>
        </Section>
      )}

      {/* ================= ION EXCHANGE ================= */}
      {tab === "ix" && (
        <Section heading="Ion exchange: inputs" actions={resetBtn("ix_")}>
          <Grid columns={4} plain>
            {sel("ix_type", "Resin / duty", opts(RESIN), (x: string) => {
              const p = RESIN[x];
              if (p) setMany({ ix_type: x, ix_cap: p.cap, ix_regen: p.regen, ix_dose: p.dose, ix_str: p.str, ix_sg: p.sg });
            })}
            {srcSel("ix_src")}
            {ixShared ? null : inp("ix_load", "Ionic load (mg/L as CaCO₃)")}
            {ixShared && (v.ix_type === "sba1" || v.ix_type === "sba2") ? sel("ix_degas", "Degasser before anion", [{ value: "yes", label: "Yes" }, { value: "no", label: "No – all CO₂ to anion" }]) : null}
            {ixShared && (v.ix_type === "sba1" || v.ix_type === "sba2") && v.ix_degas === "yes" ? inp("ix_co2", "Residual CO₂ after degasser (mg/L)") : null}
            {inp("ix_vol", "Resin volume (L)")}
            {inp("ix_cap", "Operating capacity (eq/L)")}
            {inp("ix_margin", "Design margin (%)")}
            {inp("ix_flow", "Service flow (m³/h)")}
            {inp("ix_dia", "Vessel diameter (m)")}
            {sel("ix_regen", "Regenerant", opts(REGEN))}
            {inp("ix_dose", "Regen level (g/L resin, 100%)")}
            {inp("ix_str", "Product strength (% w/w)")}
            {inp("ix_sg", "Product SG")}
            {inp("ix_rinse", "Backwash + rinse (BV)")}
            {inp("ix_hours", "Operating hours/day")}
            {inp("ix_days", "Operating days/year")}
          </Grid>
          <Text>{`Load for this duty: ${rp.load}.${ixShared ? ` From the shared analysis: ${fmt(ixLoad, 0)} mg/L as CaCO₃.` : ""} NaCl defaults to saturated brine (26%, SG 1.2).`}</Text>
        </Section>
      )}
      {tab === "ix" && (
        <Section heading="Ionic load (eq/L)" caption="Units: meq/L = eq/m³ of water. eq/L of water = meq/L ÷ 1000. Resin operating capacity is eq per litre of RESIN.">
          <Callout tone="info" lead={`Ionic load on ${rp.label}: ${fmt(loadEq, 3)} eq/m³ = ${fmt(loadEq, 3)} meq/L = ${fmt(loadEq / 1000, 6)} eq/L of water (${fmt(ixLoad, 1)} mg/L as CaCO₃).`}>
            {`Load basis: ${ixShared ? rp.load : "local ionic load entered in Ion exchange: inputs"}${ixShared ? (ixIonShared ? ", from the shared water analysis" : ", from the local ion analysis below") : ""}.`}
          </Callout>
          <Callout tone="success" lead={`Throughput per regeneration: ${fmt(thr, 1)} m³ (${fmt(runH, 1)} h at ${fmt(ixQ, 1)} m³/h).`}>
            {`Throughput (m³) = resin volume (L) × operating capacity (eq/L resin) × (1 − margin) ÷ ionic load (eq/m³ water) = ${fmt(ixV, 0)} L × ${fmt(ixCap, 2)} eq/L × (1 − ${fmt(n("ix_margin"), 0)}%) ÷ ${fmt(loadEq, 3)} eq/m³ = ${fmt(capTot, 0)} eq ÷ ${fmt(loadEq, 3)} eq/m³ = ${fmt(thr, 1)} m³. (Same as ${fmt(capTot, 0)} eq ÷ ${fmt(loadEq / 1000, 6)} eq/L water = ${fmt(thr * 1000, 0)} L.)`}
          </Callout>
          <Grid columns={4} plain>
            {sel("ix_isrc", "Ion data for this table", [{ value: "shared", label: "Shared water analysis" }, { value: "local", label: "Local ion analysis (override)" }])}
            {v.ix_isrc === "local" ? <Button label="Copy shared analysis into local" onClick={copyIxShared} /> : null}
          </Grid>
          {v.ix_isrc === "local" ? (
            <Grid columns={4} plain>
              {AN_IONS.map((d: IonDef) => inp("ix_i_" + d.k, `${d.short} (mg/L as ion)`))}
              {inp("ix_i_malk", "M-alkalinity (mg/L as CaCO₃)")}
              {inp("ix_i_ph", "pH")}
              {inp("ix_i_t", "Temperature (°C)")}
            </Grid>
          ) : null}
          <Table
            columns={["Ion", "mg/L as ion", "Eq. weight (g/eq)", "mg/L as CaCO₃", "meq/L", "eq/m³", "SAC", "WAC", "SBA", "WBA"]}
            align={["start", "end", "end", "end", "end", "end", "start", "start", "start", "start"]}
            rows={ixIonRows.map((r: IxIon) => [r.name, fmt(r.mg, 2), fmt(r.ew, 2), fmt(r.meq * 50.04, 1), fmt(r.meq, 3), fmt(r.meq, 3), r.sac, r.wac, r.sba, r.wba])}
          />
          <Table
            columns={["Total", "meq/L", "eq/m³", "eq/L water", "mg/L as CaCO₃", "Loads"]}
            align={["start", "end", "end", "end", "end", "start"]}
            rows={ixTotRows.map((r: [string, number, string]) => [r[0], fmt(r[1], 3), fmt(r[1], 3), fmt(r[1] / 1000, 6), fmt(r[1] * 50.04, 1), r[2]])}
          />
          <Text>{`Ion balance: cations ${fmt(ixCh.cat, 2)} vs anions ${fmt(ixCh.ani, 2)} meq/L (${fmt(ixCh.err, 1)}%). Bicarbonate, carbonate, hydroxide and free CO₂ are speciated from M-alkalinity, pH ${fmt(ixAn.ph, 2)} and ${fmt(ixAn.t, 1)} °C. CO₂ and SiO₂ load anion resin as monovalent species (× 1.137 and × 0.833 to mg/L as CaCO₃). WAC removes only hardness associated with alkalinity; WBA removes only free mineral acidity.`}</Text>
          <Grid columns={4} plain>
            {sel("ix_cv_ion", "Converter: ion", IONS.map((x: { k: string; label: string; ew: number }) => ({ value: x.k, label: x.label })))}
            {inp("ix_cv_val", "Concentration (mg/L)")}
            {sel("ix_cv_basis", "Entered as", [{ value: "ion", label: "mg/L as ion" }, { value: "caco3", label: "mg/L as CaCO₃" }])}
          </Grid>
          {table([
            ["Equivalent weight", fmt(cvIon.ew, 2), "g/eq", null],
            ["mg/L as ion", fmt(cvMeq * cvIon.ew, 2), "mg/L", null],
            ["mg/L as CaCO₃", fmt(cvMeq * 50.04, 2), "mg/L as CaCO₃", null],
            ["meq/L (= eq/m³)", fmt(cvMeq, 4), "meq/L", null],
            ["eq/L of water", fmt(cvMeq / 1000, 7), "eq/L", null],
          ])}
        </Section>
      )}
      {tab === "ix" && ixShared && (
        <Section heading="Ionic loads for each resin duty" collapsible defaultOpen={false}>
          <Table
            columns={["Duty", "Load (mg/L as CaCO₃)", "eq/m³"]}
            align={["start", "end", "end"]}
            rows={Object.keys(RESIN).map((k: string) => [RESIN[k].label, fmt(ixLoads[k], 0), fmt(ixLoads[k] / 50.04, 2)])}
          />
        </Section>
      )}
      {tab === "ix" && (
        <Section heading="Ion exchange: results">
          {table([
            ["Ionic load", fmt(loadEq, 2), "eq/m³ (meq/L)", null],
            ["Usable capacity per cycle", fmt(capTot, 0), "eq", null],
            ["Usable capacity per cycle", fmt((capTot * 50) / 1000, 1), "kg as CaCO₃", null],
            ["Throughput per regeneration", fmt(thr, 1), "m³", null],
            ["Run time between regenerations", fmt(runH, 1), "h", range(runH, 8, 1e9, "OK", "Short run – frequent regens", "")],
            ["Specific flow", fmt(bvh, 1), "BV/h", bvhChk(bvh)],
            ["Linear velocity", fmt(vel, 1), "m/h", velChk(vel)],
            ["Bed depth", fmt(depth, 2), "m", depthChk(depth)],
            [`Regenerant per regen (100% ${rg.short})`, fmt(regPure, 1), "kg", null],
            ["Regenerant product per regen", fmt(regProdKg, 1), `kg at ${fmt(n("ix_str"), 0)}%`, null],
            ["Regenerant product per regen", fmt(regProdL, 0), "L", null],
            ["Regenerant ratio", fmt(ratio, 2), "× stoichiometric", ratio < 1 ? { text: "Below stoichiometric", tone: "danger" } : null],
            ["Regeneration efficiency", fmt(eff, 0), "%", null],
            ["Regenerant per m³ treated (100%)", fmt((regPure / thr) * 1000, 0), "g/m³", null],
            ["Regen water per cycle", fmt(rinseM3, 1), "m³", range(selfUse, 0, 10, `${fmt(selfUse, 1)}% of throughput`, "", `${fmt(selfUse, 1)}% of throughput – high`)],
            ["Regenerations per year", fmt(regensYr, 0), "per year", null],
            ["Regenerant per year (100%)", fmt((regensYr * regPure) / 1000, 2), "tonnes", null],
            ["Regenerant product per year", fmt((regensYr * regProdL) / 1000, 1), "m³", null],
          ])}
        </Section>
      )}
      {tab === "ix" && (
        <Section heading="Ion exchange: size for a target run">
          <Grid columns={4} plain>
            {inp("ix_target", "Target throughput per regen (m³)")}
            {inp("ix_vdes", "Design linear velocity (m/h)")}
          </Grid>
          {table([
            ["Run length at service flow", fmt(n("ix_target") / ixQ, 1), "h", null],
            ["Resin volume required", fmt(vReq, 0), "L", null],
            ["Resin volume required", fmt(vReq / 1000, 2), "m³", null],
            ["Vessel diameter for design velocity", fmt(dReq, 2), "m", null],
            ["Resulting bed depth", fmt(depthReq, 2), "m", depthChk(depthReq)],
            ["Specific flow at that volume", fmt((ixQ * 1000) / vReq, 1), "BV/h", bvhChk((ixQ * 1000) / vReq)],
          ])}
        </Section>
      )}
      {tab === "ix" && (
        <Section heading="Typical operating capacities" caption="Typical guide values only; confirm with the resin manufacturer's design software." collapsible defaultOpen={false}>
          <Table
            columns={["Resin / duty", "Regeneration level (100% basis)", "Operating capacity (eq/L)"]}
            align={["start", "start", "end"]}
            rows={[
              ["SAC Na-form softening, co-flow", "NaCl 60 g/L", "0.70–0.80"],
              ["SAC Na-form softening, co-flow", "NaCl 100 g/L", "0.90–1.00"],
              ["SAC Na-form softening, co-flow", "NaCl 150 g/L", "1.05–1.15"],
              ["SAC Na-form softening, co-flow", "NaCl 240 g/L", "1.30–1.40"],
              ["SAC H-form, co-flow", "HCl 60–100 g/L", "0.8–1.2"],
              ["SAC H-form, co-flow", "H₂SO₄ 80–150 g/L, stepwise", "0.6–0.9"],
              ["SAC H-form, counter-flow", "HCl 40–60 g/L", "1.1–1.4"],
              ["WAC, H-form", "HCl 105–110% of stoichiometric", "1.5–2.5"],
              ["SBA Type I, co-flow", "NaOH 60–100 g/L", "0.35–0.50"],
              ["SBA Type I, counter-flow", "NaOH 40–60 g/L", "0.45–0.60"],
              ["SBA Type II", "NaOH 50–80 g/L", "0.50–0.70"],
              ["WBA", "NaOH 120–140% of stoichiometric", "0.9–1.4"],
              ["Mixed bed, anion component", "NaOH 80–120 g/L", "0.25–0.40"],
            ]}
          />
          <Text>1 eq/L = 50 g CaCO₃ per litre of resin = 21.8 kgr/ft³ as CaCO₃.</Text>
        </Section>
      )}
      {tab === "ix" && (
        <Section heading="Ion exchange: formulas" collapsible defaultOpen={false}>
          <Equation>{"Throughput (m³) = "}<Frac num="V (L) × OC (eq/L) × (1 − margin)" den="load (eq/m³ = meq/L = mg/L as CaCO₃ ÷ 50.04)" /></Equation>
          <Equation>{"BV/h = "}<Frac num="Q (m³/h) × 1000" den="V (L)" />{"     Linear velocity (m/h) = "}<Frac num="Q (m³/h)" den="π D² ÷ 4" /></Equation>
          <Equation>{"Regenerant ratio = "}<Frac num="regen level (g/L) ÷ equivalent weight" den="OC (eq/L)" />{"     Efficiency (%) = 100 ÷ ratio"}</Equation>
          <Text>Equivalent weights: NaCl 58.44, HCl 36.46, H₂SO₄ 49.04, NaOH 40.00. Anion load includes CO₂ × 1.137 and SiO₂ × 0.833 as CaCO₃; without a degasser all carbonate reaches the anion unit as CO₂. Typical limits used: 5–40 BV/h, 5–40 m/h, minimum bed depth 0.75 m.</Text>
        </Section>
      )}

      {/* ================= REVERSE OSMOSIS ================= */}
      {tab === "ro" && (
        <Section heading="Reverse osmosis: current operation" actions={resetBtn("ro_")}>
          <Grid columns={4} plain>
            {srcSel("ro_src")}
            {inp("ro_qf", "Feed flow (m³/h)")}
            {inp("ro_qp", "Permeate flow (m³/h)")}
            {roShared ? null : inp("ro_cf", "Feed TDS (mg/L)")}
            {inp("ro_cp", "Permeate TDS (mg/L)")}
            {inp("ro_pf", "Feed pressure (bar g)")}
            {inp("ro_pc", "Concentrate pressure (bar g)")}
            {inp("ro_pp", "Permeate pressure (bar g)")}
            {inp("ro_t", "Feed temperature (°C)")}
            {inp("ro_n", "Number of elements")}
            {inp("ro_area", "Area per element (m²)")}
            {inp("ro_epv", "Elements per vessel")}
            {inp("ro_stages", "Number of stages")}
            {sel("ro_type", "Feed water type", opts(RO_TYPES))}
            {inp("ro_jt", "Target design flux (LMH)")}
            {inp("ro_k", "TCF constant K")}
            {inp("ro_pi", "Osmotic coeff. (bar per mg/L)")}
          </Grid>
          {roShared ? <Text>{`Feed chemistry from the shared analysis (TDS ${fmt(roCf, 0)} mg/L), at the feed temperature entered here.`}</Text> : null}
        </Section>
      )}
      {tab === "ro" && (
        <Section heading="Reverse osmosis: baseline (start-up or after cleaning)">
          <Grid columns={4} plain>
            {inp("ro_bqf", "Feed flow (m³/h)")}
            {inp("ro_bqp", "Permeate flow (m³/h)")}
            {inp("ro_bcf", "Feed TDS (mg/L)")}
            {inp("ro_bcp", "Permeate TDS (mg/L)")}
            {inp("ro_bpf", "Feed pressure (bar g)")}
            {inp("ro_bpc", "Concentrate pressure (bar g)")}
            {inp("ro_bpp", "Permeate pressure (bar g)")}
            {inp("ro_bt", "Temperature (°C)")}
          </Grid>
        </Section>
      )}
      {tab === "ro" && (
        <Section heading="Reverse osmosis: performance">
          {table([
            ["Recovery", fmt(ra.R * 100, 1), "%", null],
            ["Concentrate flow", fmt(ra.qc, 2), "m³/h", null],
            ["Salt rejection", fmt(rej, 2), "%", range(rej, 98, 101, "Good (≥ 98%)", rej >= 95 ? "Fair (95–98%)" : "Poor (< 95%)", "", rej >= 95 ? "warning" : "danger")],
            ["Salt passage", fmt(ra.sp, 2), "%", null],
            ["Concentrate TDS (mass balance)", fmt(ra.cc, 0), "mg/L", null],
            ["Concentration factor (actual / ideal)", `${fmt(ra.cc / roCf, 2)} / ${fmt(1 / (1 - ra.R), 2)}`, "×", null],
            ["Average feed-concentrate TDS (log mean)", fmt(ra.cfc, 0), "mg/L", null],
            ["Osmotic pressure, feed-concentrate avg.", fmt(osm(ra.cfc, roT), 2), "bar", null],
            ["Net driving pressure", fmt(ra.ndp, 2), "bar", ra.ndp <= 0 ? { text: "Feed pressure too low", tone: "danger" } : null],
            ["Average flux", fmt(flux, 1), "LMH", range(flux, 0, rtype.hi, `Within guide (${rtype.lo}–${rtype.hi} LMH)`, "", `Above guide ${rtype.lo}–${rtype.hi} LMH`)],
            ["Specific flux at 25 °C", fmt(flux / (ra.ndp * ra.tcf), 2), "LMH/bar", null],
            ["Temperature correction factor", fmt(ra.tcf, 3), "–", null],
            ["Differential pressure per stage", fmt(dpStage, 2), "bar", range(dpStage, 0, 3.5, "OK", "", "High – above about 3.5 bar per vessel", "warning", "danger")],
          ])}
        </Section>
      )}
      {tab === "ro" && (
        <Section heading="Reverse osmosis: normalised data (vs baseline)">
          {table([
            ["Normalised permeate flow", fmt(npf, 2), "m³/h", range(npfChg, -10, 1e9, `${fmt(npfChg, 1)}% vs baseline`, `${fmt(npfChg, 1)}% – clean (≥ 10% drop)`, "")],
            ["Normalised salt passage", fmt(nsp, 2), "%", range(nspChg, -1e9, 10, `${fmt(nspChg, 1)}% vs baseline`, "", `+${fmt(nspChg, 1)}% – investigate (≥ 10% rise)`)],
            ["Normalised differential pressure", fmt(dpNorm, 2), "bar", range(dpChg, -1e9, 15, `${fmt(dpChg, 1)}% vs baseline`, "", `+${fmt(dpChg, 1)}% – clean (≥ 15% rise)`)],
            ["Baseline NDP / current NDP", `${fmt(rb.ndp, 2)} / ${fmt(ra.ndp, 2)}`, "bar", null],
          ])}
        </Section>
      )}
      {tab === "ro" && (
        <Section heading="Reverse osmosis: sizing and concentrate scaling">
          <Grid columns={4} plain>
            {roShared ? null : inp("ro_ca", "Feed Ca hardness (mg/L as CaCO₃)")}
            {roShared ? null : inp("ro_alk", "Feed M-alkalinity (mg/L as CaCO₃)")}
            {roShared ? null : inp("ro_ph", "Feed pH")}
            {roShared ? null : inp("ro_sio2", "Feed silica (mg/L SiO₂)")}
            {inp("ro_lsimax", "Max concentrate LSI with antiscalant")}
          </Grid>
          {table([
            ["Elements for target flux", fmt(Math.ceil(nReq), 0), "elements", null],
            ["Pressure vessels needed", fmt(vesReq, 0), `vessels of ${fmt(n("ro_epv"), 0)}`, null],
            ["Ion concentration factor (at measured rejection)", fmt((1 - ra.R * (1 - rejF)) / (1 - ra.R), 2), "×", null],
            ["Concentrate pH (feed CO₂ retained)", fmt(roConc.ph, 2), "–", null],
            ["Concentrate TDS (from analysis)", fmt(roConcCh.tds, 0), "mg/L", null],
            ...satRows(roConcCh),
            ["Max recovery for LSI limit", fmt(rMaxLsi * 100, 0), "%", null],
            ["Max recovery for silica (no inhibitor)", fmt(rMaxSil * 100, 0), "%", null],
          ])}
        </Section>
      )}
      {tab === "ro" && (
        <Section heading="Reverse osmosis: formulas" collapsible defaultOpen={false}>
          <Equation>{"TCF = exp[ K × (1/298 − 1/(273 + T)) ]"}</Equation>
          <Equation>{"NDP = P_feed − ΔP/2 − P_perm − (π_fc − π_perm)"}</Equation>
          <Equation>{"C_fc = C_f × "}<Frac num="ln(1 ÷ (1 − R))" den="R" />{"     NPF = Q_p × "}<Frac num="NDP_ref" den="NDP" />{" × "}<Frac num="TCF_ref" den="TCF" /></Equation>
          <Equation>{"NSP = SP × "}<Frac num="NDP" den="NDP_ref" />{" × "}<Frac num="(C_fc ÷ C_f)_ref" den="C_fc ÷ C_f" />{"     ΔP_norm = ΔP × "}<Pow base="((Q_f + Q_c)_ref ÷ (Q_f + Q_c))" exp="1.5" /></Equation>
          <Equation>{"Concentrate factor = "}<Frac num="1 − R (1 − rejection)" den="1 − R" /></Equation>
          <Text>Osmotic pressure is estimated as coefficient × TDS × (T + 273)/298. K is typically 2640–3020 depending on membrane. Concentrate chemistry runs the full analysis through the chemistry engine with feed CO₂ carried into the concentrate, then reports activity-corrected saturation for each mineral. Cleaning triggers follow the common 10% NPF drop, 10% salt passage rise or 15% ΔP rise rule.</Text>
        </Section>
      )}

      {/* ================= COOLING TOWERS ================= */}
      {tab === "ct" && (
        <Section heading="Cooling towers: inputs" actions={resetBtn("ct_")}>
          <Grid columns={4} plain>
            {inp("ct_circ", "Recirculation rate (m³/h)")}
            {inp("ct_dt", "Range ΔT (°C)")}
            {inp("ct_k", "Evaporation factor (per °C)")}
            {inp("ct_drift", "Drift (% of recirculation)")}
            {sel("ct_mode", "Cycles from", [{ value: "cycles", label: "Enter cycles" }, { value: "cond", label: "Conductivity or chloride ratio" }])}
            {v.ct_mode === "cond" ? inp("ct_ecm", "Make-up conductivity or Cl") : inp("ct_coc", "Cycles of concentration")}
            {v.ct_mode === "cond" ? inp("ct_ect", "Tower water conductivity or Cl") : null}
            {inp("ct_vol", "System volume (m³)")}
            {inp("ct_inh", "Inhibitor dose (mg/L product)")}
            {inp("ct_inhsg", "Inhibitor SG")}
            {inp("ct_bio", "Biocide slug dose (mg/L product)")}
            {inp("ct_biosg", "Biocide SG")}
            {inp("ct_hours", "Operating hours/year")}
            {inp("ct_tcoc", "Target cycles (comparison)")}
            {inp("ct_price", "Water + effluent cost (£/m³)")}
          </Grid>
        </Section>
      )}
      {tab === "ct" && (
        <Section heading="Cooling towers: water balance and dosing">
          {table([
            ["Cycles of concentration", fmt(coc, 2), "×", range(coc, 3, 8, "Typical 3–8", "Low – water inefficient", "High – check scaling indices")],
            ["Evaporation", fmt(evap, 2), "m³/h", null],
            ["Evaporation", fmt((evap / circ) * 100, 2), "% of recirculation", null],
            ["Drift loss", fmt(drift, 3), "m³/h", null],
            ["Bleed-off (controlled blowdown)", fmt(bleed, 2), "m³/h", bleed < 0 ? { text: "Drift exceeds required blowdown", tone: "danger" } : null],
            ["Total blowdown (bleed + drift)", fmt(bdTot, 2), "m³/h", null],
            ["Make-up", fmt(mu, 2), "m³/h", null],
            ["Make-up per year", fmt(mu * n("ct_hours"), 0), "m³", null],
            ["Half-life / holding time index", fmt(hti, 1), "h", null],
            ["Time to 90% of new equilibrium", fmt(t90, 1), "h", null],
            ["Inhibitor product use", fmt(inhKg, 2), "kg/day", null],
            ["Inhibitor product use", fmt(inhKg / n("ct_inhsg"), 2), "L/day", null],
            ["Biocide slug per dose", fmt(bioKg, 2), "kg", null],
            ["Biocide slug per dose", fmt(bioKg / n("ct_biosg"), 2), "L", null],
            [`Make-up at ${fmt(tcoc, 1)} cycles`, fmt(muT, 2), "m³/h", null],
            ["Water saved at target cycles", fmt(saveM3, 0), "m³/year", null],
            ["Cost saved at target cycles", `£${fmt(saveM3 * n("ct_price"), 0)}`, "per year", null],
          ])}
        </Section>
      )}
      {tab === "ct" && (
        <Section heading="Circulating water chemistry">
          <Grid columns={4} plain>
            {srcSel("ct_src")}
            {inp("ct_tw", "Bulk water temperature (°C)")}
            {inp("ct_skin", "Heat exchanger skin temperature (°C)")}
            {sel("ct_phmode", "Circulating water pH", [{ value: "enter", label: "Enter measured or control pH" }, { value: "air", label: "CO₂ in equilibrium with air" }])}
            {v.ct_phmode === "enter" ? inp("ct_phv", "Circulating pH") : null}
            {v.ct_src === "local" ? inp("ct_ca", "Make-up Ca (mg/L as CaCO₃)") : null}
            {v.ct_src === "local" ? inp("ct_alk", "Make-up M-alk (mg/L as CaCO₃)") : null}
            {v.ct_src === "local" ? inp("ct_ph0", "Make-up pH") : null}
            {v.ct_src === "local" ? inp("ct_tds", "Make-up TDS (mg/L)") : null}
            {v.ct_src === "local" ? inp("ct_cl", "Make-up Cl (mg/L)") : null}
            {v.ct_src === "local" ? inp("ct_so4", "Make-up SO₄ (mg/L)") : null}
            {v.ct_src === "local" ? inp("ct_sio2", "Make-up SiO₂ (mg/L)") : null}
          </Grid>
          {table([
            ["Circulating pH", fmt(ctTw.ph, 2), "–", null],
            ["Circulating TDS", fmt(ctCh.tds, 0), "mg/L", null],
            ["Ca hardness / M-alkalinity", `${fmt(ctCh.caC, 0)} / ${fmt(ctTw.malk, 0)}`, "mg/L as CaCO₃", null],
            ["Chloride / sulphate", `${fmt(ctTw.ion.cl || 0, 0)} / ${fmt(ctTw.ion.so4 || 0, 0)}`, "mg/L", null],
            ...satRows(ctCh),
            ["Larson-Skold index", fmt(ctCh.ls, 2), "–", null],
            ["LSI at skin temperature", fmt(ctSkin.lsi, 2), "–", lsiChk(ctSkin.lsi)],
            ["Calcite SI at skin temperature", fmt(ctSkin.siCal, 2), "–", lsiChk(ctSkin.siCal)],
            ["Max cycles for silica at this pH and temperature", fmt(ctMaxSil, 1), "×", null],
          ])}
          <Text>With a hard make-up, high calcite saturation is normal at useful cycles; it is controlled with inhibitor, acid feed or softened make-up rather than by limiting cycles alone. Inhibitor suppliers state the LSI or calcite SI their programme can hold.</Text>
        </Section>
      )}
      {tab === "ct" && (
        <Section heading="Make-up and blowdown vs cycles" caption="m³/h at the current heat load.">
          <LineChart
            points={cocPts.map((c: number, i: number) => ({ label: String(c), value: cocMu[i] }))}
            secondary={{ label: "Blowdown", values: cocBd }}
            labels={["Make-up", "Blowdown"]}
            ceiling={Math.max(...cocMu.filter((x: number) => isFinite(x)), 1) * 1.1}
            floor={0}
            format={(x: number) => fmt(x, 1)}
            annotations={cocIdx >= 0 && cocIdx <= 8 ? [{ at: cocIdx, label: "Current" }] : []}
          />
        </Section>
      )}
      {tab === "ct" && (
        <Section heading="Cooling towers: formulas" collapsible defaultOpen={false}>
          <Equation>{"E = 0.00153 × ΔT × R     B + D = "}<Frac num="E" den="COC − 1" />{"     M = E + B + D"}</Equation>
          <Equation>{"Half-life (h) = "}<Frac num="0.693 × V" den="B + D" />{"     Product (kg/day) = "}<Frac num="dose (mg/L) × (B + D) × 24" den="1000" /></Equation>
          <Text>0.00153 per °C equals about 1% of recirculation per 6.5 °C with roughly 85% of heat rejected by evaporation; lower it in winter. Circulating chemistry concentrates every ion and the alkalinity by the cycles, at the bulk temperature and chosen pH. UK systems fall under HSE ACoP L8 and HSG274 for Legionella control.</Text>
        </Section>
      )}

      {/* ================= BOILERS ================= */}
      {tab === "bo" && (
        <Section heading="Boilers: inputs" actions={resetBtn("bo_")}>
          <Grid columns={4} plain>
            {srcSel("bo_src")}
            {boShared ? sel("bo_soft", "Make-up softened", [{ value: "yes", label: "Yes (Ca, Mg → Na)" }, { value: "no", label: "No" }]) : inp("bo_mutds", "Make-up TDS (mg/L)")}
            {boShared ? null : inp("bo_alk", "Make-up M-alk (mg/L as CaCO₃)")}
            {inp("bo_steam", "Steam output (kg/h)")}
            {inp("bo_cr", "Condensate return (% of feed)")}
            {inp("bo_ctds", "Condensate TDS (mg/L)")}
            {inp("bo_max", "Max boiler water TDS (mg/L)")}
            {inp("bo_p", "Boiler pressure (bar g)")}
            {inp("bo_tf", "Feedwater temperature (°C)")}
            {inp("bo_pfl", "Flash vessel pressure (bar g)")}
            {inp("bo_hours", "Operating hours/year")}
            {inp("bo_eff", "Boiler efficiency (%)")}
            {inp("bo_fuel", "Fuel cost (£/kWh)")}
          </Grid>
        </Section>
      )}
      {tab === "bo" && (
        <Section heading="Boilers: blowdown and steam balance">
          {table([
            ["Make-up TDS used", fmt(boMuTds, 0), "mg/L", null],
            ["Feedwater TDS", fmt(tdsF, 0), "mg/L", null],
            ["Cycles of concentration", fmt(boCoc, 1), "×", null],
            ["Blowdown, % of feedwater", fmt(bdPctFeed, 2), "%", range(bdPctFeed, 0, 5, "Typical (≤ 5%)", "", bdPctFeed <= 10 ? "High – review make-up or returns" : "Very high", "warning", bdPctFeed <= 10 ? "warning" : "danger")],
            ["Blowdown, % of steam", fmt((bdKg / steam) * 100, 2), "%", null],
            ["Blowdown flow", fmt(bdKg, 0), "kg/h", null],
            ["Feedwater flow", fmt(feedKg, 0), "kg/h", null],
            ["Make-up water", fmt(muM3, 2), "m³/h", null],
            ["CO₂ in steam (estimate)", fmt(co2Steam, 0), "mg/L", co2Steam > 20 ? { text: "High – condensate corrosion risk; consider dealkalisation or amine", tone: "warning" } : null],
            ["Saturation temperature", fmt(tSat, 1), "°C", null],
            ["Heat lost in blowdown", fmt(qBd, 1), "kW", null],
            ["Fuel cost of blowdown heat", `£${fmt(bdCost, 0)}`, "per year", null],
            ["Flash steam fraction", fmt(flashFrac * 100, 1), "%", null],
            ["Recoverable flash steam", fmt(flashKg, 0), "kg/h", null],
            ["Flash steam heat", fmt(flashKw, 1), "kW", null],
          ])}
        </Section>
      )}
      {tab === "bo" && (
        <Section heading="Effect of condensate return">
          <Table
            columns={["Condensate return", "Feed TDS (mg/L)", "Blowdown (% of steam)", "Blowdown (kg/h)", "Make-up (m³/h)"]}
            emphasis={crRows.findIndex((c: number) => c === Math.round(n("bo_cr")))}
            rows={crRows.map((c: number) => {
              const f = boMuTds * (1 - c / 100) + n("bo_ctds") * (c / 100);
              const b = (steam * f) / (tdsB - f);
              return [`${c}%`, fmt(f, 0), fmt((b / steam) * 100, 2), fmt(b, 0), fmt(((steam + b) * (1 - c / 100)) / 1000, 2)];
            })}
          />
        </Section>
      )}
      {tab === "bo" && (
        <Section heading="Boilers: oxygen scavenger">
          <Grid columns={4} plain>
            {sel("bo_scav", "Scavenger", opts(SCAV), (x: string) => {
              const s = SCAV[x];
              if (s) setMany({ bo_scav: x, bo_res: s.res });
            })}
            {inp("bo_o2", "Feedwater dissolved O₂ (mg/L)")}
            {inp("bo_res", sc.volatile ? "Residual in feedwater (mg/L)" : "Boiler residual (mg/L as SO₃)")}
            {inp("bo_str", "Product strength (% active)")}
            {inp("bo_sg", "Product SG")}
          </Grid>
          {table([
            ["O₂ saturation at feed temperature (1 atm)", fmt(o2Sat, 1), "mg/L", null],
            ["Stoichiometric ratio", fmt(sc.ratio, 2), "mg per mg O₂", null],
            ["Dose for O₂ removal", fmt(sc.ratio * n("bo_o2"), 1), "mg/L active in feed", null],
            ["Dose to maintain residual", fmt(maint, 1), "mg/L active in feed", null],
            ["Total feed dose", fmt(scDose, 1), "mg/L active", null],
            ["Active chemical", fmt(scKgD, 2), "kg/day", null],
            ["Product", fmt(scProdKg, 1), "kg/day", null],
            ["Product", fmt(scProdKg / n("bo_sg"), 1), "L/day", null],
          ])}
          <Text>Theoretical ratios shown; practical sulphite dosing is often about 10 mg per mg O₂, and DEHA about 3. Volatile scavengers carry into steam, so their residual is set in the feedwater.</Text>
        </Section>
      )}
      {tab === "bo" && (
        <Section heading="Steam silica: vaporous carryover (Styrikovich)" caption="Silica dissolves in saturated steam as Si(OH)₄. Its volatility rises steeply with pressure as the steam and water densities converge.">
          <Grid columns={4} plain>
            {sel("bo_sipu", "Pressure basis", [{ value: "barg", label: "bar g" }, { value: "bara", label: "bar a" }, { value: "psig", label: "psig" }, { value: "boiler", label: "Use boiler pressure above (bar g)" }])}
            {siU === "boiler" ? null : inp("bo_sip", `Drum pressure (${siU === "bara" ? "bar a" : siU === "psig" ? "psig" : "bar g"})`)}
            {inp("bo_sibwu", "Boiler water silica (µg/L SiO₂)")}
            {inp("bo_siph", "Boiler water pH at 25 °C (blank = no correction)")}
            {inp("bo_simc", "Mechanical carryover (% of boiler water)")}
            {sel("bo_silimu", "Steam silica limit (µg/L SiO₂)", [{ value: "10", label: "10 µg/L – strict turbine OEM" }, { value: "20", label: "20 µg/L – customary turbine limit" }, { value: "50", label: "50 µg/L – no turbine / process steam" }])}
            {inp("bo_sin", "Styrikovich exponent n (silica ≈ 1.9)")}
            {sel("bo_sisrc", "Feedwater silica source", [{ value: "local", label: "Local input" }, { value: "shared", label: "Shared analysis × (1 − condensate return)" }])}
            {v.bo_sisrc === "shared" ? null : inp("bo_sifwu", "Feedwater silica (µg/L SiO₂)")}
          </Grid>
          <Callout
            tone={!isFinite(siSteam) || !isFinite(siLim) ? "warning" : siSteam <= 0.8 * siLim ? "success" : siSteam <= siLim ? "warning" : "danger"}
            lead={`Predicted steam silica: ${isFinite(siSteam) ? fmt(siSteam * 1000, 1) : "–"} µg/L (ppb) SiO₂.`}
          >
            {!isFinite(siSteam)
              ? "Enter drum pressure (below the critical point, 220.6 bar a), boiler water silica and mechanical carryover to calculate."
              : `${siSteam <= 0.8 * siLim ? "PASS" : siSteam <= siLim ? "PASS (close to limit)" : "FAIL"} against the ${fmt(siLimU, 0)} µg/L limit. Vaporous ${fmt(siVap * 1000, 1)} µg/L + mechanical ${fmt(siMech * 1000, 1)} µg/L (total = ${fmt(siSteam, 4)} mg/L). Kd used ${kdF(siKd)}. Pressure ${fmt(siPA - 1.013, 1)} bar g / ${fmt(siPA, 1)} bar a, ${siPSrc}. Boiler water ${fmt(siBw * 1000, 0)} µg/L SiO₂, pH ${isFinite(siPh) ? fmt(siPh, 1) : "not set (no correction)"}, mechanical carryover ${fmt(siMc * 100, 3)}%.`}
          </Callout>
          <Table
            columns={["Predicted steam silica", "µg/L (ppb) SiO₂", "Share", "Check"]}
            emphasis={0}
            rows={[
              ["Total", fmt(siSteam * 1000, 1), "100%", !isFinite(siSteam) ? "" : siSteam <= siLim ? { text: `Pass (limit ${fmt(siLimU, 0)} µg/L)`, tone: siSteam <= 0.8 * siLim ? "success" : "warning" } : { text: `Fail (limit ${fmt(siLimU, 0)} µg/L)`, tone: "danger" }],
              ["Vaporous (Kd × boiler silica)", fmt(siVap * 1000, 1), `${fmt((siVap / siSteam) * 100, 0)}%`, ""],
              ["Mechanical (carryover × boiler silica)", fmt(siMech * 1000, 1), `${fmt((siMech / siSteam) * 100, 0)}%`, ""],
            ]}
          />
          <Text>Detailed working:</Text>
          {table([
            ["Drum pressure", fmt(siPA, 1), `bar a (${fmt(siPA - 1.013, 1)} bar g)`, siPA >= 220.64 ? { text: "At or above the critical point – model not valid", tone: "danger" } : null],
            ["Saturated water / steam density", `${fmt(siRl, 1)} / ${fmt(siRv, 2)}`, "kg/m³", null],
            ["Density ratio ρsteam/ρwater", kdF(siRv / siRl), "–", null],
            ["Distribution ratio Kd (neutral pH)", kdF(siKd0), "–", siPA < 21 ? { text: "Negligible below ~20 bar – mechanical carryover dominates", tone: "success" } : null],
            ["pH factor on Kd", fmt(siPhF, 2), "×", isFinite(siPh) && siPh > 11 ? { text: "High pH lowers silica volatility", tone: "success" } : null],
            ["Kd used", kdF(siKd), "–", null],
            ["Vaporous steam silica", fmt(siVap * 1000, 1), "µg/L SiO₂", null],
            ["Mechanical steam silica", fmt(siMech * 1000, 1), "µg/L SiO₂", null],
            ["Total steam silica", fmt(siSteam * 1000, 1), "µg/L SiO₂", !isFinite(siSteam) ? null : siSteam <= 0.8 * siLim ? { text: `Within ${fmt(siLimU, 0)} µg/L limit`, tone: "success" } : siSteam <= siLim ? { text: "Close to limit", tone: "warning" } : { text: "Exceeds limit – turbine deposit risk", tone: "danger" }],
            ["Vaporous share of steam silica", fmt((siVap / siSteam) * 100, 0), "%", null],
            ["Max boiler water silica for limit", fmt(siMaxBw * 1000, 0), "µg/L SiO₂", !isFinite(siMaxBw) || !isFinite(siBw) ? null : siBw <= siMaxBw ? { text: "Current boiler silica OK", tone: "success" } : { text: "Reduce boiler silica", tone: "danger" }],
            ["Feedwater silica", fmt(siFeed * 1000, 1), "µg/L SiO₂", v.bo_sisrc === "shared" ? { text: "From shared analysis (mg/L × 1000) × (1 − condensate return)", tone: "success" } : null],
            ["Max cycles on silica", fmt(siMaxCoc, 1), "×", !isFinite(siMaxCoc) ? null : siMaxCoc < boCoc ? { text: `Silica, not TDS (${fmt(boCoc, 1)}×), limits cycles`, tone: "warning" } : { text: `TDS limit (${fmt(boCoc, 1)}×) governs`, tone: "success" }],
            ["Min blowdown on silica", fmt(100 / siMaxCoc, 2), "% of feed", range(100 / siMaxCoc, 0, 5, "Acceptable", "", 100 / siMaxCoc <= 10 ? "High – improve silica removal (demin / RO / mixed bed)" : "Very high – feedwater unsuitable for this pressure", "warning", 100 / siMaxCoc <= 10 ? "warning" : "danger")],
            ["Boiler silica at current TDS cycles", fmt(siBwAtCoc * 1000, 0), "µg/L SiO₂", !isFinite(siBwAtCoc) || !isFinite(siMaxBw) ? null : siBwAtCoc <= siMaxBw ? { text: "Below silica maximum", tone: "success" } : { text: "Above silica maximum", tone: "danger" }],
          ])}
          <Text>Below about 20 bar vaporous carryover is negligible and mechanical carryover (priming, foaming, poor drum separation) dominates. The cycles rows use the TDS-based cycles from the boiler inputs above. Check the result against the turbine OEM steam purity specification and ASME / VGB / IAPWS guidance.</Text>
        </Section>
      )}
      {tab === "bo" && (
        <Section heading="Max boiler water silica vs pressure" caption="Log scale: axis values are µg/L SiO₂ in boiler water. Includes the mechanical carryover and pH factor above. Pressure in bar a.">
          <LineChart
            points={siChartP.map((p: number, i: number) => ({ label: p % 40 === 0 ? String(p) : "", value: siLogA[i] }))}
            secondary={{ label: `Steam limit ${siAltU} µg/L`, values: siLogB }}
            labels={[`Steam limit ${siLimU} µg/L`, `Steam limit ${siAltU} µg/L`]}
            ceiling={siCeil}
            floor={siFloor}
            format={(x: number) => p10(x)}
            annotations={siIdx >= 0 && siIdx < siChartP.length ? [{ at: siIdx, label: "Operating" }] : []}
          />
          <Table
            columns={["Drum pressure (bar a)", "psig", "ρsteam/ρwater", "Kd (neutral pH)", "Kd used", `Max boiler water SiO₂ (µg/L) for ${siLimU} µg/L steam`]}
            emphasis={siRows.findIndex((p: number) => Math.abs(p - siPA) < 5)}
            rows={siRows.map((p: number) => {
              const r = interp(SATRHO, p, 2) / interp(SATRHO, p, 1);
              const k = kdSi(p, siN);
              const m = siLim / (k * siPhF + siMc);
              return [String(p), fmt((p - 1.013) / 0.0689476, 0), kdF(r), kdF(k), kdF(k * siPhF), `${fmt(m * 1000, 0)} µg/L`];
            })}
          />
        </Section>
      )}
      {tab === "bo" && (
        <Section heading="Steam silica: formulas and published comparison" collapsible defaultOpen={false}>
          <Equation>{"Kd = "}<Pow base="(ρ_steam ÷ ρ_water)" exp="n" />{"  × f_pH     f_pH = "}<Frac num="1" den="1 + 10^(pH₂₅ − 12.0)" /></Equation>
          <Equation>{"SiO₂ steam = SiO₂ boiler × (Kd + MC)     Max SiO₂ boiler = "}<Frac num="Steam limit" den="Kd + MC" />{"     Max COC = "}<Frac num="Max SiO₂ boiler" den="SiO₂ feed" /></Equation>
          <Table
            columns={["Pressure (psig)", "bar a", "Published Kd (B&W, Steam)", `Model Kd, n = ${siN}`, "Model ÷ published"]}
            rows={siBw_.map((r: number[]) => {
              const pa = r[0] * 0.0689476 + 1.013;
              const k = kdSi(pa, siN);
              return [fmt(r[0], 0), fmt(pa, 1), kdF(r[1]), kdF(k), { text: fmt(k / r[1], 2), tone: Math.abs(k / r[1] - 1) <= 0.3 ? "success" : "warning" }];
            })}
          />
          <Text>Densities are IAPWS-IF97 saturation values, interpolated linearly. Styrikovich's relation holds for neutral (molecular) silicic acid; n ≈ 1.9 for silica, and a least-squares fit to the Babcock & Wilcox distribution ratios gives n ≈ 1.87. The pH factor is an empirical fit to the reported behaviour (no measurable effect from pH 7.8 to 9, and about half the ratio at pH 12.1 compared with 11.3); it is not a full ionisation model at temperature. MC is the mechanical carryover fraction of boiler water. Above about 140 bar the model reads 15–25% below the published curve, so allow margin. Customary steam limit is 20 µg/L SiO₂ (0.02 mg/L), or 10 µg/L where the turbine supplier requires it. All silica in this section (steam, boiler water, feedwater) is in µg/L SiO₂ (ppb; equal to µg/kg for condensed steam and dilute water; 1 mg/L = 1000 µg/L). Inputs are divided by 1000 and calculated in mg/L internally, then multiplied by 1000 for display; the shared water analysis is in mg/L and is converted × 1000. Cycles and blowdown are unit-free ratios.</Text>
        </Section>
      )}
      {tab === "bo" && (
        <Section heading="Boilers: formulas and guide values" collapsible defaultOpen={false}>
          <Equation>{"Blowdown (kg/h) = Steam × "}<Frac num="TDS_feed" den="TDS_boiler − TDS_feed" />{"     Blowdown (% feed) = "}<Frac num="TDS_feed" den="TDS_boiler" />{" × 100"}</Equation>
          <Equation>{"Flash fraction = "}<Frac num="h_f (boiler) − h_f (flash)" den="h_fg (flash)" />{"     Sulphite dose = 7.88 × O₂ + "}<Frac num="residual × 1.575" den="COC" /></Equation>
          <Table
            columns={["Low-pressure shell boiler water", "Typical guide range"]}
            rows={[
              ["TDS", "2,000–3,500 mg/L (per manufacturer)"],
              ["pH at 25 °C", "10.5–12.0"],
              ["Sulphite residual", "30–70 mg/L as SO₃"],
              ["Phosphate residual (if used)", "20–60 mg/L as PO₄"],
              ["Feedwater total hardness", "< 2 mg/L as CaCO₃"],
              ["Feedwater temperature", "≥ 85 °C to reduce dissolved O₂"],
            ]}
          />
          <Text>Softening swaps each meq of Ca, Mg, Sr and Ba for Na, which raises make-up TDS slightly. CO₂ in steam uses the common 0.79 × feedwater M-alkalinity estimate (full bicarbonate breakdown and partial carbonate breakdown). Guide values only; follow BS EN 12953-10 and the boiler manufacturer.</Text>
        </Section>
      )}

      {/* ================= CHLORINE ================= */}
      {tab === "cl" && (
        <Section heading="Chlorine chemistry: inputs" actions={resetBtn("cl_")}>
          <Grid columns={4} plain>
            {srcSel("cl_src")}
            {v.cl_src === "local" ? inp("cl_ph", "pH") : null}
            {v.cl_src === "local" ? inp("cl_t", "Temperature (°C)") : null}
            {v.cl_src === "local" ? inp("cl_nh3", "Ammonia (mg/L as N)") : null}
            {inp("cl_free", "Measured free chlorine (mg/L)")}
            {inp("cl_total", "Measured total chlorine (mg/L)")}
            {inp("cl_dem", "Other chlorine demand (mg/L)")}
            {inp("cl_res", "Target free residual (mg/L)")}
            {inp("cl_q", "Water flow (m³/h)")}
            {inp("cl_str", "NaOCl strength (g/L available Cl₂)")}
          </Grid>
        </Section>
      )}
      {tab === "cl" && (
        <Section heading="Chlorine chemistry: results">
          {table([
            ["pH / temperature used", `${fmt(clPh, 2)} / ${fmt(clT, 1)} °C`, "–", null],
            ["HOCl pKa at temperature", fmt(pKa, 3), "–", null],
            ["Hypochlorous acid HOCl", fmt(hoclFrac * 100, 1), "% of free chlorine", hoclFrac >= 0.5 ? { text: "Good disinfection efficiency", tone: "success" } : hoclFrac >= 0.2 ? { text: "Reduced efficiency", tone: "warning" } : { text: "Poor – mostly OCl⁻", tone: "danger" }],
            ["Hypochlorite ion OCl⁻", fmt((1 - hoclFrac) * 100, 1), "% of free chlorine", null],
            ["HOCl concentration", fmt(hoclFrac * n("cl_free"), 2), "mg/L as Cl₂", null],
            ["Combined chlorine (total − free)", fmt(n("cl_total") - n("cl_free"), 2), "mg/L", n("cl_total") - n("cl_free") > 0.2 ? { text: "Above 0.2 mg/L – chloramines present", tone: "warning" } : null],
            ["Ammonia-N used", fmt(clN, 3), "mg/L", null],
            ["Breakpoint dose (7.6 × NH₃-N + demand + residual)", fmt(bpDose, 2), "mg/L as Cl₂", null],
            ["Chlorine required", fmt((bpDose * n("cl_q") * 24) / 1000, 2), "kg Cl₂/day", null],
            ["Sodium hypochlorite pump rate", fmt(clLh, 3), "L/h", null],
            ["Sodium hypochlorite per day", fmt(clLh * 24, 1), "L/day", null],
          ])}
        </Section>
      )}
      {tab === "cl" && (
        <Section heading="HOCl fraction vs pH" caption="% of free chlorine present as HOCl at the temperature used.">
          <LineChart
            points={clPts.map((ph: number) => ({ label: ph % 1 === 0.5 ? String(ph) : "", value: 100 / (1 + Math.pow(10, ph - pKa)) }))}
            ceiling={100}
            floor={0}
            unit="%"
            format={(x: number) => fmt(x, 0)}
            legend={false}
            annotations={clAnn}
          />
        </Section>
      )}
      {tab === "cl" && (
        <Section heading="Effect of pH on free chlorine">
          <Grid columns={4} plain>
            {inp("cl_free", "Measured free chlorine (mg/L as Cl₂)")}
            {v.cl_src === "local" ? inp("cl_ph", "Current pH") : null}
            {v.cl_src === "local" ? inp("cl_t", "Temperature (°C)") : null}
            {inp("cl_ph2", "Target / new pH")}
            {inp("cl_ratio", "HOCl strength vs OCl⁻ (×, approx. 80–100)")}
          </Grid>
          {v.cl_src === "shared" ? <Text>{`Current pH ${fmt(clPh, 2)} and temperature ${fmt(clT, 1)} °C come from the shared water analysis; switch the chlorine data source to local inputs above to override them.`}</Text> : null}
          <Table
            columns={["Result", `Current pH ${fmt(clPh, 2)}`, `New pH ${fmt(clPh2, 2)}`, "Unit"]}
            align={["start", "end", "end", "start"]}
            rows={[
              ["HOCl", fmt(fH1 * 100, 1), fmt(fH2 * 100, 1), "% of free chlorine"],
              ["OCl⁻", fmt((1 - fH1) * 100, 1), fmt((1 - fH2) * 100, 1), "% of free chlorine"],
              ["HOCl as Cl₂", fmt(clFree * fH1, 3), fmt(clFree * fH2, 3), "mg/L"],
              ["HOCl as HOCl", fmt(clFree * fH1 * 0.7399, 3), fmt(clFree * fH2 * 0.7399, 3), "mg/L"],
              ["OCl⁻ as ion", fmt(clFree * (1 - fH1) * 0.7257, 3), fmt(clFree * (1 - fH2) * 0.7257, 3), "mg/L"],
              ["Effective chlorine (HOCl-equivalent, approx.)", fmt(eff1, 3), fmt(eff2, 3), "mg/L as Cl₂"],
              ["Relative disinfection effectiveness (approx.)", "100", { text: fmt((eff2 / eff1) * 100, 0), tone: eff2 / eff1 >= 0.9 ? "success" : eff2 / eff1 >= 0.5 ? "warning" : "danger" }, "% of current"],
              ["Free chlorine for the same HOCl", fmt(clFree, 2), { text: fmt(clEquiv, 2), tone: clEquiv <= clFree * 1.1 ? "success" : clEquiv <= clFree * 2 ? "warning" : "danger" }, "mg/L as Cl₂"],
            ]}
          />
          <Table
            columns={["pH", "HOCl (%)", "HOCl (mg/L as Cl₂)", "OCl⁻ (mg/L as Cl₂)", "Free Cl₂ for same HOCl as now"]}
            align={["start", "end", "end", "end", "end"]}
            rows={[6, 6.5, 7, 7.5, 8, 8.5, 9].map((ph: number) => {
              const f = hFrac(ph);
              return [fmt(ph, 1), fmt(f * 100, 1), fmt(clFree * f, 3), fmt(clFree * (1 - f), 3), fmt((clFree * fH1) / f, 2)];
            })}
          />
          <Text>A DPD free chlorine test measures HOCl and OCl⁻ together, so the same reading is a much weaker disinfectant at high pH. Cooling towers running above about pH 8 often switch to bromine (HOBr pKa about 8.7) or chlorine dioxide, which are far less affected by pH.</Text>
          <Text>HOCl fraction uses the temperature-corrected pKa above. Effective chlorine = free Cl₂ × (HOCl fraction + OCl⁻ fraction ÷ strength ratio); the 80–100× ratio is an approximate literature range and varies by organism.</Text>
        </Section>
      )}
      {tab === "cl" && (
        <Section heading="Chlorine: formulas" collapsible defaultOpen={false}>
          <Equation>{"HOCl fraction = "}<Frac num="1" den="1 + 10^(pH − pKa)" />{"     pKa = 3000/T − 10.0686 + 0.0253 T  (T in K)"}</Equation>
          <Text>The pKa expression is Morris (1966), 7.54 at 25 °C. Breakpoint uses the theoretical 7.6 mg Cl₂ per mg NH₃-N; in practice 8–10 is common. Commercial sodium hypochlorite is often sold at 14–15% available chlorine (about 140–150 g/L) and loses strength in storage, especially when warm.</Text>
        </Section>
      )}

      {/* ================= WASTEWATER ================= */}
      {tab === "ww" && (
        <Section heading="Wastewater: activated sludge inputs" actions={resetBtn("ww_")}>
          <Grid columns={4} plain>
            {inp("ww_q", "Flow (m³/day)")}
            {inp("ww_bod", "Influent BOD₅ (mg/L)")}
            {inp("ww_cod", "Influent COD (mg/L)")}
            {inp("ww_tss", "Influent TSS (mg/L)")}
            {inp("ww_bode", "Effluent BOD₅ (mg/L)")}
            {inp("ww_tsse", "Effluent TSS (mg/L)")}
            {inp("ww_v", "Aeration volume (m³)")}
            {inp("ww_mlss", "MLSS (mg/L)")}
            {inp("ww_vf", "MLVSS/MLSS ratio")}
            {inp("ww_qw", "Waste sludge flow (m³/day)")}
            {inp("ww_xw", "Waste sludge SS (mg/L)")}
            {inp("ww_nh", "NH₃-N nitrified (mg/L)")}
            {inp("ww_ote", "Field O₂ transfer efficiency (%)")}
            {inp("ww_ds", "Waste sludge dry solids (%)")}
            {inp("ww_cd", "Clarifier diameter (m)")}
            {inp("ww_rr", "RAS ratio (Qr/Q)")}
          </Grid>
        </Section>
      )}
      {tab === "ww" && (
        <Section heading="Wastewater: loading, sludge and oxygen">
          {table([
            ["BOD load", fmt(bodKg, 0), "kg/day", null],
            ["COD load", fmt(codKg, 0), "kg/day", null],
            ["TSS load", fmt(tssKg, 0), "kg/day", null],
            ["BOD/COD ratio", fmt(bc, 2), "–", range(bc, 0.3, 1, bc >= 0.5 ? "Readily biodegradable" : "Moderately biodegradable", "Poorly biodegradable", "Check data")],
            ["Hydraulic retention time", fmt(hrt, 1), "h", null],
            ["Volumetric BOD loading", fmt(vlr, 2), "kg BOD/m³·day", null],
            ["F/M ratio", fmt(fm, 2), "kg BOD/kg MLVSS·day", { text: fmRegime }],
            ["Sludge age (SRT)", fmt(srt, 1), "days", range(srt, 3, 30, "Typical 3–30 days", "Low – poor settling, no nitrification", "Very long")],
            ["Sludge production", fmt(pxTss, 0), "kg TSS/day", null],
            ["Waste sludge volume", fmt(sludgeM3, 1), "m³/day", null],
            ["Observed yield", fmt(yObs, 2), "kg TSS/kg BOD removed", null],
            ["Oxygen demand", fmt(o2, 0), "kg O₂/day", null],
            ["Air requirement", fmt(airNm3h, 0), "Nm³/h", null],
            ["Clarifier surface area", fmt(clA, 1), "m²", null],
            ["Surface overflow rate", fmt(sor, 1), "m³/m²·day", range(sor, 0, 28, "Within 16–28 (average flow)", "", sor <= 40 ? "High for average flow" : "Too high", "warning", sor <= 40 ? "warning" : "danger")],
            ["Surface overflow rate", fmt(sor / 24, 2), "m/h", null],
            ["Clarifier solids loading", fmt(slr, 2), "kg/m²·h", range(slr, 0, 6, "Within 4–6 typical", "", slr <= 8 ? "High – check settleability" : "Too high", "warning", slr <= 8 ? "warning" : "danger")],
          ])}
        </Section>
      )}
      {tab === "ww" && (
        <Section heading="Wastewater: coagulant and pH correction">
          <Grid columns={4} plain>
            {sel("ww_coag", "Coagulant", opts(COAG))}
            {inp("ww_cdose", "Coagulant dose (mg/L product)")}
            {inp("ww_phq", "Neutralisation flow (m³/h)")}
            {inp("ww_phin", "Inlet pH")}
            {inp("ww_pht", "Target pH")}
            {sel("ww_base", "Alkali", opts(BASES))}
            {sel("ww_acid", "Acid", opts(ACIDS))}
          </Grid>
          {table([
            ["Coagulant product", fmt(cgKg, 1), "kg/day", null],
            ["Coagulant product", fmt(cgL, 1), "L/day", null],
            ["Coagulant product", fmt(cgL / 24, 2), "L/h", null],
            [`${cg.m} hydroxide sludge`, fmt(cgSludge, 1), "kg dry solids/day", null],
            ["Reagent needed", needBase ? "Alkali" : "Acid", rgt.label, null],
            ["Reagent (100% basis)", fmt(phPure, 3), "kg/h", null],
            ["Reagent product", fmt(phProd, 2), "kg/h", null],
            ["Reagent product", fmt(phProd / rgt.sg, 2), "L/h", null],
          ])}
          <Text>The pH calculation covers free strong acid or alkali only. Buffering from alkalinity, metals or weak acids can raise real demand many times over, so confirm with a titration curve before sizing pumps.</Text>
        </Section>
      )}
      {tab === "ww" && (
        <Section heading="Wastewater: formulas" collapsible defaultOpen={false}>
          <Equation>{"HRT = "}<Frac num="V" den="Q" />{"     F/M = "}<Frac num="Q × BOD" den="V × MLVSS" />{"     SRT = "}<Frac num="V × MLSS" den="Q_w X_w + (Q − Q_w) X_e" /></Equation>
          <Equation>{"O₂ (kg/d) = "}<Frac num="Q (S₀ − S)" den="0.68 × 1000" />{" − 1.42 P_x,VSS + 4.57 Q N_ox ÷ 1000"}</Equation>
          <Text>F/M guide: extended aeration 0.05–0.15, conventional 0.2–0.5. Air uses 0.30 kg O₂ per Nm³. Hydroxide sludge factors: 1.91 kg Fe(OH)₃ per kg Fe and 2.89 kg Al(OH)₃ per kg Al, before any removed solids. Clarifier guides are for secondary clarifiers at average flow.</Text>
        </Section>
      )}

      {/* ================= CONVERSIONS ================= */}
      {tab === "cv" && (
        <Section heading="Ion ↔ CaCO₃ equivalent" actions={resetBtn("cv_")}>
          <Grid columns={4} plain>
            {sel("cv_ion", "Ion", IONS.map((i: { k: string; label: string }) => ({ value: i.k, label: i.label })))}
            {sel("cv_dir", "Value entered as", [{ value: "ion", label: "mg/L as ion" }, { value: "caco3", label: "mg/L as CaCO₃" }])}
            {inp("cv_val", "Value (mg/L)")}
          </Grid>
          {table([
            ["As ion", fmt(asIon, 2), "mg/L", null],
            ["As CaCO₃", fmt(asCaco3, 2), "mg/L", null],
            ["Milliequivalents", fmt(asIon / ion.ew, 3), "meq/L", null],
            ["Conversion factor", fmt(cvF, 3), "× ion → CaCO₃", null],
          ])}
        </Section>
      )}
      {tab === "cv" && (
        <Section heading="Hardness units">
          <Grid columns={4} plain>
            {inp("cv_hval", "Value")}
            {sel("cv_hunit", "Unit", opts(HARD))}
          </Grid>
          <Table columns={["Unit", "Value"]} align={["start", "end"]} rows={Object.keys(HARD).map((k: string) => [HARD[k].label, fmt(hBase / HARD[k].f, 3)])} />
        </Section>
      )}
      {tab === "cv" && (
        <Section heading="Flow units">
          <Grid columns={4} plain>
            {inp("cv_fval", "Value")}
            {sel("cv_funit", "Unit", opts(FLOW))}
          </Grid>
          <Table columns={["Unit", "Value"]} align={["start", "end"]} rows={Object.keys(FLOW).map((k: string) => [FLOW[k].label, fmt(fBase / FLOW[k].f, 3)])} />
        </Section>
      )}
      {tab === "cv" && (
        <Section heading="Chemical dose to pump rate">
          <Grid columns={4} plain>
            {inp("cv_dppm", "Dose (mg/L)")}
            {sel("cv_dbasis", "Dose basis", [{ value: "product", label: "As product" }, { value: "active", label: "As active" }])}
            {inp("cv_dq", "Water flow (m³/h)")}
            {v.cv_dbasis === "active" ? inp("cv_dstr", "Product strength (% active)") : null}
            {inp("cv_dsg", "Product SG")}
            {inp("cv_pump", "Pump rate for reverse check (L/h)")}
          </Grid>
          {table([
            ["Product dose rate", fmt(dKgH, 3), "kg/h", null],
            ["Product pump rate", fmt(dLh, 3), "L/h", null],
            ["Product per day", fmt(dLh * 24, 1), "L/day", null],
            ["Dose from pump rate", fmt(pumpPpm, 2), "mg/L product", null],
          ])}
        </Section>
      )}
      {tab === "cv" && (
        <Section heading="Conductivity, pressure and temperature">
          <Grid columns={4} plain>
            {inp("cv_ec", "Conductivity (µS/cm)")}
            {inp("cv_k", "TDS factor (0.55–0.75)")}
            {inp("cv_bar", "Pressure (bar)")}
            {inp("cv_tc", "Temperature (°C)")}
          </Grid>
          {table([
            ["TDS from conductivity", fmt(n("cv_ec") * n("cv_k"), 0), "mg/L", null],
            ["Conductivity from TDS of the same value", fmt(n("cv_ec") / n("cv_k"), 0), "µS/cm", null],
            ["Pressure", fmt(n("cv_bar") * 14.5038, 1), "psi", null],
            ["Pressure", fmt(n("cv_bar") * 100, 0), "kPa", null],
            ["Pressure", fmt(n("cv_bar") * 10.197, 1), "m water head", null],
            ["Temperature", fmt((n("cv_tc") * 9) / 5 + 32, 1), "°F", null],
          ])}
        </Section>
      )}
      {tab === "cv" && (
        <Section heading="Common ions: factors to CaCO₃" collapsible defaultOpen={false}>
          <Table
            columns={["Ion", "Equivalent weight", "× to CaCO₃"]}
            align={["start", "end", "end"]}
            rows={IONS.map((i: { label: string; ew: number }) => [i.label, fmt(i.ew, 2), fmt(50.04 / i.ew, 3)])}
          />
        </Section>
      )}

      {/* ================= PLANT MIMIC ================= */}
      {tab === "pm" && (
        <Fragment>
          <Section
            heading="Plant mimic: demineralisation plant"
            caption="Feed → 3 SAC → degasser → 3 WBA/SBA trains → demin tank → transfer pumps → 5 mixed beds. Click a unit to open its inputs and results below. Colour shows status; the fill and % show how much of the current run is used. On a phone, scroll the drawing sideways or pick a unit from the list."
            actions={resetBtn("pm_")}
          >
            <Callout tone="warning" lead="Typical defaults: replace with your plant data.">
              Every number on this tab starts as a typical value, not your plant's. Enter your own vessel sizes, resin data, regeneration settings, throughputs, prices and demand. They autosave in this browser. For a copy you can keep, open Backup & transfer at the bottom of the page.
            </Callout>
            {pmMimic()}
            <Grid columns={4} plain>
              <Select label="Selected unit" options={pmUnitOpts} value={pmSel} onChange={(x: string) => setPmSel(x)} />
            </Grid>
          </Section>

          <Section heading="Predictive performance" caption="Indicative resin-manual curves from the feed analysis and the regen settings. Your typed capacities stay in charge until you choose predicted values.">
            <Grid columns={4} plain>
              {sel("pm_basis", "Drive this plant with", [{ value: "measured", label: "Use my measured values" }, { value: "predicted", label: "Use predicted values" }])}
              {sel("pm_flow_sac", "SAC regen flow", [{ value: "counter", label: "Counter-flow" }, { value: "co", label: "Co-flow" }])}
              {sel("pm_flow_wba", "WBA regen flow", [{ value: "co", label: "Co-flow" }, { value: "counter", label: "Counter-flow" }])}
              {sel("pm_flow_sba", "SBA regen flow", [{ value: "counter", label: "Counter-flow" }, { value: "co", label: "Co-flow" }])}
              {sel("pm_flow_mb", "Mixed bed regen flow", [{ value: "counter", label: "Counter-flow" }, { value: "co", label: "Co-flow" }])}
              {sel("pm_sba_type", "SBA type", [{ value: "1", label: "Type I" }, { value: "2", label: "Type II" }])}
              {inp("pm_regen_t", "Caustic temperature (°C)")}
            </Grid>
            <Grid columns={4} plain>
              {inp("pm_mthr_sac", "Measured SAC m³/cycle (optional)")}
              {inp("pm_mthr_wba", "Measured WBA m³/cycle (optional)")}
              {inp("pm_mthr_sba", "Measured SBA m³/cycle (optional)")}
              {inp("pm_mthr_mb", "Measured MB m³/cycle (optional)")}
            </Grid>
            {pmUsePred ? (
              <Callout tone="warning" lead="Predicted values are driving the mimic, costs and weaknesses.">
                Switch back to measured values to use the capacities and leakages you typed. Existing saved numbers are not overwritten.
              </Callout>
            ) : (
              <Text>The rest of this tab still uses your measured capacities and leakages. The table is the theoretical comparison.</Text>
            )}
            {PM_UNITS.filter((u: PmUnit) => u.type === "sac" && pmVp[u.id] && pmVp[u.id].h2so4).map((u: PmUnit) => (
              <Callout key={u.id} tone="warning" lead={`${u.label}: sulphuric acid.`}>{pmVp[u.id].h2so4}</Callout>
            ))}
            <Table
              columns={["Stage", "Predicted eq/L", "Your eq/L", "Predicted m³/cycle", "Your m³/cycle", "% of theoretical", "Check"]}
              align={["start", "end", "end", "end", "end", "end", "start"]}
              rows={(["sac", "wba", "sba", "mb"] as PmType[]).map((type: PmType) => {
                const yours = pmYourThr(type);
                const pred = pmPredThr(type);
                const pct = (yours / pred) * 100;
                const chk = effCheck(pct, pmEffHints(type));
                return [PM_SNAME[type], fmt(pmMeanSvc(type, (id: string) => pmVp[id].cap), 2), fmt(pmMeanSvc(type, (id: string) => pmF(id, "cap")), 2), fmt(pred, 0), fmt(yours, 0), fmt(pct, 0), chk];
              })}
            />
            <Table
              columns={["Leakage or residual", "Predicted", "What the plant is using", "Unit"]}
              align={["start", "end", "end", "start"]}
              rows={[
                ["SAC sodium", fmt(pmNaPred, 2), fmt(pmNaUsed, 2), "mg/L Na"],
                ["Degasser CO₂", fmt(pmCo2Pred, 1), fmt(pmCo2Model, 1), "mg/L"],
                ["SBA silica", fmt(pmSiPred, 0), fmt(pmSiUsed, 0), "µg/L SiO₂"],
                ["Mixed bed run", fmt(pmPredThr("mb") / (pmDem / Math.max(pmNSvc("mb"), 1)), 0), fmt(pmMb.minRunH, 0), "h"],
              ]}
            />
          </Section>

          <Section heading="Throughput against regen level" caption="One vessel of the in-service size. Left axis m³/cycle, right axis chemical £/m³ of that throughput. The marker is the lowest chemical cost on the curve." collapsible defaultOpen={false}>
            <Text>{`SAC, ${v.pm_sac1_regen === "h2so4" ? "H₂SO₄" : "HCl"}, ${pmMode("pm_flow_sac", "counter") === "counter" ? "counter-flow" : "co-flow"}.`}</Text>
            <LineChart
              points={pmSacCurve.map((p: { dose: number; thr: number }) => ({ label: String(p.dose), value: p.thr }))}
              secondary={{ label: "Chemical £/m³", values: pmSacCurve.map((p: { cost: number }) => p.cost) }}
              labels={["m³ per cycle", "Chemical £/m³"]}
              floor={0}
              ceiling={Math.max(...pmSacCurve.map((p: { thr: number }) => p.thr), 1) * 1.15}
              format={(x: number) => fmt(x, 0)}
              secondaryScale={{ floor: 0, ceiling: Math.max(...pmSacCurve.map((p: { cost: number }) => p.cost), 0.01) * 1.25, format: (x: number) => fmt(x, 3) }}
              annotations={[{ at: pmBest(pmSacCurve), label: "Lowest £/m³" }]}
            />
            <Text>{`SBA Type ${pmSbaType === "2" ? "II" : "I"}, NaOH at ${fmt(pmRegenT, 0)} °C caustic, ${pmMode("pm_flow_sba", "counter") === "counter" ? "counter-flow" : "co-flow"}.`}</Text>
            <LineChart
              points={pmSbaCurve.map((p: { dose: number; thr: number }) => ({ label: String(p.dose), value: p.thr }))}
              secondary={{ label: "Chemical £/m³", values: pmSbaCurve.map((p: { cost: number }) => p.cost) }}
              labels={["m³ per cycle", "Chemical £/m³"]}
              floor={0}
              ceiling={Math.max(...pmSbaCurve.map((p: { thr: number }) => p.thr), 1) * 1.15}
              format={(x: number) => fmt(x, 0)}
              secondaryScale={{ floor: 0, ceiling: Math.max(...pmSbaCurve.map((p: { cost: number }) => p.cost), 0.01) * 1.25, format: (x: number) => fmt(x, 3) }}
              annotations={[{ at: pmBest(pmSbaCurve), label: "Lowest £/m³" }]}
            />
          </Section>

          <Section heading="What-if scenario" caption="Overrides apply only in the scenario column until you press Apply. Blank means keep the baseline. Chemistry multipliers of 100% leave the analysis unchanged. Scenario figures use the predictive model when a regen, flow or water override is set; price-only changes keep today's throughput." collapsible defaultOpen={false}>
            <Grid columns={4} plain>
              {inp("pm_sc_tds", "TDS multiplier (%)")}
              {inp("pm_sc_hard", "Hardness multiplier (%)")}
              {inp("pm_sc_alk", "Alkalinity multiplier (%)")}
              {inp("pm_sc_sio2", "Silica multiplier (%)")}
              {inp("pm_sc_t", "Feed temperature (°C, blank = analysis)")}
              {inp("pm_sc_dose_sac", "SAC regen level (g/L 100%)")}
              {sel("pm_sc_regen_sac", "SAC acid", [{ value: "", label: "Same as baseline" }, { value: "hcl", label: "HCl" }, { value: "h2so4", label: "H₂SO₄" }])}
              {sel("pm_sc_flow_sac", "SAC flow", [{ value: "", label: "Same as baseline" }, { value: "counter", label: "Counter-flow" }, { value: "co", label: "Co-flow" }])}
              {inp("pm_sc_dose_wba", "WBA NaOH (g/L 100%)")}
              {sel("pm_sc_flow_wba", "WBA flow", [{ value: "", label: "Same as baseline" }, { value: "co", label: "Co-flow" }, { value: "counter", label: "Counter-flow" }])}
              {inp("pm_sc_dose_sba", "SBA NaOH (g/L 100%)")}
              {sel("pm_sc_flow_sba", "SBA flow", [{ value: "", label: "Same as baseline" }, { value: "counter", label: "Counter-flow" }, { value: "co", label: "Co-flow" }])}
              {sel("pm_sc_sba_type", "SBA type", [{ value: "", label: "Same as baseline" }, { value: "1", label: "Type I" }, { value: "2", label: "Type II" }])}
              {inp("pm_sc_regen_t", "Caustic temperature (°C)")}
              {inp("pm_sc_dose_mb", "MB acid (g/L 100%)")}
              {inp("pm_sc_dose_mb2", "MB NaOH (g/L 100%)")}
              {sel("pm_sc_flow_mb", "MB flow", [{ value: "", label: "Same as baseline" }, { value: "counter", label: "Counter-flow" }, { value: "co", label: "Co-flow" }])}
              {inp("pm_sc_q", "Feed flow (m³/h)")}
              {inp("pm_sc_dem", "Product demand (m³/h)")}
              {inp("pm_sc_n_sac", "SAC vessels in service")}
              {inp("pm_sc_n_wba", "WBA vessels in service")}
              {inp("pm_sc_n_sba", "SBA vessels in service")}
              {inp("pm_sc_n_mb", "Mixed beds in service")}
              {inp("pm_sc_end_sac", "SAC Na endpoint (mg/L)")}
              {inp("pm_sc_end_sba", "SBA silica endpoint (µg/L)")}
              {inp("pm_sc_end_mb", "MB conductivity endpoint (µS/cm)")}
              {inp("pm_sc_c_hcl", "HCl price (£/t)")}
              {inp("pm_sc_c_h2so4", "H₂SO₄ price (£/t)")}
              {inp("pm_sc_c_naoh", "NaOH price (£/t)")}
              {inp("pm_sc_c_water", "Water (£/m³)")}
              {inp("pm_sc_c_eff", "Effluent (£/m³)")}
              {inp("pm_sc_c_kwh", "Power (£/kWh)")}
            </Grid>
            <Grid columns={4} plain>
              <Button label="Reset scenario" onClick={resetScenario} />
              <Button label="Apply scenario to baseline" onClick={applyScenario} />
            </Grid>
            <Table
              columns={["Result", "Current plant", "Scenario", "Delta"]}
              align={["start", "end", "end", "end"]}
              rows={[
                ["SAC m³/cycle", fmt(svcThr("sac"), 0), fmt(pmScNow.thr.sac, 0), pmDelta(svcThr("sac"), pmScNow.thr.sac, 0)],
                ["WBA m³/cycle", fmt(svcThr("wba"), 0), fmt(pmScNow.thr.wba, 0), pmDelta(svcThr("wba"), pmScNow.thr.wba, 0)],
                ["SBA m³/cycle", fmt(svcThr("sba"), 0), fmt(pmScNow.thr.sba, 0), pmDelta(svcThr("sba"), pmScNow.thr.sba, 0)],
                ["Mixed bed m³/cycle", fmt(svcThr("mb"), 0), fmt(pmScNow.thr.mb, 0), pmDelta(svcThr("mb"), pmScNow.thr.mb, 0)],
                ["SAC run (h)", fmt(svcRun("sac"), 1), fmt(pmScNow.runH.sac, 1), pmDelta(svcRun("sac"), pmScNow.runH.sac, 1)],
                ["Mixed bed run (h)", fmt(svcRun("mb"), 0), fmt(pmScNow.runH.mb, 0), pmDelta(svcRun("mb"), pmScNow.runH.mb, 0)],
                ["SAC regens/yr", fmt(pmSac.regYr, 0), fmt(pmScNow.regYr.sac, 0), pmDelta(pmSac.regYr, pmScNow.regYr.sac, 0)],
                ["SBA regens/yr", fmt(pmSba.regYr, 0), fmt(pmScNow.regYr.sba, 0), pmDelta(pmSba.regYr, pmScNow.regYr.sba, 0)],
                ["Mixed bed regens/yr", fmt(pmMb.regYr, 1), fmt(pmScNow.regYr.mb, 1), pmDelta(pmMb.regYr, pmScNow.regYr.mb, 1)],
                ["Chemical delivered (t/yr)", fmt(curChemT, 1), fmt(pmScNow.chemT, 1), pmDelta(curChemT, pmScNow.chemT, 1)],
                ["Regen water (m³/yr)", fmt(pmWasteYr, 0), fmt(pmScNow.waste, 0), pmDelta(pmWasteYr, pmScNow.waste, 0)],
                ["Operating cost (£/yr)", fmt(pmTotYr, 0), fmt(pmScNow.cost, 0), { text: pmDelta(pmTotYr, pmScNow.cost, 0), tone: pmScNow.cost < pmTotYr - 1 ? "success" : pmScNow.cost > pmTotYr + 1 ? "warning" : "success" }],
                ["Na leakage (mg/L)", fmt(pmNaUsed, 2), fmt(pmScNow.na, 2), pmDelta(pmNaUsed, pmScNow.na, 2)],
                ["Silica leakage (µg/L)", fmt(pmSiUsed, 0), fmt(pmScNow.si, 0), pmDelta(pmSiUsed, pmScNow.si, 0)],
                ["Bottleneck", pmBn.name, pmScNow.bottleneck, ""],
              ]}
            />
            <Text>{`£ savings if the scenario were the plant: ${fmt(pmTotYr - pmScNow.cost, 0)} per year (positive means the scenario costs less). Apply writes regen levels, flows, prices, vessel counts and feed multipliers onto the baseline and switches the plant to predicted values. Feed multipliers edit the shared analysis (or the local plant analysis).`}</Text>
          </Section>

          <Section heading="How the model works" collapsible defaultOpen={false}>
            <Text>Capacities and leakages are indicative curves in the style of Dowex / AmberLite and Purolite engineering manuals for a gel strong-acid cation resin (about 8% DVB), a weak-base anion resin, and a Type I strong-base anion resin. They are not a vendor printout for a named grade. Calibrate them against your exhaustion tests.</Text>
            <Text>SAC HCl capacity runs from about 0.70 eq/L at 40 g/L (100% HCl) to about 1.02 eq/L at 80 g/L and 1.26 eq/L at 160 g/L, co-flow, for a reference water near 40% sodium, alkalinity about 70% of the anions, 400 mg/L TDS and 25 °C. Sulphuric acid is taken as 90% of that capacity at the same g/L, and sodium leakage about 1.35×. Counter-flow adds about 12% capacity and cuts sodium leakage to about 40% of the co-flow figure. Further corrections: fraction of cations that are sodium, alkalinity over total anions, TDS, and service temperature. If the H₂SO₄ injection strength is above a calcium-based first step (about 0.8–4%), capacity is cut 15% and a precipitation warning is shown.</Text>
            <Text>Sodium leakage on the co-flow HCl reference curve is about 12 mg/L at 40 g/L regen and about 2.5 mg/L at 80 g/L, then scaled for % sodium, TDS and temperature. The endpoint nudges capacity slightly (tighter endpoint, a little less throughput) but leakage is not claimed below the curve.</Text>
            <Text>The degasser residual is the design figure at design flow, moves toward about 2 mg/L when under-loaded, and rises with (flow / capacity)² when overloaded. Fan off passes all of the SAC CO₂. WBA capacity is about 1.18 eq/L at 50 g/L NaOH, higher when sulphate dominates the FMA, and lower above about 30 °C. SBA Type I is about 0.44 eq/L at 64 g/L NaOH and 0.50 at 80 g/L, reduced when silica or CO₂ is a large share of the anion load. Type II is about 22% more capacity and about 2.2× the silica leakage. Silica leakage is quoted at the caustic temperature you enter (default 35 °C); cold caustic multiplies it sharply. Counter-flow SBA adds about 10% capacity and cuts silica leakage to about 55%.</Text>
            <Text>Mixed beds use the lower of the acid and caustic levels: about 0.36 eq/L at 100 g/L of each. Their run is that capacity divided by the upstream sodium (mg/L ÷ 22.99) plus silica (µg/L ÷ 60,080). Efficiency below 85% (and below 70%) is flagged against your typed capacity, or against a measured m³/cycle if you enter one. Likely causes called out are fouling, channelling, poor distribution, an early endpoint, resin age, velocity, warm WBA resin, and calcium sulphate.</Text>
            <Text>All of this is a screening model. Resin age, organics, iron, channeling and the real endpoint instruments move the result. Use it to see the direction of a change, then confirm on the plant.</Text>
          </Section>

          <Section heading="Plant summary">
            <Callout tone={pmN1 ? "success" : "warning"} lead={`£${fmt(pmCostM3, 2)} per m³ of product, £${fmt(pmTotYr / 1000, 0)}k per year.`}>
              {`Product ${fmt(pmDem, 0)} m³/h (${fmt(pmProdYr, 0)} m³/yr). Regenerations per week: SAC ${fmt((pmSac.regYr / 365) * 7, 1)}, WBA ${fmt((pmWba.regYr / 365) * 7, 1)}, SBA ${fmt((pmSba.regYr / 365) * 7, 1)}, mixed beds ${fmt((pmMb.regYr / 365) * 7, 2)}. N−1 availability (one of each type regenerating, plus standby pump): ${pmN1 ? "met" : "NOT met"}. Savings identified below: about £${fmt(pmSaveTot, 0)}/yr.`}
            </Callout>
            {table([
              ["Product flow", fmt(pmDem, 1), "m³/h", null],
              ["Product per year", fmt(pmProdYr, 0), "m³/yr", null],
              ["Primary throughput incl. regeneration water", fmt(pmPrimYr, 0), "m³/yr", null],
              ["Waste water (rinse + dilute regenerant, all stages)", fmt(pmWasteYr, 0), "m³/yr", { text: `${fmt((pmWasteYr / pmProdYr) * 100, 1)}% of product` }],
              ...Object.keys(pmKgYr).map((k: string): Row => [`${pmChemOf(k).short} used (as delivered ${fmt(pmStr(k) * 100, 0)}%)`, fmt(pmKgYr[k] / 1000 / pmStr(k), 1), "t/yr", { text: `${fmt(pmKgYr[k] / 1000, 1)} t/yr as 100%` }]),
              ["Chemical cost", fmt(pmChemYr, 0), "£/yr", { text: `£${fmt(pmChemYr / pmProdYr, 3)}/m³` }],
              ["Water + effluent cost", fmt(pmWaterYr, 0), "£/yr", { text: `£${fmt(pmWaterYr / pmProdYr, 3)}/m³` }],
              ["Power cost (transfer pumps + degasser fan)", fmt(pmPowYr, 0), "£/yr", { text: `£${fmt(pmPowYr / pmProdYr, 3)}/m³` }],
              ["Resin replacement (cost ÷ life)", fmt(pmResinYr, 0), "£/yr", { text: `£${fmt(pmResinYr / pmProdYr, 3)}/m³` }],
              ["Total operating cost", fmt(pmTotYr, 0), "£/yr", { text: `£${fmt(pmCostM3, 3)}/m³` }],
              ["Tank storage at demand (to low level)", fmt(pmTkHrs, 1), "h", null],
            ])}
          </Section>

          <Section heading={`Unit: ${pmUnitOpts.find((o: Opt) => o.value === pmSel)?.label ?? ""}`} caption="Inputs and results for the unit selected on the mimic.">
            {pmPanel()}
          </Section>

          <Section heading="Weaknesses & savings (estimates)" caption="Generated from the numbers entered. Ranked by estimated £/yr; findings without a £ value follow, most serious first.">
            <Callout tone={pmSaveTot > 0 ? "warning" : "success"} lead={`Estimated savings ≈ £${fmt(pmSaveTot, 0)}/yr.`}>
              These are screening estimates from typical guide values and your inputs, not guarantees. Some savings overlap (for example degasser performance and WBA/SBA balance both act on SBA regenerations), so treat the total as an upper bound. Confirm each one with plant trials, resin supplier projections and metered data before acting.
            </Callout>
            <Table
              columns={["#", "Finding", "Est. saving (£/yr)"]}
              align={["start", "start", "end"]}
              rows={pmDiagSorted.map((d: PmDiag, i: number) => [String(i + 1), { text: d.text, tone: d.tone }, d.save > 0 ? fmt(d.save, 0) : "–"])}
            />
          </Section>

          <Section heading="All vessels" collapsible defaultOpen>
            <Table
              columns={["Unit", "Status", "Flow (m³/h)", "m/h", "BV/h", "m³/cycle", "Run used", "Left (m³)", "Left (h)", "Run (h)", "£/regen"]}
              align={["start", "start", "end", "end", "end", "end", "end", "end", "end", "end", "end"]}
              rows={pmRes.map((r: PmRes) => {
                const c = pmTone(r);
                const tone: Tone | null = r.used >= 100 && r.status !== "regen" && r.status !== "oos" ? "danger" : r.status === "svc" && r.used >= 90 ? "warning" : r.status === "svc" ? "success" : null;
                return [r.label, tone ? { text: c.lbl, tone } : c.lbl, fmt(r.flow, 1), fmt(r.vel, 1), fmt(r.bvh, 1), fmt(r.thr, 0), `${fmt(r.used, 0)}%`, fmt(r.remM3, 0), fmt(r.remH, 1), fmt(r.runH, 1), fmt(r.regCost, 0)];
              })}
            />
          </Section>

          <Section heading="Stages: load, availability and regenerations" collapsible defaultOpen>
            <Table
              columns={["Stage", "Load (eq/m³)", "In service / available", "Hydraulic max (m³/h)", "N−1 max (m³/h)", "Needed (m³/h)", "N−1 run (h)", "Regen (h)", "N−1", "Regens/week", "Chemicals (£/yr)", "Waste (m³/yr)"]}
              align={["start", "end", "end", "end", "end", "end", "end", "end", "start", "end", "end", "end"]}
              rows={pmStages.map((s: PmStage) => [
                PM_SNAME[s.t], fmt(pmLoad[s.t], 3), `${s.nSvc} / ${s.nAvail}`, fmt(s.capAll, 0), fmt(s.capN1, 0), fmt(s.need, 0), fmt(s.runN1, 1), fmt(pmRT[s.t], 1),
                s.okN1 ? { text: "Met", tone: "success" } : { text: "Not met", tone: "danger" }, fmt((s.regYr / 365) * 7, 2), fmt(s.chemYr, 0), fmt(s.wasteYr, 0),
              ])}
            />
            <Text>{`Degasser: ${fmt(pmQ, 0)} of ${fmt(pmDgCap, 0)} m³/h (single unit, no standby). Transfer pumps: ${pmPd} duty + ${Math.max(pmPn - pmPd, 0)} standby, ${fmt(pmPd * n("pm_p_q"), 0)} m³/h duty capacity against ${fmt(pmDem, 0)} m³/h demand.`}</Text>
          </Section>

          <Section heading="Costs, regeneration times and resin" collapsible defaultOpen={false}>
            <Grid columns={4} plain>
              {inp("pm_c_hcl", "HCl price (£/t as delivered)")}
              {inp("pm_c_hcls", "HCl strength (%)")}
              {inp("pm_c_h2so4", "H₂SO₄ price (£/t as delivered)")}
              {inp("pm_c_h2so4s", "H₂SO₄ strength (%)")}
              {inp("pm_c_naoh", "NaOH price (£/t as delivered)")}
              {inp("pm_c_naohs", "NaOH strength (%)")}
              {inp("pm_c_kwh", "Power (£/kWh)")}
              {inp("pm_c_water", "Water (£/m³)")}
              {inp("pm_c_eff", "Effluent (£/m³)")}
              {inp("pm_rt_sac", "SAC regeneration time (h)")}
              {inp("pm_rt_an", "WBA/SBA regeneration time (h)")}
              {inp("pm_rt_mb", "Mixed bed regeneration time (h)")}
              {inp("pm_rc_sac", "SAC resin (£/L)")}
              {inp("pm_rl_sac", "SAC resin life (years)")}
              {inp("pm_rc_wba", "WBA resin (£/L)")}
              {inp("pm_rl_wba", "WBA resin life (years)")}
              {inp("pm_rc_sba", "SBA resin (£/L)")}
              {inp("pm_rl_sba", "SBA resin life (years)")}
              {inp("pm_rc_mb", "Mixed bed resin (£/L)")}
              {inp("pm_rl_mb", "Mixed bed resin life (years)")}
            </Grid>
          </Section>

          <Section heading="Plant mimic: formulas and assumptions" collapsible defaultOpen={false}>
            <Text>Stage loads (eq/m³ = meq/L): SAC = total cations; WBA = Cl + SO₄ + NO₃ + F (free mineral acidity); SBA = residual CO₂/44.01 + SiO₂/60.08 + PO₄; mixed beds = Na leakage/22.99 + silica leakage (µg/L)/60,080. CO₂ after SAC = total carbonate × 44,010 mg/L. If the degasser flow exceeds its capacity, CO₂ out is scaled by (Q/capacity)².</Text>
            <Text>Per vessel: capacity per cycle (eq) = resin volume (L) × operating capacity (eq/L); throughput per cycle (m³) = capacity ÷ load; flow per vessel = stage flow ÷ vessels in service (primary stages carry the feed flow, mixed beds the demand); run (h) = throughput ÷ flow; % used = throughput since regeneration ÷ throughput per cycle; velocity = flow ÷ (πD²/4); BV/h = flow × 1000 ÷ resin L.</Text>
            <Text>Regeneration: chemical (kg, 100%) = level (g/L) × resin L ÷ 1000; ratio = (kg × 1000 ÷ equivalent weight) ÷ capacity eq (HCl 36.46, H₂SO₄ 49.04, NaOH 40.00); efficiency = 1 ÷ ratio; waste water = rinse BV × resin m³ + chemical ÷ injection strength. Cost of chemical as 100% = price per tonne as delivered ÷ strength.</Text>
            <Text>Annual: product = demand × hours/day × days; regenerations/yr = water treated × load ÷ mean capacity per vessel; primary water = product + MB and anion regeneration water. If WBA/SBA regenerate as a pair, both stages regenerate at the higher of the two frequencies. With thoroughfare, WBA caustic is free (spent SBA caustic) and its dilution water is not counted.</Text>
            <Text>Availability (N−1): with the largest available unit out, the remaining units must pass the stage flow within the velocity/BV-h limits (SAC/WBA/SBA 40 m/h and 40 BV/h; mixed beds 60 m/h and 50 BV/h), and their run at the raised flow must exceed the regeneration time. Pumps: shaft kW = Q × H ÷ 367 ÷ pump efficiency; electrical kW = shaft ÷ motor efficiency.</Text>
            <Text>Savings logic: over-regeneration = chemical cost × (level − typical upper level) ÷ level (SAC HCl 100, H₂SO₄ 150, WBA 60, SBA 80, MB 120 g/L); degasser = extra SBA regenerations from CO₂ above 5 mg/L; pair imbalance = regenerations forced on the longer-running resin; MB = cost reduction if SAC Na leakage fell to 0.5 mg/L; pump efficiency = energy above a 75% efficient pump; oversize = 15% of pump energy (VSD or trim); rinse = water and effluent above typical BV.</Text>
          </Section>
        </Fragment>
      )}

      <Callout tone="info" lead="Engineering estimates.">
        Results use standard textbook formulas, published equilibrium constants and typical guide values. Check designs against manufacturer data, such as resin and membrane suppliers' design software, a full speciation model for brines, and the relevant standards before use.
      </Callout>

      <Section heading="Backup & transfer" caption="Save every tab to a file, a WTS1: settings code, or a named profile, and load it back on another phone." collapsible defaultOpen={false}>
        <Grid columns={4} plain>
          <Select label="What to save" options={[{ value: "all", label: "Whole app (all tabs)" }, { value: "pm", label: "Plant Mimic only" }]} value={ioScope} onChange={(x: string) => setIoScope(x)} />
          <Button label="Save to file" onClick={saveFile} />
          <Button label="Copy settings code" onClick={copyCode} />
        </Grid>
        <Text>Load from file (a .json saved with “Save to file”; loads whatever tabs it contains):</Text>
        <input type="file" accept=".json,application/json,text/plain" onChange={loadFile} style={{ color: pmTh.text.primary, fontFamily: pmTh.font.family }} />
        {codeOut ? (
          <Fragment>
            <Text>Your settings code (select all and copy if the clipboard is blocked):</Text>
            <textarea readOnly value={codeOut} onFocus={(e: ChangeEvent<HTMLTextAreaElement> | React.FocusEvent<HTMLTextAreaElement>) => e.currentTarget.select()} style={{ ...taStyle, background: pmTh.bg.subtle, color: pmTh.text.primary, border: `1px solid ${pmTh.border.default}` }} />
          </Fragment>
        ) : null}
        <Text>Paste settings code (or the contents of a saved file):</Text>
        <textarea value={codeIn} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCodeIn(e.target.value)} placeholder="WTS1:…" style={{ ...taStyle, background: pmTh.bg.elevated, color: pmTh.text.primary, border: `1px solid ${pmTh.border.default}` }} />
        <Grid columns={4} plain>
          <Button label="Paste settings code" onClick={() => { ioApply(parseSettings(codeIn), "settings code"); setCodeIn(""); }} />
        </Grid>
        {stOk ? (
          <Grid columns={4} plain>
            <Input label="Profile name (e.g. Site A demin)" value={profName} onChange={(x: string) => setProfName(x)} />
            <Button label="Save profile" onClick={saveProfile} />
            <Select label="Saved profiles" options={[{ value: "", label: Object.keys(profiles).length ? "Choose…" : "None yet" }, ...Object.keys(profiles).map((k: string) => ({ value: k, label: k }))]} value={profSel} onChange={(x: string) => setProfSel(x)} />
            <Button label="Load profile" onClick={() => { if (profiles[profSel]) ioApply(cleanVals(profiles[profSel]), `profile "${profSel}"`); }} />
            <Button label="Delete profile" onClick={deleteProfile} />
          </Grid>
        ) : null}
        {ioMsg ? <Text>{ioMsg}</Text> : null}
      </Section>
    </Page>
  );
}


