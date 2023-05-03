import fs from "fs/promises";
import path from "path";
import glob from "glob";

import bcd from "@mdn/browser-compat-data" assert { type: "json" };
import css from "@webref/css";
import markdownToText from "markdown-to-text";
const removeMarkdown = markdownToText.default;

const MDN_CONTENT_DIR = "./mdn-content/content/files/en-us/";
const MDN_CONTENT_INCLUDE = "**/*.md";
const MDN_CONTENT_IGNORE = [
  "mdn/**/*.md",
  "mozilla/**/*.md"
];
const MDN_PAGE_TYPES = [
  "css-at-rule-descriptor",
  "css-at-rule",
  "css-combinator",
  "css-function",
  "css-keyword",
  "css-media-feature",
  "css-module",
  "css-property",
  "css-pseudo-class",
  "css-pseudo-element",
  "css-selector",
  "css-shorthand-property",
  "css-type",
  "html-attribute-value",
  "html-attribute",
  "html-element",
  "javascript-class",
  "javascript-constructor",
  "javascript-function",
  "javascript-global-property",
  "javascript-instance-accessor-property",
  "javascript-instance-data-property",
  "javascript-instance-method",
  "javascript-language-feature",
  "javascript-namespace",
  "javascript-operator",
  "javascript-statement",
  "javascript-static-accessor-property",
  "javascript-static-data-property",
  "javascript-static-method",
  "svg-attribute",
  "svg-element",
  "web-api-constructor",
  "web-api-event",
  "web-api-global-function",
  "web-api-global-property",
  "web-api-instance-event",
  "web-api-instance-method",
  "web-api-instance-property",
  "web-api-interface",
  "web-api-overview",
  "web-api-static-method",
  "web-api-static-property",
  "webgl-extension-method",
  "webgl-extension",
];
const DIST_DIR = "./dist/";
const FILES_TO_COPY = [
  "README.md"
];

/**
 * Get the list of all MDN markdown files that we want to process.
 */
function getAllFiles() {
  const files = glob(MDN_CONTENT_INCLUDE, {
    cwd: MDN_CONTENT_DIR,
    ignore: MDN_CONTENT_IGNORE,
  });

  return files;
}

/**
 * Given a file path, return the content of the file.
 */
function getFileContent(filePath) {
  return fs.readFile(filePath, "utf8");
}

/**
 * Given the content of a file, return an object with the
 * front matter fields.
 * Returns null if the file does not have a front-matter
 * or if the front-matter does not have the fields we
 * think are required to generate data: browser-compat
 * and page-type.
 */
function getFrontMatter(file) {
  if (!file.startsWith("---")) {
    return null;
  }

  const lines = file.split("\n");
  const frontMatter = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("---")) {
      break;
    }
    frontMatter.push(line);
  }

  if (!frontMatter.length) {
    return null;
  }

  const fields = {};
  let hasBrowserCompat = false;
  let hasPageType = false;
  for (const field of frontMatter) {
    let [key, ...value] = field.split(":");
    key = key.trim();
    value = value.join(":").trim();

    if (key === "browser-compat" && !!value) {
      hasBrowserCompat = true;
    }

    if (key === "page-type" && !!value) {
      hasPageType = true;
    }

    fields[key] = value;
  }

  if (!hasBrowserCompat || !hasPageType) {
    return null;
  }

  return fields;
}

/**
 * Given the content of a file, return the summary.
 * It's assumed that the file contains a front-matter section.
 * The function searches for the first usable paragraph after
 * the front-matter section.
 */
function getFileSummary(fileContent) {
  const lines = fileContent.split("\n");

  // Find the second instance of ---, which signals the
  // end of the front-matter section.
  let summaryStartLine = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("---")) {
      summaryStartLine = i + 1;
      break;
    }
  }

  const summary = [];
  let startedCollectingSummary = false;

  for (let i = summaryStartLine; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines, sidebar macros, and HTML content which
    // might appear before the summary section.
    if (!startedCollectingSummary) {
      if (line.startsWith("{{")) {
        continue;
      }
      if (line.trim() === "") {
        continue;
      }
      if (line.trim().startsWith("<")) {
        continue;
      }
    }

    // Stop when we see the first section heading.
    if (startedCollectingSummary) {
      if (line.startsWith("#")) {
        break;
      }
    }

    summary.push(line);
    startedCollectingSummary = true;
  }

  return convertMDToText(summary.join("\n"));
}

/**
 * Given some markdown content, return the corresponding
 * plain text.
 * This function takes care of some special cases that are
 * specific to MDN (like the **`<element>`** and {{macros}}).
 */
