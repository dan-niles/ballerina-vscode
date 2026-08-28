/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

const extensionRoot = path.join(__dirname, '..', '..');
const wso2FontJson = path.join(extensionRoot, 'resources/font-wso2-vscode/dist/wso2-vscode.json');
const codiconCss = path.join(extensionRoot, 'resources/codicons/codicon.css');

interface IconContribution {
    description: string;
    default: { fontPath: string; fontCharacter: string };
}

const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf-8'));
const iconsConfig: Record<string, { font: string; glyph: string }> = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, 'icons.config.json'), 'utf-8')
);
const contributedIcons: Record<string, IconContribution> = packageJson.contributes.icons;

function codiconCodepoints(): Record<string, string> {
    const css = fs.readFileSync(codiconCss, 'utf-8');
    const map: Record<string, string> = {};
    for (const match of css.matchAll(/\.codicon-([\w-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"/g)) {
        map[match[1]] = match[2];
    }
    return map;
}

function wso2Codepoints(): Record<string, string> {
    const map: Record<string, number> = JSON.parse(fs.readFileSync(wso2FontJson, 'utf-8'));
    return Object.fromEntries(Object.entries(map).map(([name, cp]) => [name, cp.toString(16)]));
}

describe('contributes.icons', () => {
    it('declares exactly the icons in icons.config.json', () => {
        expect(Object.keys(contributedIcons)).toEqual(Object.keys(iconsConfig));
    });

    // The wso2 font is a build artifact copied by `copyFonts`; skip when absent.
    const describeWso2 = fs.existsSync(wso2FontJson) ? describe : describe.skip;

    describeWso2('wso2-vscode font', () => {
        const codepoints = wso2Codepoints();

        it.each(Object.entries(iconsConfig).filter(([, c]) => c.font === 'wso2'))(
            '%s points at its glyph',
            (id, { glyph }) => {
                expect(codepoints[glyph]).toBeDefined();
                expect(contributedIcons[id].default.fontCharacter).toBe(`\\${codepoints[glyph]}`);
            }
        );
    });

    describe('codicon font', () => {
        const codepoints = codiconCodepoints();

        it.each(Object.entries(iconsConfig).filter(([, c]) => c.font === 'codicon'))(
            '%s points at its glyph',
            (id, { glyph }) => {
                expect(codepoints[glyph]).toBeDefined();
                expect(contributedIcons[id].default.fontCharacter).toBe(`\\${codepoints[glyph]}`);
            }
        );
    });
});
