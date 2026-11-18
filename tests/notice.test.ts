import { describe, expect, test } from "vitest";
import { buildNoticeUrl, valuesFrom } from "../src/lib/notice-url";

describe("buildNoticeUrl", () => {
  test("adds a notice or an error to the path", () => {
    expect(buildNoticeUrl("/admin/menu", { notice: "Saved." })).toBe("/admin/menu?notice=Saved.");
    expect(buildNoticeUrl("/admin/menu", { error: "Enter a price" })).toBe("/admin/menu?error=Enter+a+price");
  });

  test("keeps an existing query string", () => {
    expect(buildNoticeUrl("/admin/menu/items/new?category=abc", { error: "x" })).toBe("/admin/menu/items/new?category=abc&error=x");
  });

  test("with nothing to say, leaves the path alone", () => {
    expect(buildNoticeUrl("/admin", {})).toBe("/admin");
  });

  test("carries what the person typed so the form can show it again", () => {
    const url = buildNoticeUrl("/admin/menu/items/new", { error: "bad", values: { name: "Suya & chips", price: "3500.555" } });
    const q = new URL(url, "http://x").searchParams;
    expect(q.get("v_name")).toBe("Suya & chips");
    expect(q.get("v_price")).toBe("3500.555");
  });

  test("never puts an overlong value in the address", () => {
    const url = buildNoticeUrl("/a", { values: { description: "x".repeat(2000) } });
    expect(new URL(url, "http://x").searchParams.get("v_description")!.length).toBeLessThanOrEqual(500);
  });
});

describe("valuesFrom", () => {
  test("reads only the v_ parameters, as plain strings", () => {
    expect(valuesFrom({ v_name: "Suya", v_price: "10", notice: "hi", other: "x" })).toEqual({ name: "Suya", price: "10" });
  });

  test("ignores repeated parameters beyond the first, and non-strings", () => {
    expect(valuesFrom({ v_name: ["a", "b"], v_x: undefined })).toEqual({ name: "a" });
  });
});
