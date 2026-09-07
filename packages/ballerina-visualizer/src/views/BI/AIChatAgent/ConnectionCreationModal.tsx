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

import { useState } from "react";
import { createPortal } from "react-dom";
import styled from "@emotion/styled";
import { cloneDeep } from "lodash";
import { useRpcContext } from "@wso2/ballerina-rpc-client";
import { AvailableNode, CodeData, FieldType, FlowNode, LineRange } from "@wso2/ballerina-core";
import { Button, Codicon, Icon, TextField, ThemeColors, Typography } from "@wso2/ui-toolkit";
import { MarkdownDescription } from "@wso2/ballerina-side-panel";
import { ConnectorIcon } from "@wso2/bi-diagram";
import { RelativeLoader } from "../../../components/RelativeLoader";
import { ConnectionConfigurationForm } from "../Connection/ConnectionConfigurationPopup";
import {
    BackButton,
    CloseButton,
    HeaderTitleContainer,
    PopupContainer,
    PopupContent,
    PopupFooter,
    PopupHeader,
    PopupOverlay,
    PopupSubtitle,
    PopupTitle,
} from "../Connection/styles";
import { ConnectionDependencyConfig } from "./AIAgentSidePanel";

const BALLERINA_RESERVED_WORDS = new Set([
    "abstract", "annotation", "any", "anydata", "as", "ascending", "base16", "base64", "boolean", "break",
    "byte", "by", "check", "checkpanic", "class", "client", "collect", "commit", "configurable", "conflict",
    "const", "continue", "decimal", "default", "descending", "distinct", "do", "else", "enum", "equals", "error",
    "external", "fail", "false", "field", "final", "float", "flush", "for", "foreach", "fork", "from",
    "function", "future", "group", "handle", "if", "import", "in", "int", "is", "isolated", "join", "json",
    "key", "let", "limit", "listener", "lock", "map", "match", "module", "never", "new", "null", "object",
    "on", "order", "outer", "panic", "parameter", "private", "public", "readonly", "record", "remote",
    "resource", "retry", "return", "returns", "rollback", "select", "self", "service", "source", "start",
    "stream", "string", "table", "transaction", "transactional", "trap", "true", "type", "typedesc", "typeof",
    "var", "variable", "version", "wait", "where", "while", "worker", "xml", "xmlns",
]);

const ConnectionPopupContainer = styled(PopupContainer) <{ $compact?: boolean }>`
    width: ${(props: { $compact?: boolean }) => props.$compact ? "calc(100vw - 64px) !important" : "80%"};
    max-width: ${(props: { $compact?: boolean }) => props.$compact ? "680px !important" : "800px"};
    height: ${(props: { $compact?: boolean }) => props.$compact ? "auto !important" : "80vh"};
    min-height: ${(props: { $compact?: boolean }) => props.$compact ? "0 !important" : "480px"};
    max-height: ${(props: { $compact?: boolean }) => props.$compact ? "calc(100vh - 64px) !important" : "800px"};
`;

const ModalStep = styled.div<{
    $direction: "forward" | "backward";
}>`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    --connection-step-offset: ${(props: { $direction: "forward" | "backward" }) => props.$direction === "forward" ? "8px" : "-8px"};
    animation: connection-step 150ms ease-out both;

    @keyframes connection-step {
        from {
            opacity: 0;
            transform: translateX(var(--connection-step-offset));
        }

        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

const ConnectionMethodOptions = styled.div`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px;
`;

const ConnectionMethodCard = styled.button`
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px;
    color: ${ThemeColors.ON_SURFACE};
    background: ${ThemeColors.SURFACE_DIM};
    border: 1px solid ${ThemeColors.OUTLINE_VARIANT};
    border-radius: 8px;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
        background-color: ${ThemeColors.PRIMARY_CONTAINER};
        border-color: ${ThemeColors.PRIMARY};
    }

    &:focus-visible {
        outline: 2px solid ${ThemeColors.PRIMARY};
        outline-offset: 2px;
    }
`;

const ConnectionMethodIcon = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: ${ThemeColors.SURFACE_CONTAINER};
    border-radius: 8px;
`;

const ConnectionMethodDetails = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
`;

const ConnectionMethodTitle = styled.div`
    font-size: 13px;
    font-weight: 600;
`;

const ConnectionMethodDescription = styled.div`
    margin: 0;
    color: ${ThemeColors.ON_SURFACE_VARIANT};
    font-size: 13px;
    line-height: 1.45;
`;

const ConnectionMethodChevron = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${ThemeColors.ON_SURFACE_VARIANT};
`;

