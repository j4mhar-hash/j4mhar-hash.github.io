// Hand-added UK chargers missing from Open Charge Map / OCPI feeds.
// Public sites are merged into the snapshot by the build scripts. access:'private'
// sites stay in this file and are hidden until "Include private / staff chargers" is on.
window.MANUAL_CHARGERS = {
  generated: "2026-10-27T00:00:00.000Z",
  source: "Manual additions (verified public sites missing from OCM/OCPI, plus private staff sites)",
  count: 2,
  items: [
    {
      id: "manual-drax-hub-visitors",
      a: 53.73061,
      o: -0.99468,
      k: 22,
      c: ["T2"],
      n: "Drax Power Station – Hub Visitors",
      op: "Drax",
      cap: 2,
      ad: "Drax Power Station, Selby, YO8 8PH"
    },
    {
      id: "manual-drax-staff-car-park",
      a: 53.73875,
      o: -0.99113,
      k: 22,
      c: ["T2"],
      n: "Drax Power Station – staff car park",
      op: "Drax",
      cap: 10,
      ad: "Drax Power Station, Selby, YO8",
      access: "private",
      approx: true,
      note: "Drax staff only – employees may use. 10 × Type 2 at 22 kW, approx., reported by a user."
    }
  ]
};
