import { describe, expect, test } from "bun:test";
import { buildCostBreakdown, OTHER_SERVICE, shiftMonth, type CostLineRow } from "./cost-breakdown";

function row(p: Partial<CostLineRow> & Pick<CostLineRow, "month" | "service" | "listAmount">): CostLineRow {
  const discount = p.discount ?? 0;
  const credit = p.credit ?? 0;
  return {
    resourceExternalId: "buzz-445414",
    resourceName: "pathors",
    sku: "",
    cluster: "",
    currency: "USD",
    net: p.listAmount + discount + credit,
    ...p,
    discount,
    credit,
  };
}

describe("shiftMonth", () => {
  test("crosses years", () => {
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2025-12-01", 1)).toBe("2026-01-01");
    expect(shiftMonth("2026-10-01", -5)).toBe("2026-05-01");
  });
});

describe("buildCostBreakdown", () => {
  const rows: CostLineRow[] = [
    row({ month: "2026-10-01", service: "Compute Engine", sku: "Nvidia L4 GPU running in Americas", listAmount: 835.43, credit: -835.43 }),
    row({ month: "2026-10-01", service: "Compute Engine", sku: "E2 Instance Core running in APAC", cluster: "pathors-tw", listAmount: 698.49, credit: -698.49 }),
    row({ month: "2026-10-01", service: "Kubernetes Engine", sku: "Zonal Kubernetes Clusters", cluster: "pathors-us", listAmount: 74.54, discount: -74.54 }),
    row({ month: "2026-10-01", service: "Places API (New)", listAmount: 12.12 }),
    row({ month: "2026-10-01", service: "Geocoding API", listAmount: 0 }),
    row({ month: "2026-09-01", service: "Compute Engine", sku: "Nvidia L4 GPU running in Americas", listAmount: 500, credit: -500 }),
    row({ month: "2026-09-01", service: "Cloud SQL", listAmount: 100, credit: -100 }),
  ];
  const b = buildCostBreakdown(rows, "2026-10-01");

  test("services sorted by list cost with three amounts", () => {
    expect(b.services.map((s) => s.service)).toEqual(["Compute Engine", "Kubernetes Engine", "Places API (New)", "Cloud SQL"]);
    const ce = b.services[0];
    expect(ce).toMatchObject({ listAmount: 1533.92, credit: -1533.92, net: 0, prevListAmount: 500 });
    expect(b.total).toEqual({ listAmount: 1620.58, discount: -74.54, credit: -1533.92, net: 12.12 });
    expect(b.prevTotal.listAmount).toBe(600);
  });

  test("zero services are hidden, services only in last month stay for comparison", () => {
    expect(b.services.find((s) => s.service === "Geocoding API")).toBeUndefined();
    expect(b.services.find((s) => s.service === "Cloud SQL")).toMatchObject({ listAmount: 0, prevListAmount: 100 });
  });

  test("details are SKU × cluster with the previous month", () => {
    const [gpu, e2] = b.services[0].details;
    expect(gpu).toMatchObject({ label: "Nvidia L4 GPU running in Americas", sub: null, listAmount: 835.43, prevListAmount: 500 });
    expect(e2).toMatchObject({ label: "E2 Instance Core running in APAC", sub: "pathors-tw" });
  });

  test("project shows in the detail only when the account has several", () => {
    const multi = buildCostBreakdown(
      [...rows, row({ month: "2026-10-01", service: "Compute Engine", sku: "Nvidia L4 GPU running in Americas", resourceExternalId: "lab", resourceName: "lab", listAmount: 1 })],
      "2026-10-01",
    );
    expect(multi.services[0].details.find((d) => d.listAmount === 835.43)?.sub).toBe("pathors");
  });

  test("rows without SKU fall back to the resource", () => {
    const [d] = b.services.find((s) => s.service === "Places API (New)")!.details;
    expect(d).toMatchObject({ label: "pathors", sub: null });
  });

  test("trend starts at the first month with data, oldest first, and folds the tail into other", () => {
    const t = buildCostBreakdown(rows, "2026-10-01", { trendServices: 2 });
    expect(t.trend.map((p) => p.month)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(t.trendServices).toEqual(["Compute Engine", OTHER_SERVICE]);
    expect(t.trend[1].byService).toEqual({ "Compute Engine": 1533.92, [OTHER_SERVICE]: 86.66 });
    expect(t.trend[0].total).toBe(600);
  });

  test("trend keeps six months when history is long enough", () => {
    const long = [...rows, row({ month: "2026-01-01", service: "Cloud SQL", listAmount: 1 })];
    expect(buildCostBreakdown(long, "2026-10-01").trend.map((p) => p.month)[0]).toBe("2026-05-01");
  });
});
