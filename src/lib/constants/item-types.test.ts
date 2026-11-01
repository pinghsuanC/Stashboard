import { describe, expect, it } from "vitest";

import {
  CREATABLE_ITEM_TYPE_NAMES,
  editableFieldsFor,
  isCodeItemType,
  isCreatableItemType,
  isGalleryItemType,
  isListItemType,
  isMarkdownItemType,
  isPromptItemType,
  SYSTEM_TYPE_COLORS,
} from "./item-types";

import { MOCK_ITEM_TYPES } from "../../../prisma/seed-data";

describe("prompt items, which can be optimized", () => {
  it("is prompts alone, not notes", () => {
    expect(isPromptItemType("prompt")).toBe(true);
    expect(isPromptItemType("note")).toBe(false);
  });

  it("matches the stored name exactly, and nothing on the prototype", () => {
    expect(isPromptItemType("Prompt")).toBe(false);
    expect(isPromptItemType("constructor")).toBe(false);
    expect(isPromptItemType("size")).toBe(false);
  });
});

describe("editable body fields per item type (E1)", () => {
  it("snippets and commands edit content and language", () => {
    expect(editableFieldsFor("snippet")).toEqual(["content", "language"]);
    expect(editableFieldsFor("command")).toEqual(["content", "language"]);
  });

  it("prompts and notes edit content only", () => {
    expect(editableFieldsFor("prompt")).toEqual(["content"]);
    expect(editableFieldsFor("note")).toEqual(["content"]);
  });

  it("links edit the URL only", () => {
    expect(editableFieldsFor("link")).toEqual(["url"]);
  });

  it("files, images and custom types edit no body field", () => {
    expect(editableFieldsFor("file")).toEqual([]);
    expect(editableFieldsFor("image")).toEqual([]);
    expect(editableFieldsFor("my-custom-type")).toEqual([]);
  });

  it("matches on the type name, not the display label", () => {
    expect(editableFieldsFor("Snippet")).toEqual([]);
  });

  it("a type named like an object property still gets nothing", () => {
    expect(editableFieldsFor("constructor")).toEqual([]);
    expect(editableFieldsFor("toString")).toEqual([]);
  });
});

describe("types the New Item dialog offers (R1)", () => {
  it("lists snippet, prompt, command, note, link, file and image, in that order", () => {
    expect(CREATABLE_ITEM_TYPE_NAMES).toEqual(["snippet", "prompt", "command", "note", "link", "file", "image"]);
  });

  it("each of them can be created", () => {
    for (const name of CREATABLE_ITEM_TYPE_NAMES) expect(isCreatableItemType(name)).toBe(true);
  });

  it("custom types can't be created", () => {
    expect(isCreatableItemType("my-custom-type")).toBe(false);
  });

  it("matches on the type name, not the display label", () => {
    expect(isCreatableItemType("Snippet")).toBe(false);
  });

  it("a type named like an object or array property can't be created", () => {
    expect(isCreatableItemType("constructor")).toBe(false);
    expect(isCreatableItemType("length")).toBe(false);
  });
});

describe("types whose content opens in the code editor (CE1)", () => {
  it("snippets and commands are code", () => {
    expect(isCodeItemType("snippet")).toBe(true);
    expect(isCodeItemType("command")).toBe(true);
  });

  it("prompts, notes, links, files, images and custom types are not", () => {
    for (const name of ["prompt", "note", "link", "file", "image", "my-custom-type"]) {
      expect(isCodeItemType(name)).toBe(false);
    }
  });

  it("matches on the type name, not the display label", () => {
    expect(isCodeItemType("Snippet")).toBe(false);
  });

  it("a type named like an object or set property is not code", () => {
    expect(isCodeItemType("constructor")).toBe(false);
    expect(isCodeItemType("size")).toBe(false);
  });
});

describe("types whose content opens in the Markdown editor (MD4)", () => {
  it("notes and prompts are Markdown", () => {
    expect(isMarkdownItemType("note")).toBe(true);
    expect(isMarkdownItemType("prompt")).toBe(true);
  });

  it("snippets, commands, links, files, images and custom types are not", () => {
    for (const name of ["snippet", "command", "link", "file", "image", "my-custom-type"]) {
      expect(isMarkdownItemType(name)).toBe(false);
    }
  });

  it("no type opens in both the code and the Markdown editor", () => {
    for (const name of ["snippet", "command", "prompt", "note", "link", "file", "image"]) {
      expect(isCodeItemType(name) && isMarkdownItemType(name)).toBe(false);
    }
  });

  it("matches on the type name, not the display label", () => {
    expect(isMarkdownItemType("Note")).toBe(false);
  });

  it("a type named like an object or set property is not Markdown", () => {
    expect(isMarkdownItemType("constructor")).toBe(false);
    expect(isMarkdownItemType("size")).toBe(false);
  });
});

describe("types whose page lists files as rows (FL1)", () => {
  it("files list as rows", () => {
    expect(isListItemType("file")).toBe(true);
  });

  it("snippets, commands, prompts, notes, links, images and custom types do not", () => {
    for (const name of ["snippet", "command", "prompt", "note", "link", "image", "my-custom-type"]) {
      expect(isListItemType(name)).toBe(false);
    }
  });

  it("no type is both a gallery and a file list", () => {
    for (const name of ["snippet", "command", "prompt", "note", "link", "file", "image"]) {
      expect(isGalleryItemType(name) && isListItemType(name)).toBe(false);
    }
  });

  it("matches on the type name, not the display label", () => {
    expect(isListItemType("File")).toBe(false);
    expect(isListItemType("Files")).toBe(false);
  });

  it("a type named like an object or set property is not a list", () => {
    expect(isListItemType("constructor")).toBe(false);
    expect(isListItemType("size")).toBe(false);
  });
});

describe("system type colours for pages without a session (H1)", () => {
  // The signed-out homepage can't read ItemType.color, so it uses this copy.
  it("match the colours the seed gives every system type", () => {
    const seeded = Object.fromEntries(MOCK_ITEM_TYPES.map(({ name, color }) => [name, color]));
    expect(SYSTEM_TYPE_COLORS).toEqual(seeded);
  });
});