const PopupLoaderContainer = styled.div`
    flex: 1;
    min-height: 0;
    display: flex;
    justify-content: center;
    align-items: center;

    p {
        font-size: 13px;
    }
`;

const DependencyFormContainer = styled.div`
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
`;

const DependencyConnectorCard = styled.div`
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border: 1px solid ${ThemeColors.OUTLINE_VARIANT};
    border-radius: 8px;
    background-color: ${ThemeColors.SURFACE_DIM};
`;

const DependencyConnectorIcon = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background-color: ${ThemeColors.SURFACE_CONTAINER};

    & > img,
    & > svg {
        width: 32px;
        height: 32px;
    }
`;

const DependencyConnectorIconImage = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;

    & > img,
    & > svg {
        width: 32px;
        height: 32px;
        object-fit: contain;
    }
`;

const DependencyConnectorContent = styled.div`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
`;

const DependencyConnectorName = styled(Typography)`
    margin: 0;
    color: ${ThemeColors.ON_SURFACE};
    font-size: 13px;
    font-weight: 600;
`;

const DependencyConnectorDescription = styled(MarkdownDescription)`
    max-height: 3em;
    margin: 0;
    overflow: hidden;
    color: ${ThemeColors.ON_SURFACE_VARIANT};
    font-size: 13px;

    p,
    li {
        margin: 0;
        overflow: hidden;
        font-size: 13px;
    }

    p {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }
`;

const ReadOnlyField = styled.div`
    display: flex;
    flex-direction: column;
    gap: 4px;
`;

const ReadOnlyValue = styled.div`
    font-family: var(--vscode-editor-font-family);
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 4px;
    background-color: var(--vscode-input-background);
    color: var(--vscode-foreground);
`;

type Step = "METHOD" | "DEPENDENCY_FORM" | "CONFIG";

export interface ConnectionCreationModalProps {
    connector: AvailableNode;
    connectionDependency: ConnectionDependencyConfig;
    additionalReservedNames: string[];
    agentFilePath: string;
    targetLineRange: LineRange;
    classFileName: string;
    onSaved: (variableName: string, origin: "dependency" | "agent") => void;
    onClose: () => void;
}

