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

import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectStructure } from "@wso2/ballerina-core";

const CROSSFADE_MS = 520;
const READY_SETTLE_MS = 180;
const READY_FALLBACK_MS = 2500;

interface CanvasReveal {
    showAgent: boolean;
    showDesign: boolean;
    showEmpty: boolean;
    emptyMounted: boolean;
    designMounted: boolean;
    onAgentReady: () => void;
}

export function useCanvasReveal(
    projectStructure: ProjectStructure | undefined,
    packageIsEmpty: boolean,
    showsAgentCanvas: boolean,
    showsDesignCanvas: boolean
): CanvasReveal {
    const [agentReady, setAgentReady] = useState(false);
    const [emptyMounted, setEmptyMounted] = useState(false);
    const revealTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const sawEmptyRef = useRef(false);
    const designMountedRef = useRef(false);

    sawEmptyRef.current = sawEmptyRef.current || packageIsEmpty;
    designMountedRef.current = designMountedRef.current || showsDesignCanvas;

    const onAgentReady = useCallback(() => {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = setTimeout(() => setAgentReady(true), READY_SETTLE_MS);
    }, []);

    useEffect(() => () => clearTimeout(revealTimerRef.current), []);

    useEffect(() => {
        if (!projectStructure) {
            return;
        }
        if (packageIsEmpty) {
            clearTimeout(revealTimerRef.current);
            setAgentReady(false);
            setEmptyMounted(true);
            return;
        }
        if (!sawEmptyRef.current) {
            return;
        }
        const fallback = setTimeout(() => setAgentReady(true), READY_FALLBACK_MS);
        return () => clearTimeout(fallback);
    }, [projectStructure, packageIsEmpty]);

    const agentRevealed = agentReady || !sawEmptyRef.current;
    const showAgent = showsAgentCanvas && agentRevealed;
    const showEmpty = (!showsAgentCanvas && !showsDesignCanvas) || (showsAgentCanvas && !agentRevealed);

    useEffect(() => {
        if (showEmpty) {
            return;
        }
        const timer = setTimeout(() => setEmptyMounted(false), CROSSFADE_MS);
        return () => clearTimeout(timer);
    }, [showEmpty]);

    return {
        showAgent,
        showDesign: showsDesignCanvas,
        showEmpty,
        emptyMounted,
        designMounted: designMountedRef.current,
        onAgentReady,
    };
}