function convertMDToText(md) {
  // Before converting md to text, take care of the
  // **`<element>`** cases as they're not handled
  // well by the md-to-text lib.
  md = md.replace(/(\*\*`<)(.*?)(>`\*\*)/g, (match, p1, p2, p3) => {
    return `${p2}`;
  });

  let text = removeMarkdown(md);

  // Replace macros with the text inside the quotes.
  text = text.replace(/{{(.|\s)*?}}/g, (match) => {
    const matchText = match.match(/['"](.*?)['"]/);
    if (matchText) {
      return matchText[1];
    }
    return match;
  });

  return text;
}

function getMDNURL(frontMatter) {
  if (!frontMatter.slug) {
    return null;
  }

  return `https://developer.mozilla.org/en-US/docs/${frontMatter.slug}`;
}

/**
 * From an MDN markdown page, retrun the browser compat data
 * from BCD.
 * To do this, the browser-compat field is extracted from the
 * front matter fields object.
 * If no data is found, null is returned.
 */
function getBrowserCompat(frontMatter) {
  if (!frontMatter["browser-compat"]) {
    return null;
  }

  const compatPath = frontMatter["browser-compat"].split(".");
  let compatData = bcd;
  for (const path of compatPath) {
    if (!compatData) {
      return null;
    }
    compatData = compatData[path];
  }

  if (!compatData || !compatData.__compat) {
    return null;
  }

  return compatData.__compat;
}

function getSpecURL(browserCompat) {
  if (!browserCompat || !browserCompat.spec_url) {
    return null;
  }

  return browserCompat.spec_url;
}

function cleanupBCD(bcd) {
  if (!bcd) {
    return null;
  }

  const compat = {};

  if (bcd.status) {
    compat.status = bcd.status;
  }

  if (bcd.support) {
    compat.support = bcd.support;
  }

  return compat;
}

async function saveDataToFile(data) {
  const json = JSON.stringify(data);
  await fs.writeFile(`${DIST_DIR}data.json`, json);
}

async function updateDistPackage() {
  const sourcePackage = JSON.parse(
    await fs.readFile('./package.json', 'utf-8')
  );
  const distPackage = JSON.parse(
    await fs.readFile(`${DIST_DIR}package.json`, 'utf-8')
  );

  // Mirror some of the information from the source package.json.
  // This is mostly used to bump the version number. But may
  // be useful if some of the other fields change too.
  distPackage.name = sourcePackage.name;
  distPackage.version = sourcePackage.version;
  distPackage.description = sourcePackage.description;
  distPackage.repository = sourcePackage.repository;
  distPackage.bugs = sourcePackage.bugs;
  distPackage.homepage = sourcePackage.homepage;
  distPackage.author = sourcePackage.author;
  distPackage.license = sourcePackage.license;

  // Write distPackage to the dist package.json file.
  await fs.writeFile(`${DIST_DIR}package.json`, JSON.stringify(distPackage, null, 2));
}

async function copyFilesToDist() {
  for (const file of FILES_TO_COPY) {
    await fs.copyFile(file, path.join(DIST_DIR, path.basename(file)));
  }
}

/**
 * Given a spec name like "css-overflow", or "css-text-4"
 * extract on one side, the spec name, and on the other
 * side the optional spec version number
 */
function parseSpecShortName(shortName) {
  const parts = shortName.split("-");

  // If the last part is a number.
  if (parts[parts.length - 1].match(/^[0-9]+$/)) {
    return {
      name: parts.slice(0, -1).join("-"),
      version: parseInt(parts[parts.length - 1]),
    };
  }

  return {
    name: shortName,
    version: 0,
  };
}

function extractWebRefForCSSSelector(selector) {
  for (const [shortname, data] of Object.entries(allWebRefData)) {
    // console.log(selector);
    // console.log(data.selectors);
  }
}

function extractWebRefForCSSProperty(propertyName) {
  const syntaxes = [];

  for (const [shortname, data] of Object.entries(allWebRefData)) {
    const webRefProp = data.properties.find(p => p.name === propertyName);
    if (!webRefProp || !webRefProp.value) {
      continue;
    }

    syntaxes.push({
      spec: parseSpecShortName(shortname),
      syntax: webRefProp.value,
      initial: webRefProp.initial,
      appliesTo: webRefProp.appliesTo,
      inherited: webRefProp.inherited,
      computedValue: webRefProp.computedValue,
      animationType: webRefProp.animationType,
      values: webRefProp.values
    });
  }

  if (syntaxes.length === 0) {
    return null;
  } else if (syntaxes.length === 1) {
    return syntaxes[0];
  }

  // We found multiple syntaxes for the same property.
  // Let's do some cleanup.
  // Possible scenario: syntaxes are from different versions of the same spec.
  // For example: css-overflow, and css-overflow-4.
  // Only keep the the syntax from the most recent spec.
  const sameSpecs = new Set(syntaxes.map(s => s.spec.name)).size === 1;
  if (sameSpecs) {
    const latestVersion = Math.max(...syntaxes.map(s => s.spec.version));
    return syntaxes.find(s => s.spec.version === latestVersion);
  }
  
  return null;
}

let allWebRefData = null;
async function extractWebRefData(path, type) {
  if (!allWebRefData) {
    allWebRefData = await css.listAll();
  }

  if (type === "css-property") {
    return extractWebRefForCSSProperty(path.split(".")[2]);
  }

  if (type === "css-selector") {
    return extractWebRefForCSSSelector(path.split(".")[2]);
  }

  return null;
}

async function main() {
  const files = await getAllFiles();

  const data = {};

  for (const file of files) {
    const filePath = `${MDN_CONTENT_DIR}${file}`;
    const fileContent = await getFileContent(filePath);
    const frontMatter = getFrontMatter(fileContent);

    if (!frontMatter) {
      console.log(`Skipping ${file}, no usable front matter.`);
      continue;
    }
    
    const pageType = frontMatter["page-type"];

    if (!MDN_PAGE_TYPES.includes(pageType)) {
      console.log(`Skipping ${file}, ignoring ${pageType} page types.`);
      continue;
    }
    
    console.log(`Processing ${file}...`);
  
    const path = frontMatter["browser-compat"];
    const bcd = getBrowserCompat(frontMatter);

    const featureData = {
      path,
      type: pageType,
      title: frontMatter.title,
      mdnURL: getMDNURL(frontMatter),
      summary: getFileSummary(fileContent),
      specURL: getSpecURL(bcd),
      compat: cleanupBCD(bcd),
      specData: await extractWebRefData(path, pageType)
    };

    // Store the new feature data into the data
    // object, under the path split by dot as key.
    const pathParts = path.split(".");
    let current = data;
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (i === pathParts.length - 1) {
        current[part] = featureData;
      } else {
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
      }
    }
  }

  await saveDataToFile(data);

  await updateDistPackage();

  await copyFilesToDist();
}

main();
