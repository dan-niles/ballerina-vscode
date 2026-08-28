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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    DIRECTORY_MAP,
    ProjectStructure,
    ProjectStructureArtifactResponse,
    isSamePath,
} from "@wso2/ballerina-core";
import { agentKey } from "./AgentTabs";
import { OverviewView } from "./ViewToggle";

const MCP_MODULE = "mcp";

export interface AgentFocusRequest {
    path: string;
    startLine: number;
    requestId: number;
}

interface OverviewSelection {
    agents: ProjectStructureArtifactResponse[];
    selectedAgent?: ProjectStructureArtifactResponse;
    showsAgentCanvas: boolean;
    showsDesignCanvas: boolean;
    packageIsEmpty: boolean;
    canToggle: boolean;
    view: OverviewView;
    setView: (view: OverviewView) => void;
    selectAgent: (agent: ProjectStructureArtifactResponse) => void;
}

function hasDrawableArtifact(projectStructure?: ProjectStructure): boolean {
    const map = projectStructure?.directoryMap;
    const hasMcpService = (map?.[DIRECTORY_MAP.SERVICE] ?? []).some(
        (service) => service.moduleName === MCP_MODULE
    );
    return hasMcpService || (map?.[DIRECTORY_MAP.WORKFLOW]?.length ?? 0) > 0;
}

export function useOverviewSelection(
    projectStructure: ProjectStructure | undefined,
    agentFocus: AgentFocusRequest | undefined,
    onAgentFocused: () => void
): OverviewSelection {
    const [selectedKey, setSelectedKey] = useState<string>();
    const [pickedView, setPickedView] = useState<OverviewView>();
    const appliedFocusRef = useRef<number>();

    const agents = useMemo(
        () => projectStructure?.directoryMap?.[DIRECTORY_MAP.AGENT] ?? [],
        [projectStructure]
    );

    const selectedAgent = useMemo(
        () => agents.find((agent) => agentKey(agent) === selectedKey) ?? agents[0],
        [agents, selectedKey]
    );

    const selectAgent = useCallback((agent: ProjectStructureArtifactResponse) => {
        setSelectedKey(agentKey(agent));
        setPickedView("agent");
    }, []);

    useEffect(() => {
        if (!agentFocus || appliedFocusRef.current === agentFocus.requestId) {
            return;
        }
        const match = agents.find(
            (agent) =>
                isSamePath(agent.path, agentFocus.path) && (agent.position?.startLine ?? 0) === agentFocus.startLine
        );
        if (match) {
            appliedFocusRef.current = agentFocus.requestId;
            selectAgent(match);
            onAgentFocused();
        }
    }, [agents, agentFocus, onAgentFocused, selectAgent]);

    const hasDesign = hasDrawableArtifact(projectStructure);
    const view = pickedView ?? (!selectedAgent && hasDesign ? "design" : "agent");

    return {
        agents,
        selectedAgent,
        showsAgentCanvas: view === "agent" && Boolean(selectedAgent),
        showsDesignCanvas: view === "design" && hasDesign,
        packageIsEmpty: Boolean(projectStructure) && !selectedAgent && !hasDesign,
        canToggle: !projectStructure?.isLibrary,
        view,
        setView: setPickedView,
        selectAgent,
    };
}
