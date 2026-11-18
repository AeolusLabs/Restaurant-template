import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { closePools } from "../src/db/context";
import { createCategory, createItem } from "../src/db/menu-admin";
import { removeItemImage, setItemImage } from "../src/db/item-image";
import { ImageError, MAX_IMAGE_BYTES, detectImageType, prepareImage } from "../src/lib/image-upload";
import { serveMedia } from "../src/lib/media";
import { MemoryStorageProvider } from "../src/providers/storage/memory";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

const pad = (head: number[], total = 64) => Uint8Array.from([...head, ...Array(Math.max(0, total - head.length)).fill(7)]);
const jpeg = () => pad([0xff, 0xd8, 0xff, 0xe0]);
const png = () => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = () => pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const text = (s: string) => new TextEncoder().encode(s);

describe("detectImageType", () => {
  test("recognises JPEG, PNG and WebP by their first bytes", () => {
    expect(detectImageType(jpeg())).toBe("image/jpeg");
    expect(detectImageType(png())).toBe("image/png");
    expect(detectImageType(webp())).toBe("image/webp");
  });

  test("refuses scripts, HTML, SVG, GIF and anything else, whatever the file was called", () => {
    for (const bad of [text("<script>alert(1)</script>"), text("<!doctype html><html></html>"), text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), text("GIF89a......"), pad([0x00, 0x01]), new Uint8Array(0), pad([0xff, 0xd8])]) {
      expect(detectImageType(bad)).toBeNull();
    }
    expect(detectImageType(pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // a WAV file also starts with RIFF
  });
});

describe("prepareImage", () => {
  test("gives a random key with the right extension, and the detected type", () => {
    const a = prepareImage(png());
    const b = prepareImage(png());
    expect(a.key).toMatch(/^menu\/[0-9a-f-]{36}\.png$/);
    expect(a.key).not.toBe(b.key);
    expect(a.contentType).toBe("image/png");
    expect(prepareImage(jpeg()).key).toMatch(/\.jpg$/);
    expect(prepareImage(webp()).key).toMatch(/\.webp$/);
  });

  test("refuses an empty file, a file that is not an image, and one over 2 MB", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as ImageError).code;
      }
      return "none";
    };
    expect(code(() => prepareImage(new Uint8Array(0)))).toBe("empty");
    expect(code(() => prepareImage(text("<script>")))).toBe("unsupported");
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(jpeg());
    expect(code(() => prepareImage(big))).toBe("too_large");
    const edge = new Uint8Array(MAX_IMAGE_BYTES);
    edge.set(jpeg());
    expect(code(() => prepareImage(edge))).toBe("none");
  });
});

describe("serveMedia", () => {
  async function stored(bytes = png(), type = "image/png", key = "menu/0194f3c0-0000-7000-8000-00000000000a.png") {
    const storage = new MemoryStorageProvider();
    await storage.put(key, bytes, type);
    return { storage, key };
  }

  test("serves a stored image with its type, long caching and no sniffing", async () => {
    const { storage, key } = await stored();
    const res = await serveMedia(key.split("/"), storage);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png());
  });

  test("an unknown key is a 404", async () => {
    const { storage } = await stored();
    expect((await serveMedia(["menu", "0194f3c0-0000-7000-8000-0000000000ff.png"], storage)).status).toBe(404);
  });

  test("keys that are not ours, or that try to climb out of the folder, are a 404 and never reach storage", async () => {
    const storage = new MemoryStorageProvider();
    let touched = false;
    storage.getStream = async () => ((touched = true), null);
    for (const parts of [["..", "etc", "passwd"], ["menu", "..", "x.png"], ["menu", "../secret.png"], ["other", "0194f3c0-0000-7000-8000-00000000000a.png"], ["menu", "UPPER.PNG"], ["menu"], [], ["menu", "a", "b.png"], ["menu", "0194f3c0-0000-7000-8000-00000000000a.png%00"]]) {
      expect((await serveMedia(parts, storage)).status, JSON.stringify(parts)).toBe(404);
    }
    expect(touched).toBe(false);
  });

  test("something stored under a valid key that is not an image type is not served", async () => {
    const { storage, key } = await stored(text("<script>alert(1)</script>"), "text/html");
    expect((await serveMedia(key.split("/"), storage)).status).toBe(404);
  });
});

describe("setItemImage and removeItemImage", () => {
  async function item() {
    const { ctx } = await makeUser("manager");
    const cat = await createCategory(ctx, { name: `img ${Date.now()}` }, o);
    const it = await createItem(ctx, { categoryId: cat.id, name: "Photo dish", priceMinor: 100 }, o);
    return { ctx, id: it.id };
  }
  const keyOf = async (id: string) => (await admin().query(`select image_key from menu_items where id = $1`, [id])).rows[0].image_key as string | null;

  test("stores the picture, points the item at it, and replaces the old one", async () => {
    const storage = new MemoryStorageProvider();
    const { ctx, id } = await item();
    const first = await setItemImage(ctx, id, png(), storage, o);
    expect(await keyOf(id)).toBe(first);
    expect(await storage.getStream(first)).not.toBeNull();
    const second = await setItemImage(ctx, id, jpeg(), storage, o);
    expect(second).not.toBe(first);
    expect(await keyOf(id)).toBe(second);
    expect(await storage.getStream(first)).toBeNull(); // the old file is gone
  });

  test("a bad file changes nothing and stores nothing", async () => {
    const storage = new MemoryStorageProvider();
    const { ctx, id } = await item();
    const before = await setItemImage(ctx, id, png(), storage, o);
    await expect(setItemImage(ctx, id, text("<script>alert(1)</script>"), storage, o)).rejects.toBeInstanceOf(ImageError);
    expect(await keyOf(id)).toBe(before);
  });

  test("removing the picture clears the key and deletes the file", async () => {
    const storage = new MemoryStorageProvider();
    const { ctx, id } = await item();
    const key = await setItemImage(ctx, id, webp(), storage, o);
    await removeItemImage(ctx, id, storage, o);
    expect(await keyOf(id)).toBeNull();
    expect(await storage.getStream(key)).toBeNull();
  });

  test("kitchen and customers cannot change pictures", async () => {
    const storage = new MemoryStorageProvider();
    const { id } = await item();
    for (const role of ["kitchen", "customer"] as const) {
      const { ctx } = await makeUser(role);
      await expect(setItemImage(ctx, id, png(), storage, o)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
