import { describe, expect, test } from "vitest";
import { landingPath, postSignInPath, staffGate } from "../src/domain/staff-gate";

describe("landingPath", () => {
  test("each role has its own home", () => {
    expect(landingPath("owner")).toBe("/admin");
    expect(landingPath("manager")).toBe("/admin");
    expect(landingPath("kitchen")).toBe("/kitchen");
    expect(landingPath("customer")).toBe("/");
  });
});

describe("postSignInPath", () => {
  test("with no particular destination, staff go to their own screens and customers to the menu", () => {
    expect(postSignInPath("owner", "/")).toBe("/admin");
    expect(postSignInPath("kitchen", "/")).toBe("/kitchen");
    expect(postSignInPath("customer", "/")).toBe("/");
  });

  test("a destination the person asked for is kept", () => {
    expect(postSignInPath("manager", "/admin/orders")).toBe("/admin/orders");
    expect(postSignInPath("customer", "/checkout")).toBe("/checkout");
  });
});

describe("staffGate", () => {
  test("lets in a role on the list", () => {
    expect(staffGate("manager", ["owner", "manager"], "/admin/staff")).toEqual({ ok: true });
  });

  test("sends someone who is not signed in to sign in, remembering where they were going", () => {
    expect(staffGate(null, ["owner"], "/admin/staff")).toEqual({ ok: false, redirect: "/sign-in?next=%2Fadmin%2Fstaff" });
  });

  test("sends a signed-in person with the wrong role to their own home, never back to the same screen", () => {
    expect(staffGate("kitchen", ["owner", "manager"], "/admin")).toEqual({ ok: false, redirect: "/kitchen" });
    expect(staffGate("manager", ["owner"], "/admin/staff")).toEqual({ ok: false, redirect: "/admin" });
    expect(staffGate("customer", ["owner", "manager", "kitchen"], "/admin")).toEqual({ ok: false, redirect: "/" });
  });

  test("a role that would be sent to the screen it is being refused on goes to the menu instead of looping", () => {
    // A manager refused on /admin (not on the list) would be sent to /admin again.
    expect(staffGate("manager", ["kitchen"], "/admin")).toEqual({ ok: false, redirect: "/" });
  });
});