export function ConnectionCreationModal(props: ConnectionCreationModalProps) {
    const { connector, connectionDependency, additionalReservedNames, agentFilePath, targetLineRange, classFileName, onSaved, onClose } = props;
    const { rpcClient } = useRpcContext();

    const [step, setStep] = useState<Step>("METHOD");
    const [direction, setDirection] = useState<"forward" | "backward">("forward");
    const [depClientType, setDepClientType] = useState<string>("");
    const [depImports, setDepImports] = useState<{ [prefix: string]: string }>({});
    const [depName, setDepName] = useState<string>("");
    const [depNameError, setDepNameError] = useState<string>("");
    const [depSaving, setDepSaving] = useState<boolean>(false);
    const [depConnectorLoading, setDepConnectorLoading] = useState<boolean>(false);

    const goTo = (next: Step, dir: "forward" | "backward" = "forward") => {
        setDirection(dir);
        setStep(next);
    };

    const reservedNames = (): Set<string> => new Set([
        ...(connectionDependency.reservedNames ?? []),
        ...additionalReservedNames,
    ]);

    const suggestDependencyName = (prefix: string): string => {
        const base = `${prefix}Client`;
        const existing = reservedNames();
        if (!existing.has(base)) return base;
        let n = 2;
        while (existing.has(`${base}${n}`)) n++;
        return `${base}${n}`;
    };

    const validateDependencyName = (name: string): string => {
        const trimmed = name.trim();
        if (!trimmed) return "Name is required.";
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) return "Not a valid Ballerina identifier.";
        if (BALLERINA_RESERVED_WORDS.has(trimmed)) return `"${trimmed}" is a reserved Ballerina keyword.`;
        if (reservedNames().has(trimmed)) return "This name is already used by the agent definition.";
        return "";
    };

    const handleChooseDependency = async () => {
        setDepConnectorLoading(true);
        goTo("DEPENDENCY_FORM");
        try {
            await rpcClient.getBIDiagramRpcClient().getNodeTemplate({
                position: targetLineRange.startLine,
                filePath: agentFilePath,
                id: connector.codedata,
            });
            const cd = connector.codedata;
            const prefix = (cd.module || "").split(".").pop() || cd.module || "";
            const clientClass = cd.object || "Client";
            setDepClientType(`${prefix}:${clientClass}`);
            setDepImports({ [prefix]: `${cd.org}/${cd.module}` });
            setDepName(suggestDependencyName(prefix));
            setDepNameError("");
        } catch {
            goTo("METHOD", "backward");
        } finally {
            setDepConnectorLoading(false);
        }
    };

    const handleSaveDependency = async () => {
        const error = validateDependencyName(depName);
        if (error) {
            setDepNameError(error);
            return;
        }
        setDepSaving(true);
        const dependencyName = depName.trim();
        try {
            const field = {
                isPrivate: true,
                isFinal: true,
                codedata: { lineRange: connectionDependency.classLineRange },
                type: {
                    metadata: { label: "Client Type", description: "The connection client type" },
                    enabled: true, editable: false, value: depClientType,
                    isType: true, optional: false, advanced: false, addNewButton: false,
                    imports: depImports,
                    types: [{ fieldType: "TYPE", selected: false }],
                },
                name: {
                    metadata: { label: "Input Name", description: "The name of the injected client" },
                    enabled: true, editable: true, value: dependencyName,
                    isType: false, optional: false, advanced: false, addNewButton: false,
                    types: [{ fieldType: "IDENTIFIER", selected: false }],
                },
                defaultValue: {
                    metadata: { label: "Default Value", description: "" },
                    enabled: false, editable: true, value: "",
                    isType: false, optional: false, advanced: false, addNewButton: false,
                    types: [{ fieldType: "EXPRESSION", selected: true }],
                },
                enabled: true, editable: false, optional: false, advanced: false,
            } as unknown as FieldType;

            await rpcClient.getBIDiagramRpcClient().createClassDependency({
                filePath: connectionDependency.filePath,
                field,
                classLineRange: connectionDependency.classLineRange,
            });
            onSaved(dependencyName, "dependency");
        } catch {
            setDepSaving(false);
            setDepNameError("Unable to add the connection parameter. Try again.");
        }
    };

    const handleSaveAgentConnection = async (configuredConnection: FlowNode) => {
        const connectionName = String(configuredConnection.properties?.variable?.value ?? "");
        const error = validateDependencyName(connectionName);
        if (error) {
            throw new Error(error);
        }

        const connection = cloneDeep(configuredConnection);
        if (connection.properties?.scope) {
            connection.properties.scope.value = "Local";
            connection.properties.scope.hidden = true;
        }
        await rpcClient.getBIDiagramRpcClient().saveClassMember({
            filePath: connectionDependency.filePath,
            flowNode: connection,
            classLineRange: connectionDependency.classLineRange,
        });
        onSaved(connectionName, "agent");
    };

    const validateAgentConnectionField = (fieldKey: string, value: unknown): string | undefined => {
        if (fieldKey !== "variable") {
            return undefined;
        }
        return validateDependencyName(String(value ?? "")) || undefined;
    };

    return createPortal(
        <>
            <PopupOverlay
                sx={{
                    background: ThemeColors.SURFACE_CONTAINER,
                    opacity: 0.5,
                    zIndex: 2050,
                }}
            />
            <ConnectionPopupContainer $compact={step === "METHOD"} style={{ zIndex: 2051 }}>
                <ModalStep key={step} $direction={direction}>
                    <PopupHeader>
                        {step !== "METHOD" && (
                            <BackButton
                                appearance="icon"
                                onClick={() => goTo("METHOD", "backward")}
                                disabled={depSaving || depConnectorLoading}
                            >
                                <Codicon name="arrow-left" />
                            </BackButton>
                        )}
                        <HeaderTitleContainer>
                            <PopupTitle variant="h2">
                                {step === "METHOD" && `Add ${connector.metadata.label} Connection`}
                                {step === "DEPENDENCY_FORM" && "Add a Connection Parameter"}
                                {step === "CONFIG" && `Configure ${connector.metadata.label}`}
                            </PopupTitle>
                            <PopupSubtitle variant="body2" sx={{ fontSize: "13px" }}>
                                {step === "METHOD"
                                    && "Choose how this agent definition should obtain this connection."}
                                {step === "DEPENDENCY_FORM"
                                    && "Give this connection a name to use in your agent."}
                                {step === "CONFIG"
                                    && "Configure connection settings for this agent."}
                            </PopupSubtitle>
                        </HeaderTitleContainer>
                        <CloseButton
                            appearance="icon"
                            onClick={onClose}
                            disabled={depSaving || depConnectorLoading}
                        >
                            <Codicon name="close" />
                        </CloseButton>
                    </PopupHeader>
                    {step === "METHOD" && (
                        <ConnectionMethodOptions>
                            {([
                                {
                                    icon: "bi-connection",
                                    title: "Add a Connection Parameter",
                                    description: "Allow a connection to be provided when an agent is created.",
                                    onClick: handleChooseDependency,
                                },
                                {
                                    icon: "bi-settings",
                                    title: "Add a Built-in Connection",
                                    description: "Create and bundle this connection with the agent definition.",
                                    onClick: () => goTo("CONFIG"),
                                },
                            ] as const).map(({ icon, title, description, onClick }) => (
                                <ConnectionMethodCard key={title} onClick={onClick}>
                                    <ConnectionMethodIcon>
                                        <Icon name={icon} sx={{ fontSize: 24, width: 24, height: 24 }} />
                                    </ConnectionMethodIcon>
                                    <ConnectionMethodDetails>
                                        <ConnectionMethodTitle>{title}</ConnectionMethodTitle>
                                        <ConnectionMethodDescription>{description}</ConnectionMethodDescription>
                                    </ConnectionMethodDetails>
                                    <ConnectionMethodChevron>
                                        <Codicon name="chevron-right" />
                                    </ConnectionMethodChevron>
                                </ConnectionMethodCard>
                            ))}
                        </ConnectionMethodOptions>
                    )}
                    {step === "DEPENDENCY_FORM" && (
                        <>
                            <PopupContent>
                                {depConnectorLoading ? (
                                    <PopupLoaderContainer>
                                        <RelativeLoader message="Loading connector package..." />
                                    </PopupLoaderContainer>
                                ) : (
                                    <DependencyFormContainer>
                                        <DependencyConnectorCard>
                                            <DependencyConnectorIcon>
                                                {connector.metadata.icon ? (
                                                    <DependencyConnectorIconImage>
                                                        <ConnectorIcon url={connector.metadata.icon} />
                                                    </DependencyConnectorIconImage>
                                                ) : (
                                                    <Codicon name="package" sx={{ fontSize: 32, width: 32, height: 32 }} />
                                                )}
                                            </DependencyConnectorIcon>
                                            <DependencyConnectorContent>
                                                <DependencyConnectorName>
                                                    {connector.metadata.label}
                                                </DependencyConnectorName>
                                                <DependencyConnectorDescription
                                                    description={connector.metadata.description || ""}
                                                />
                                            </DependencyConnectorContent>
                                        </DependencyConnectorCard>
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                color: "var(--vscode-list-deemphasizedForeground)",
                                                fontSize: "13px",
                                            }}
                                        >
                                            Connection details will be provided when this agent is used.
                                        </Typography>
                                        <ReadOnlyField>
                                            <Typography variant="body3" sx={{ fontSize: "13px" }}>
                                                Client Type
                                            </Typography>
                                            <ReadOnlyValue>{depClientType}</ReadOnlyValue>
                                        </ReadOnlyField>
                                        <TextField
                                            label="Input Name"
                                            value={depName}
                                            errorMsg={depNameError}
                                            onTextChange={(value: string) => { setDepName(value); setDepNameError(""); }}
                                        />
                                    </DependencyFormContainer>
                                )}
                            </PopupContent>
                            {!depConnectorLoading && (
                                <PopupFooter>
                                    <Button appearance="secondary" onClick={() => goTo("METHOD", "backward")} disabled={depSaving}>
                                        Back
                                    </Button>
                                    <Button appearance="primary" onClick={handleSaveDependency} disabled={depSaving}>
                                        {depSaving ? "Adding..." : "Add Parameter"}
                                    </Button>
                                </PopupFooter>
                            )}
                        </>
                    )}
                    {step === "CONFIG" && (
                        <ConnectionConfigurationForm
                            selectedConnector={connector}
                            fileName={agentFilePath}
                            target={targetLineRange.startLine}
                            onClose={onClose}
                            filteredCategories={[]}
                            footerActionButton
                            customValidator={validateAgentConnectionField}
                            overrideFlowNode={(node) => {
                                const connection = cloneDeep(node);
                                if (connection.properties?.scope) {
                                    connection.properties.scope.value = "Local";
                                    connection.properties.scope.hidden = true;
                                }
                                connection.codedata.lineRange = {
                                    fileName: classFileName,
                                    startLine: targetLineRange.startLine,
                                    endLine: targetLineRange.startLine,
                                };
                                return connection;
                            }}
                            onSaveConfiguredConnection={handleSaveAgentConnection}
                        />
                    )}
                </ModalStep>
            </ConnectionPopupContainer>
        </>,
        document.body
    );
}
