/**
 * Regenerates `contributes.icons` from the icon fonts actually bundled in ./resources.
 *
 * VS Code icon contributions reference raw font codepoints, so a hand-maintained
 * table silently renders the wrong glyph once a font is regenerated. Run this
 * after copyFonts so the table always matches the shipped .woff/.ttf.
 */
const fs = require("fs");
const path = require("path");

const extensionRoot = path.join(__dirname, "..");
const wso2FontPath = "./resources/font-wso2-vscode/dist/wso2-vscode.woff";
const codiconFontPath = "./resources/codicons/codicon.ttf";

const read = (relative) => fs.readFileSync(path.join(extensionRoot, relative), "utf-8");

function wso2Codepoints() {
    const map = JSON.parse(read("resources/font-wso2-vscode/dist/wso2-vscode.json"));
    return Object.fromEntries(Object.entries(map).map(([name, cp]) => [name, cp.toString(16)]));
}

function codiconCodepoints() {
    const css = read("resources/codicons/codicon.css");
    const map = {};
    for (const [, name, cp] of css.matchAll(/\.codicon-([\w-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"/g)) {
        map[name] = cp;
    }
    return map;
}

function buildIcons(config, fonts) {
    const icons = {};
    const missing = [];
    for (const [id, { font, glyph }] of Object.entries(config)) {
        const codepoint = fonts[font].codepoints[glyph];
        if (!codepoint) {
            missing.push(`${id} -> ${font}:${glyph}`);
            continue;
        }
        icons[id] = {
            description: glyph,
            default: { fontPath: fonts[font].fontPath, fontCharacter: `\\${codepoint}` }
        };
    }
    if (missing.length) {
        throw new Error(`Icons not found in the bundled fonts:\n  ${missing.join("\n  ")}`);
    }
    return icons;
}

const fonts = {
    wso2: { fontPath: wso2FontPath, codepoints: wso2Codepoints() },
    codicon: { fontPath: codiconFontPath, codepoints: codiconCodepoints() }
};

const config = JSON.parse(read("icons.config.json"));
const icons = buildIcons(config, fonts);

const packageJsonPath = path.join(extensionRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const before = JSON.stringify(packageJson.contributes.icons);
packageJson.contributes.icons = icons;

if (before === JSON.stringify(icons)) {
    console.log(`Icon contributions already up to date (${Object.keys(icons).length} icons).`);
} else {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 4)}\n`, "utf-8");
    console.log(`Updated ${Object.keys(icons).length} icon contributions in package.json.`);
}
