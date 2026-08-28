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

import styled from "@emotion/styled";
import { Codicon, Icon, ThemeColors } from "@wso2/ui-toolkit";

export type OverviewView = "agent" | "design";

const Track = styled.div`
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: 6px;
    background-color: var(--vscode-editorWidget-background);
    border: 1px solid ${ThemeColors.OUTLINE_VARIANT};
`;

const Segment = styled.button<{ active: boolean }>`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: ${(props: { active: boolean }) =>
        props.active ? ThemeColors.ON_SURFACE : ThemeColors.ON_SURFACE_VARIANT};
    background-color: ${(props: { active: boolean }) =>
        props.active ? "var(--vscode-toolbar-hoverBackground)" : "transparent"};
    transition: background-color 140ms ease, color 140ms ease;

    &:hover {
        color: ${ThemeColors.ON_SURFACE};
    }
`;

const ICON_SX = { fontSize: 15, width: 15, height: 15 };
const GLYPH_SX = { fontSize: 15, color: "inherit" };

interface ViewToggleProps {
    view: OverviewView;
    onChange: (view: OverviewView) => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
    return (
        <Track role="radiogroup" aria-label="Overview view">
            <Segment
                role="radio"
                aria-checked={view === "agent"}
                active={view === "agent"}
                onClick={() => onChange("agent")}
                title="Agent view"
            >
                <Icon name="bi-ai-agent" sx={ICON_SX} iconSx={GLYPH_SX} />
            </Segment>
            <Segment
                role="radio"
                aria-checked={view === "design"}
                active={view === "design"}
                onClick={() => onChange("design")}
                title="Design view"
            >
                <Codicon name="circuit-board" sx={ICON_SX} iconSx={GLYPH_SX} />
            </Segment>
        </Track>
    );
}
