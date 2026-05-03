import { describe, expect, it } from "vitest";
import { assertSafeId, InvalidIdError } from "./storage";

describe("assertSafeId", () => {
  describe("accepts valid ids", () => {
    it.each([
      ["asset-abc123"],
      ["wf-image-z-index-momv4gxf"],
      ["env-79s74vm3"],
      ["a"],
      ["v1.0.0"],
      ["with_underscores"],
      ["with-dashes-and.dots"],
      ["a".repeat(128)],
    ])("%s", (id) => {
      expect(() => assertSafeId(id)).not.toThrow();
    });
  });

  describe("rejects unsafe ids", () => {
    it.each([
      ["..", "parent-directory traversal"],
      ["../etc/passwd", "absolute traversal"],
      ["foo/../bar", "embedded traversal"],
      [".hidden", "leading dot (hidden file)"],
      ["", "empty"],
      ["with space", "whitespace"],
      ["with/slash", "path separator"],
      ["with\\backslash", "windows path separator"],
      ["a".repeat(129), "exceeds 128 chars"],
      ["MixedCase123", "uppercase (case-insensitive FS collision risk)"],
      ["asset-ABC", "uppercase variant of an existing lowercase id"],
      ["con", "Windows DOS device name (con)"],
      ["nul", "Windows DOS device name (nul)"],
      ["prn", "Windows DOS device name (prn)"],
      ["aux", "Windows DOS device name (aux)"],
      ["com1", "Windows DOS device name (com1)"],
      ["lpt9", "Windows DOS device name (lpt9)"],
      ["con.txt", "DOS device name with extension still reserved on Windows"],
      ["nul.json", "DOS device name with extension"],
      ["aux.tar.gz", "DOS device name with multiple extensions"],
    ])("%s (%s)", (id) => {
      expect(() => assertSafeId(id)).toThrow(InvalidIdError);
    });
  });

  describe("accepts ids that look like reserved names but aren't", () => {
    it.each([
      ["connection"],
      ["console"],
      ["communicate"],
      ["aux-driver"],
      ["lpt-printer"],
      ["nuls"],
      ["prnter"],
      ["com10"], // only com0..com9 are reserved
      ["lpt10"],
    ])("%s", (id) => {
      expect(() => assertSafeId(id)).not.toThrow();
    });
  });

  it("error message includes the offending id (json-quoted)", () => {
    expect(() => assertSafeId("..")).toThrow(/"\.\."/);
  });
});
