import { describe, expect, test } from "vitest";
import { toPublicUser } from "../src/lib/sanitize";

const row = {
  id: "0194f3c0-0000-7000-8000-00000000000a",
  name: "Ada",
  email: "ada@example.com",
  role: "customer",
};

describe("toPublicUser", () => {
  test("returns only id, name, email and role", () => {
    expect(toPublicUser(row)).toEqual(row);
  });

  test("drops passwordHash, resetToken and any unknown field", () => {
    const out = toPublicUser({
      ...row,
      passwordHash: "x",
      password_hash: "x",
      resetToken: "t",
      verificationToken: "t",
      apiKey: "k",
      phone: "0800",
      emailVerified: true,
    });
    expect(Object.keys(out).sort()).toEqual(["email", "id", "name", "role"]);
    expect(JSON.stringify(out)).not.toMatch(/passwordHash|password_hash|resetToken|verificationToken|apiKey|0800/);
  });

  test("reads the name from fullName or full_name when name is absent", () => {
    expect(toPublicUser({ ...row, name: undefined, fullName: "Ada L" }).name).toBe("Ada L");
    expect(toPublicUser({ ...row, name: undefined, full_name: "Ada S" }).name).toBe("Ada S");
  });

  test("throws when id is missing", () => {
    expect(() => toPublicUser({ ...row, id: undefined })).toThrow(/id/);
    expect(() => toPublicUser(null)).toThrow();
    expect(() => toPublicUser("nope")).toThrow();
  });

  test("throws when the role is not a known role", () => {
    expect(() => toPublicUser({ ...row, role: "admin" })).toThrow(/role/);
    expect(() => toPublicUser({ ...row, role: undefined })).toThrow(/role/);
  });

  test("does not mutate its input", () => {
    const input = { ...row, passwordHash: "x" };
    toPublicUser(input);
    expect(input.passwordHash).toBe("x");
  });
});
