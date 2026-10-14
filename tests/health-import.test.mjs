import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp, memoryStorage } from "./load-app.mjs";

const TODAYK = "2026-10-14";
const plain = (v) => JSON.parse(JSON.stringify(v));

function setup(search, { stored = {}, hash = "#today" } = {}) {
  const localStorage = memoryStorage(
    Object.keys(stored).length ? { vr2_health: JSON.stringify(stored) } : {},
  );
  const toasts = [];
  const replaced = [];
  const window = {};
  const app = loadApp(
    ["dkey", "parseK", "LS", "HF", "hNum", "hDate", "importHealth"],
    {
      localStorage,
      location: { search, pathname: "/rehab-plan/", hash },
      history: { replaceState: (_s, _t, url) => replaced.push(url) },
      toast: (m) => toasts.push(m),
      setTimeout: (fn) => fn(),
      window,
    },
    `const TODAYK=${JSON.stringify(TODAYK)};`,
  );
  const health = () => plain(app.LS.get("health", {}));
  return { app, health, toasts, replaced, localStorage, window };
}

const { hNum, hDate } = setup("").app;

describe("hNum", () => {
  test("parses plain, comma-grouped and space-grouped numbers", () => {
    assert.equal(hNum("8123", 0, 200000, 0), 8123);
    assert.equal(hNum("8,123", 0, 200000, 0), 8123);
    assert.equal(hNum(" 12 345 ", 0, 200000, 0), 12345);
    assert.equal(hNum(42, 0, 100, 0), 42);
  });

  test("rounds to the requested decimal places", () => {
    assert.equal(hNum("5.678", 0, 300, 2), 5.68);
    assert.equal(hNum("5.5", 0, 300, 0), 6);
    assert.equal(hNum("0.004", 0, 300, 2), 0);
  });

  test("enforces inclusive bounds", () => {
    assert.equal(hNum("20", 20, 220, 0), 20);
    assert.equal(hNum("220", 20, 220, 0), 220);
    assert.equal(hNum("19", 20, 220, 0), null);
    assert.equal(hNum("221", 20, 220, 0), null);
  });

  test("rejects missing and non-numeric input", () => {
    for (const raw of [null, undefined, "", "abc", "12abc", "-5", "1e3", "0x10", "NaN", "Infinity", ".5", "5."]) {
      assert.equal(hNum(raw, 0, 1e9, 0), null, `expected ${JSON.stringify(raw)} to be rejected`);
    }
  });
});

describe("hDate", () => {
  test("accepts real YYYY-MM-DD dates", () => {
    assert.equal(hDate("2026-10-14"), "2026-10-14");
    assert.equal(hDate("2028-02-29"), "2028-02-29");
  });

  test("rejects wrong formats and impossible dates", () => {
    for (const s of [null, "", "2026-1-4", "14/10/2026", "2026-10-14T00:00", "2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10"]) {
      assert.equal(hDate(s), null, `expected ${JSON.stringify(s)} to be rejected`);
    }
  });
});

describe("importHealth", () => {
  test("is a no-op when the URL has no health params", () => {
    const s = setup("?foo=1&bar=2");
    assert.equal(s.app.importHealth(), 0);
    assert.equal(s.localStorage.length, 0);
    assert.deepEqual(s.replaced, []);
    assert.deepEqual(s.toasts, []);
  });

  test("stores valid values under the given date and strips the query string", () => {
    const s = setup("?date=2026-10-10&steps=8,500&distance_km=6.237&rhr=62");
    assert.equal(s.app.importHealth(), 3);
    const day = s.health()["2026-10-10"];
    assert.equal(day.steps, 8500);
    assert.equal(day.distance_km, 6.24);
    assert.equal(day.rhr, 62);
    assert.equal(day.src, "Shortcut");
    assert.equal(typeof day.at, "number");
    assert.deepEqual(s.replaced, ["/rehab-plan/#today"]);
    assert.equal(JSON.parse(s.localStorage.getItem("vr2_health"))["2026-10-10"].steps, 8500);
    assert.match(s.toasts[0], /imported.*2026-10-10/);
  });

  test("falls back to today when the date is missing or invalid", () => {
    for (const q of ["?steps=100", "?date=2026-02-30&steps=100", "?date=garbage&steps=100"]) {
      const s = setup(q);
      assert.equal(s.app.importHealth(), 1);
      assert.deepEqual(Object.keys(s.health()), [TODAYK], q);
    }
  });

  test("drops invalid and out-of-range values but keeps the valid ones", () => {
    const s = setup("?steps=abc&rhr=300&active_kcal=-20&azm=30&unknown=5");
    assert.equal(s.app.importHealth(), 1);
    const day = s.health()[TODAYK];
    assert.equal(day.azm, 30);
    for (const f of ["steps", "rhr", "active_kcal", "unknown"]) assert.equal(f in day, false, f);
  });

  test("writes nothing when every value is invalid, but still cleans the URL", () => {
    const s = setup("?date=2026-10-10&steps=lots&rhr=5");
    assert.equal(s.app.importHealth(), 0);
    assert.equal(s.localStorage.getItem("vr2_health"), null);
    assert.deepEqual(s.replaced, ["/rehab-plan/#today"]);
    assert.match(s.toasts[0], /no valid numbers/);
  });

  test("derives total_kcal from active + resting only when total is absent", () => {
    let s = setup("?active_kcal=450.4&resting_kcal=2100.3");
    assert.equal(s.app.importHealth(), 3);
    assert.equal(s.health()[TODAYK].total_kcal, 2550);

    s = setup("?active_kcal=450&resting_kcal=2100&total_kcal=2700");
    s.app.importHealth();
    assert.equal(s.health()[TODAYK].total_kcal, 2700);

    s = setup("?active_kcal=450");
    s.app.importHealth();
    assert.equal("total_kcal" in s.health()[TODAYK], false);
  });

  test("merges into existing data for the day without touching other days", () => {
    const stored = {
      "2026-10-10": { steps: 4000, rhr: 70, acts: [{ n: "Walk", min: 30 }], src: "Fitbit", at: 1 },
      "2026-10-09": { steps: 9000, src: "Fitbit", at: 1 },
    };
    const s = setup("?date=2026-10-10&steps=8500", { stored });
    s.app.importHealth();
    const h = s.health();
    assert.deepEqual(h["2026-10-09"], stored["2026-10-09"]);
    assert.equal(h["2026-10-10"].steps, 8500);
    assert.equal(h["2026-10-10"].rhr, 70);
    assert.deepEqual(h["2026-10-10"].acts, [{ n: "Walk", min: 30 }]);
    assert.equal(h["2026-10-10"].src, "Shortcut");
  });

  test("sets the daily report date to the imported day", () => {
    const s = setup("?date=2026-10-11&steps=1");
    s.app.importHealth();
    assert.equal(s.window._rd, "2026-10-11");
  });
});
