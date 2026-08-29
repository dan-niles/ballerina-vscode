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

import * as fs from "fs";
import * as path from "path";
import { commands, window } from "vscode";
import { extension } from "../BalExtensionContext";

const CLEAR_ACTION = "Clear module cache";
// A stale BIR cache always reports as a module that could not be read from its BIR.
const CACHE_ERROR = /from its BIR/i;
const MODULE_NAME = /the module '([^']+)'/;

let notificationOpen = false;

/** Offers to clear the BIR caches when an LS error reports one that cannot be read. */
export function checkModuleCacheError(response: unknown): void {
    const errorMsg = (response as { errorMsg?: string })?.errorMsg;
    if (notificationOpen || !errorMsg || !CACHE_ERROR.test(errorMsg)) {
        return;
    }

    console.error(`Stale Ballerina module cache: ${errorMsg}`);
    const module = MODULE_NAME.exec(errorMsg)?.[1] ?? "a module";

    notificationOpen = true;
    window.showErrorMessage(
        `Ballerina can't load ${module} because its cached data is damaged. Clearing the cache fixes it.`,
        CLEAR_ACTION
    ).then(
        (selection) => {
            notificationOpen = false;
            if (selection === CLEAR_ACTION && deleteCacheDirectories() > 0) {
                commands.executeCommand("workbench.action.reloadWindow");
            }
        },
        () => {
            notificationOpen = false;
        }
    );
}

// Only the generated caches are removed; the downloaded packages they are re-created from are left alone.
function deleteCacheDirectories(): number {
    const userHome = extension.ballerinaExtInstance?.getBallerinaUserHome();
    if (!userHome) {
        return 0;
    }
    const repoDir = path.join(userHome, "repositories", "central.ballerina.io");

    let removed = 0;
    try {
        for (const entry of fs.readdirSync(repoDir, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name.startsWith("cache-")) {
                fs.rmSync(path.join(repoDir, entry.name), { recursive: true, force: true });
                removed++;
            }
        }
    } catch (error) {
        console.error("Failed to clear the Ballerina module cache", error);
    }
    return removed;
}
