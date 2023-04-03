const glob = require("glob");
const fs = require("fs").promises;
const removeMarkdown = require("markdown-to-text").default;
const bcd = require('@mdn/browser-compat-data');
const path = require('path');

const MDN_CONTENT_DIR = "./mdn-content/content/files/en-us/";
const DIST_DIR = "./dist/";
const FILES_TO_COPY = [
  "README.md"
];

function getAllFiles() {
  const files = glob("**/*.md", {
    cwd: MDN_CONTENT_DIR,
    ignore: [],
  });

  return files;
}

function getFileContent(filePath) {
  return fs.readFile(filePath, "utf8");
}

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
  for (const field of frontMatter) {
    let [key, ...value] = field.split(":");
    key = key.trim();
    value = value.join(":").trim();

    if (key === "browser-compat" && !!value) {
      hasBrowserCompat = true;
    }

    fields[key] = value;
  }

  if (!hasBrowserCompat) {
    return null;
  }

  return fields;
}

function getFileSummary(fileContent) {
  const lines = fileContent.split("\n");

  // Find the second instance of ---
  let summaryStart = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("---")) {
      summaryStart = i + 1;
      break;
    }
  }

  // Get the first usable paragraph, which means skipping over
  // empty lines
  // {{}} macros
  // html content
  let summary = "";
  for (let i = summaryStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("{{")) {
      continue;
    }
    if (line.trim() === "") {
      continue;
    }
    if (line.trim().startsWith("<")) {
      continue;
    }
    summary = line;
    break;
  }

  return convertMDToText(summary);
}

function convertMDToText(md) {
  // Before converting md to text, take care of the
  // **`<element>`** cases as they're not handled
  // well by the md-to-text lib.
  md = md.replace(/(\*\*`<)(.*?)(>`\*\*)/g, (match, p1, p2, p3) => {
    return `${p2}`;
  });

  let text = removeMarkdown(md);

  // Replace macros with the text inside the quotes.
  text = text.replace(/{{.*?}}/g, (match) => {
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
    console.log(`Processing ${file}...`);

    const path = frontMatter["browser-compat"];
    const bcd = getBrowserCompat(frontMatter);

    const featureData = {
      path,
      title: frontMatter.title,
      mdnURL: getMDNURL(frontMatter),
      summary: getFileSummary(fileContent),
      specURL: getSpecURL(bcd),
      compat: cleanupBCD(bcd),
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
