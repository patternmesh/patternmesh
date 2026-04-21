#!/usr/bin/env node
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const siteDir = join(repoRoot, "site");
const templatePath = join(__dirname, "site-template.html");

const template = readFileSync(templatePath, "utf8");

/** Source markdown → destination inside site (relative to siteDir). */
const pages = [
  { src: "README.md", dest: "index.html", title: "patternmesh" },
  { src: "CHANGELOG.md", dest: "CHANGELOG.html", title: "Changelog" },
  { src: "ROADMAP.md", dest: "ROADMAP.html", title: "Roadmap" },
  { src: "CONTRIBUTING.md", dest: "CONTRIBUTING.html", title: "Contributing" },
  { src: "SECURITY.md", dest: "SECURITY.html", title: "Security" },
  { src: "CODE_OF_CONDUCT.md", dest: "CODE_OF_CONDUCT.html", title: "Code of Conduct" },
  { src: "RELEASE_CHECKLIST.md", dest: "RELEASE_CHECKLIST.html", title: "Release checklist" },
  { src: "docs/single-table-patterns.md", dest: "docs/single-table-patterns.html", title: "Single-table design" },
  { src: "docs/table-setup.md", dest: "docs/table-setup.html", title: "Table setup" },
  { src: "docs/API_REFERENCE.md", dest: "docs/API_REFERENCE.html", title: "API reference" },
  { src: "docs/guides/relations.md", dest: "docs/guides/relations.html", title: "Relations cookbook" },
  { src: "docs/guides/bundles-and-recipes.md", dest: "docs/guides/bundles-and-recipes.html", title: "Bundles and recipes" },
  { src: "docs/guides/lifecycle.md", dest: "docs/guides/lifecycle.html", title: "Lifecycle recipes" },
  { src: "docs/guides/complex-attributes.md", dest: "docs/guides/complex-attributes.html", title: "Complex attributes" },
  { src: "docs/guides/streams-advanced.md", dest: "docs/guides/streams-advanced.html", title: "Streams advanced" },
  { src: "packages/core/README.md", dest: "packages/core/index.html", title: "@patternmesh/core" },
  { src: "packages/adapter-aws-sdk-v3/README.md", dest: "packages/adapter-aws-sdk-v3/index.html", title: "@patternmesh/aws-sdk-v3" },
  { src: "packages/streams/README.md", dest: "packages/streams/index.html", title: "@patternmesh/streams" },
];

function rewriteHref(href) {
  if (!href) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  if (href.startsWith("#")) return href;
  if (href.startsWith("/")) return href;

  const [pathPart, anchor = ""] = href.split("#");
  const anchorSuffix = anchor ? `#${anchor}` : "";

  let rewritten = pathPart;
  if (rewritten.endsWith("README.md")) {
    rewritten = rewritten.replace(/README\.md$/, "index.html");
  } else if (rewritten.endsWith(".md")) {
    rewritten = rewritten.replace(/\.md$/, ".html");
  }
  return rewritten + anchorSuffix;
}

function renderMarkdown(md) {
  const renderer = new marked.Renderer();
  const originalLink = renderer.link.bind(renderer);
  renderer.link = function link({ href, title, tokens }) {
    return originalLink({ href: rewriteHref(href), title, tokens });
  };
  return marked.parse(md, { renderer, async: false, gfm: true });
}

function rootRelative(destPath) {
  const depth = destPath.split("/").length - 1;
  if (depth === 0) return "";
  return "../".repeat(depth);
}

function writePage({ src, dest, title }) {
  const srcPath = join(repoRoot, src);
  if (!existsSync(srcPath)) {
    console.warn(`[build-site] missing source, skipping: ${src}`);
    return;
  }
  const md = readFileSync(srcPath, "utf8");
  const body = renderMarkdown(md);
  const html = template
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{ROOT}}", rootRelative(dest))
    .replaceAll("{{BODY}}", body);

  const outPath = join(siteDir, dest);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
}

function copyTypedocIfPresent() {
  const map = [
    { from: "docs/api/core", to: "api/core" },
    { from: "docs/api/aws-sdk-v3", to: "api/adapter" },
    { from: "docs/api/streams", to: "api/streams" },
  ];
  for (const { from, to } of map) {
    const fromPath = join(repoRoot, from);
    const toPath = join(siteDir, to);
    if (!existsSync(fromPath)) {
      console.warn(`[build-site] typedoc output missing: ${from}. Run 'pnpm docs:api' first.`);
      continue;
    }
    cpSync(fromPath, toPath, { recursive: true });
  }
}

function main() {
  const shouldGenerateApi = process.argv.includes("--with-api");
  if (shouldGenerateApi) {
    console.log("[build-site] running pnpm docs:api");
    execSync("pnpm docs:api", { stdio: "inherit", cwd: repoRoot });
  }

  if (existsSync(siteDir)) rmSync(siteDir, { recursive: true, force: true });
  mkdirSync(siteDir, { recursive: true });

  for (const page of pages) writePage(page);
  copyTypedocIfPresent();

  const relRoot = relative(process.cwd(), siteDir) || ".";
  console.log(`[build-site] wrote ${pages.length} pages to ${relRoot}`);
}

main();
