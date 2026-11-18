import { describe, expect, test } from "vitest";
import { SLUG_ALPHABET, SLUG_LENGTH, generateSlug, isValidSlug, qrPng, qrSvg, scanUrl } from "../src/lib/qr";

describe("slugs", () => {
  test("are 8 characters from an alphabet with no look-alikes (no i, l, o, 0 or 1)", () => {
    expect(SLUG_LENGTH).toBe(8);
    for (const bad of "ilo01") expect(SLUG_ALPHABET).not.toContain(bad);
    for (let i = 0; i < 200; i++) {
      const s = generateSlug();
      expect(s).toHaveLength(8);
      expect([...s].every((c) => SLUG_ALPHABET.includes(c)), s).toBe(true);
    }
  });

  test("are random: no repeats in a few thousand, and every character of the alphabet turns up", () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const s = generateSlug();
      seen.add(s);
      for (const c of s) chars.add(c);
    }
    expect(seen.size).toBe(3000);
    expect(chars.size).toBe(SLUG_ALPHABET.length);
  });

  test("use the random source they are given, so the choice is not biased towards the start of the alphabet", () => {
    // A byte of 248 or more is thrown away: 256 does not divide evenly by the alphabet size.
    const bytes = [255, 250, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    let i = 0;
    const s = generateSlug((n) => Buffer.from(Array.from({ length: n }, () => bytes[i++ % bytes.length])));
    expect(s.startsWith(SLUG_ALPHABET[0] + SLUG_ALPHABET[1])).toBe(true);
  });

  test("isValidSlug accepts only what generateSlug makes", () => {
    expect(isValidSlug(generateSlug())).toBe(true);
    for (const bad of ["", "short", "waytoolongslug", "ABCDEFGH", "abcdefg1", "abc defg", "abcdefg;", "abcd/efg", "abcdefgh\n"]) expect(isValidSlug(bad), bad).toBe(false);
  });
});

describe("scanUrl", () => {
  test("is the site address plus /q/ and the slug, whether or not the address ends in a slash", () => {
    expect(scanUrl("https://shop.example.com", "abcdefgh")).toBe("https://shop.example.com/q/abcdefgh");
    expect(scanUrl("https://shop.example.com/", "abcdefgh")).toBe("https://shop.example.com/q/abcdefgh");
  });
  test("refuses a slug that is not one of ours, so a bad value never becomes part of an address", () => {
    expect(() => scanUrl("https://shop.example.com", "../admin")).toThrow();
  });
});

describe("images", () => {
  const url = "https://shop.example.com/q/abcdefgh";

  test("the SVG is a plain vector image with nothing executable in it", async () => {
    const svg = await qrSvg(url);
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    expect(svg).not.toMatch(/<script|onload|javascript:/i);
  });

  test("different addresses give different codes, and the same address gives the same code", async () => {
    expect(await qrSvg(url)).toBe(await qrSvg(url));
    expect(await qrSvg(url)).not.toBe(await qrSvg(`${url}x`));
  });

  test("the PNG is a real PNG of the size asked for", async () => {
    const png = await qrPng(url, 600);
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.readUInt32BE(16)).toBe(600); // width, from the IHDR chunk
    expect(png.readUInt32BE(20)).toBe(600);
  });

  test("a size that would make a huge file is refused", async () => {
    await expect(qrPng(url, 100_000)).rejects.toThrow(RangeError);
    await expect(qrPng(url, 10)).rejects.toThrow(RangeError);
  });
});
