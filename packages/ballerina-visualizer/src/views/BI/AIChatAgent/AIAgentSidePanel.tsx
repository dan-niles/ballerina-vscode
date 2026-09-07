/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
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
import { useRpcContext } from "@wso2/ballerina-rpc-client";
import { NodeList, Category as PanelCategory, FormField, FormImports, FormValues } from "@wso2/ballerina-side-panel";
import {
    BIAvailableNodesRequest,
    Category,
    AvailableNode,
    LineRange,
    EVENT_TYPE,
    MACHINE_VIEW,
    FUNCTION_TYPE,
    ParentPopupData,
    BISearchRequest,
    CodeData,
    NodeMetadata,
    FunctionNode,
    FlowNode,
    ToolParameters,
    ToolParametersValue,
    DIRECTORY_MAP,
    Property,
    ToolParameterItem,
    NodeProperties,
    Diagnostic,
    RecordTypeField,
    getPrimaryInputType,
} from "@wso2/ballerina-core";

import {
    convertBICategoriesToSidePanelCategories,
    convertConfig,
    convertFunctionCategoriesToSidePanelCategories,
    filterToolInputSymbolDiagnostics,
    getImportsForProperty
} from "../../../utils/bi";
import ArtifactForm from "../Forms/ArtifactForm";
import { RelativeLoader } from "../../../components/RelativeLoader";
import styled from "@emotion/styled";
import { URI, Utils } from "vscode-uri";
import { cloneDeep } from "lodash";
import { buildAgentToolFields, buildApprovalToolData, buildRequiresApprovalField, collectLocalFunctionNames, createDefaultParameterValue, createRequiresApprovalField, createToolInputFields, createToolParameters, extractRecordTypeFields, extractRecordTypeFieldsFromEntries, prepareToolInputFields, stripCodeFences, stripCodeFencesInline } from "./formUtils";
import { ImplementationBadge } from "../../../components/ImplementationBadge";
import { FUNCTION_CALL, METHOD_CALL, NEW_CONNECTION, REMOTE_ACTION_CALL, RESOURCE_ACTION_CALL } from "../../../constants";
import { NewToolSelectionMode } from "./NewTool";
import { buildOAuthFields, fetchOAuthConfigProperties, ZERO_LINE_RANGE } from "./utils";
import { updateResourcePathProperty } from "./agentTools";
import {
    ActionSelection,
    ConnectorBrowser,
    WizardStep,
    buildConnectionSelectField,
    displayResourcePath,
} from "../Connection/ConnectorBrowser";
import {
    INCLUDE_CONTEXT_KEY,
    RESULT_TYPE_GROUP,
    TOOL_INPUT_GROUP,
    buildIncludeContextField,
    buildToolFormGroups,
    getExistingToolNames,
    resourceToolNameSeed,
    suggestToolName,
} from "./toolForm";
import { useCreateNode } from "../../../components/ConnectionSelector/useCreateNode";
import { ConnectionCreationModal } from "./ConnectionCreationModal";

const LoaderContainer = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
`;

export enum SidePanelView {
    NODE_LIST = "NODE_LIST",
    TOOL_FORM = "TOOL_FORM",
    CONNECTOR_WIZARD = "CONNECTOR_WIZARD",
}

export interface ConnectionDependencyConfig {
    className: string;
    filePath: string;
    classLineRange: LineRange;
    inputNames: string[];
    connectionFieldNames: string[];
    connectionOrigins: Record<string, "dependency" | "agent">;
    connectionFieldTypes: Record<string, string>;
    reservedNames: string[];
}

export interface BIFlowDiagramProps {
    agentNode: FlowNode;
    projectPath: string;
    onSubmit: (data: ExtendedAgentToolRequest) => void | Promise<void>;
    mode?: NewToolSelectionMode;
    onViewChange?: (view: SidePanelView, navigateBack?: () => void) => void;
    onAgentToolCreated?: (functionName: string) => void;
    onCancel?: () => void;
    connectionDependency?: ConnectionDependencyConfig;
}

export interface ExtendedAgentToolRequest {
    toolName: string;
    description: string;
    includeContext: boolean;
    selectedCodeData: CodeData;
    toolParameters?: ToolParameters;
    functionNode?: FunctionNode;
    flowNode?: FlowNode;
    parameterImports?: { [prefix: string]: string };
    connectionName?: string;
}

// Ensure "io", "log", and "time" module functions always appear under "Standard Library",
// even if they've been imported (which moves them to "Imported Functions" from the LS)
const STANDARD_LIB_MODULES = ["io", "log", "time"];

function ensureStandardLibModules(categories: PanelCategory[]): PanelCategory[] {
    const stdLib = categories.find((cat) => cat.title === "Standard Library");
    const imported = categories.find((cat) => cat.title?.includes("Imported"));
    if (!stdLib || !imported) return categories;

    const isCategoryItem = (item: unknown): item is PanelCategory => typeof item === "object" && item !== null && "title" in item;
    const existingModules = new Set(stdLib.items.filter(isCategoryItem).map((item) => item.title));

    for (const name of STANDARD_LIB_MODULES) {
        if (existingModules.has(name)) continue;
        const match = imported.items.find((item) => isCategoryItem(item) && item.title === name);
        if (match) stdLib.items.push({ ...match });
    }

    return categories;
}

// Reorder function categories: move "Imported Functions" to the end
function reorderFunctionCategories(categories: PanelCategory[]): PanelCategory[] {
    const importedIndex = categories.findIndex((cat) => cat.title?.includes("Imported"));
    if (importedIndex !== -1) {
        const [importedCategory] = categories.splice(importedIndex, 1);
        categories.push(importedCategory);
    }
    return categories;
}

const getConnectionFieldName = (name: string): string =>
    name.startsWith("self.") ? name.slice("self.".length) : name;

// Tool Name + Description are shared with the "Use Connection"/"Create Custom Tool" flows via
// buildAgentToolFields; Requires Approval (createRequiresApprovalField, shared across all three
// tool-creation paths) is appended here, scoped to this form only.
const INITIAL_FIELDS: FormField[] = [
    ...buildAgentToolFields("", ""),
    createRequiresApprovalField(),
];

export function AIAgentSidePanel(props: BIFlowDiagramProps) {
    const { agentNode, projectPath, onSubmit, mode = NewToolSelectionMode.ALL, onViewChange, onAgentToolCreated, onCancel, connectionDependency } = props;
    const { rpcClient } = useRpcContext();
    const dependencyMode = Boolean(connectionDependency);

    const connectorFirst = mode === NewToolSelectionMode.CONNECTION;

    const [sidePanelView, setSidePanelView] = useState<SidePanelView>(
        connectorFirst ? SidePanelView.CONNECTOR_WIZARD : SidePanelView.NODE_LIST
    );
    const [categories, setCategories] = useState<PanelCategory[]>([]);
    const wizardBackRef = useRef<(() => void) | undefined>(undefined);
    const connectorRef = useRef<AvailableNode | undefined>(undefined);
    const [selectedNodeCodeData, setSelectedNodeCodeData] = useState<CodeData>(undefined);
    const [toolNodeId, setToolNodeId] = useState<string>(undefined);

    const functionNode = useRef<FunctionNode>(null);
    const flowNode = useRef<FlowNode>(null);

    const [loading, setLoading] = useState<boolean>(false);
    const [submittingTool, setSubmittingTool] = useState<boolean>(false);
    const [fields, setFields] = useState<FormField[]>(INITIAL_FIELDS);
    const [recordTypeFields, setRecordTypeFields] = useState<RecordTypeField[]>([]);
    const [showOAuthConfig, setShowOAuthConfig] = useState<boolean>(false);

    const targetRef = useRef<LineRange>(
        dependencyMode && agentNode?.codedata?.lineRange
            ? { startLine: agentNode.codedata.lineRange.startLine, endLine: agentNode.codedata.lineRange.endLine }
            : { startLine: { line: 0, offset: 0 }, endLine: { line: 0, offset: 0 } }
    );
    const addedDepNamesRef = useRef<string[]>([]);
    const addedAgentConnectionNamesRef = useRef<string[]>([]);
    const pendingDependencyRefreshRef = useRef<boolean>(false);
    // Set while the connection-creation step was launched from the Tool Form's "Create Connection"
    // prompt (dependency mode only), so completion can fill the field back in instead of resetting the panel.
    const pendingConnectionFieldRef = useRef<{ onCreated: (variableName: string) => void } | undefined>(undefined);
    const pendingCreatedConnectionNameRef = useRef<string>("");
    const initialCategoriesRef = useRef<PanelCategory[]>([]);
    const selectedNodeRef = useRef<AvailableNode>(undefined);
    const agentFilePath = useRef<string>(Utils.joinPath(URI.file(projectPath), agentNode?.codedata?.lineRange?.fileName || "agents.bal").fsPath);
    const functionFilePath = useRef<string>(Utils.joinPath(URI.file(projectPath), "functions.bal").fsPath);
    const parameterFieldsRef = useRef<ToolParameterItem[]>([]);
    const oauthConfigPropertiesRef = useRef<{ key: string; property: Property }[]>([]);
    const isSelectingNodeRef = useRef<boolean>(false);
    // Names of existing module functions offered in the approval-predicate picker. Source of truth
    // for the pick-vs-create decision at submit: a name in here is referenced as-is; a name NOT in
    // here (free-typed) signals the LS to scaffold a new correctly-signed predicate.
    const compatibleApprovalFunctionsRef = useRef<string[]>([]);

    const createGenericNode = useCreateNode(
        agentFilePath.current,
        targetRef.current,
        () => { void fetchNodes(true); },
        { preferModal: true }
    );
    const [connectionCreationConnector, setConnectionCreationConnector] = useState<AvailableNode | undefined>(undefined);

    // In dependency mode, creating a brand-new connection needs an extra fork (parameter vs.
    // built-in) instead of the generic connection-creation modal, so intercept just that trigger.
    const handleCreateNode = (kind: string, onCreated: (variableName: string) => void, nodeCodeData?: CodeData) => {
        if (dependencyMode && kind === NEW_CONNECTION && nodeCodeData && connectorRef.current) {
            pendingConnectionFieldRef.current = { onCreated };
            setConnectionCreationConnector(connectorRef.current);
            return;
        }
        createGenericNode(kind, onCreated, nodeCodeData);
    };

    // Create custom diagnostic filter for Tool Input parameters
    const customDiagnosticFilter = useCallback((diagnostics: Diagnostic[]) => {
        if (!parameterFieldsRef.current || parameterFieldsRef.current.length === 0) {
            return diagnostics;
        }
        const toolInputs = parameterFieldsRef.current.map(param => ({ type: param.formValues.type, variable: param.formValues.variable }));
        return filterToolInputSymbolDiagnostics(diagnostics, toolInputs);
    }, []);

    useEffect(() => {
        fetchNodes();
    }, []);

    const hasAutoTriggered = useRef(false);
    useEffect(() => {
        if (mode === NewToolSelectionMode.CUSTOM_TOOL && !loading && !hasAutoTriggered.current) {
            hasAutoTriggered.current = true;
            handleOnAddFunction(MACHINE_VIEW.BIAgentToolForm, DIRECTORY_MAP.AGENT_TOOL);
        }
    }, [loading]);

    useEffect(() => {
        if (sidePanelView === SidePanelView.TOOL_FORM) {
            onViewChange?.(SidePanelView.TOOL_FORM, () => {
                const target = connectorFirst ? SidePanelView.CONNECTOR_WIZARD : SidePanelView.NODE_LIST;
                resetToolForm();
                setSidePanelView(target);
                onViewChange?.(target, connectorFirst ? wizardBackRef.current : undefined);
            });
        } else if (sidePanelView === SidePanelView.CONNECTOR_WIZARD) {
            onViewChange?.(SidePanelView.CONNECTOR_WIZARD, wizardBackRef.current);
        } else {
            onViewChange?.(SidePanelView.NODE_LIST);
        }
    }, [sidePanelView]);

    const resetToolForm = () => {
        setFields(INITIAL_FIELDS);
        setRecordTypeFields([]);
        setShowOAuthConfig(false);
        connectorRef.current = undefined;
        flowNode.current = null;
        functionNode.current = null;
        oauthConfigPropertiesRef.current = [];
        parameterFieldsRef.current = [];
    };

    const getImplementationString = (codeData: CodeData | undefined): string => {
        if (!codeData) {
            return "";
        }
        const receiver = codeData.parentSymbol
            || connectorRef.current?.metadata?.label
            || codeData.object
            || codeData.module
            || "";
        switch (codeData.node) {
            case RESOURCE_ACTION_CALL:
                return `${receiver} -> ${codeData.symbol} ${displayResourcePath(codeData.resourcePath)}`;
            case REMOTE_ACTION_CALL:
                return `${receiver} -> ${codeData.symbol}`;
            case FUNCTION_CALL:
                return `${codeData.symbol}`;
            case METHOD_CALL:
                return `${receiver} -> ${codeData.symbol}`;
            default:
                return "";
        }
    };

    // Use effects to refresh the panel
    useEffect(() => {
        rpcClient.onParentPopupSubmitted((parent: ParentPopupData) => {
            console.log(">>> on parent popup submitted", parent);
            if (parent.artifactType === DIRECTORY_MAP.AGENT_TOOL && parent.recentIdentifier) {
                onAgentToolCreated?.(parent.recentIdentifier);
                return;
            }
            if (mode === NewToolSelectionMode.CUSTOM_TOOL && parent.artifactType === DIRECTORY_MAP.AGENT_TOOL) {
                onCancel?.();
                return;
            }
            setLoading(true);
            fetchNodes();
        });
    }, [rpcClient]);

    const fetchNodes = async (silent = false) => {
        const settleLoading = () => { if (!silent) setLoading(false); };
        if (!silent) setLoading(true);

        if (mode === NewToolSelectionMode.CUSTOM_TOOL) {
            settleLoading();
            return;
        }

        // FUNCTION mode: skip getAvailableNodes entirely — connections are not needed
        if (mode === NewToolSelectionMode.FUNCTION) {
            try {
                const filteredFunctions = await handleSearchFunction("", FUNCTION_TYPE.REGULAR, false);
                const categories = reorderFunctionCategories(filteredFunctions || []);
                setCategories(categories);
                initialCategoriesRef.current = categories;
            } catch { } finally {
                settleLoading();
            }
            return;
        }

        try {
            const getNodeRequest: BIAvailableNodesRequest = {
                position: targetRef.current.startLine,
                filePath: agentFilePath.current,
                // Need to revisit the logic and ensure it's consistent before enabling this filter
                // queryMap: {
                //     "checkAgentToolCompatibility": "true"
                // }
            };
            const response = await rpcClient.getBIDiagramRpcClient().getAvailableNodes(getNodeRequest);
            if (!response.categories) {
                console.error(">>> Error getting available nodes", response);
                return;
            }
            const connectionsCategory = response.categories.filter(
                (item) => item.metadata.label === "Connections"
            ) as Category[];
            // remove connections which names start with _ underscore or are not tool compatible
            if (connectionsCategory.at(0)?.items) {
                let filteredConnectionsCategory = connectionsCategory
                    .at(0)
                    ?.items.filter((item) => !item.metadata.label.startsWith("_"));
                // filter out tool-incompatible nodes within each sub-category
                filteredConnectionsCategory?.forEach((subCategory) => {
                    if ("items" in subCategory && subCategory.items) {
                        subCategory.items = subCategory.items.filter((node) =>
                            String((node as AvailableNode).codedata?.data?.agentToolCompatible) !== "false"
                        );
                    }
                });
                if (dependencyMode) {
                    const connectionNames = new Set([
                        ...connectionDependency.connectionFieldNames,
                        ...addedDepNamesRef.current,
                        ...addedAgentConnectionNamesRef.current,
                    ]);
                    filteredConnectionsCategory = filteredConnectionsCategory?.filter((subCategory) =>
                        connectionNames.has(getConnectionFieldName(subCategory.metadata.label))
                    );
                    filteredConnectionsCategory?.forEach((subCategory) => {
                        subCategory.metadata.label = getConnectionFieldName(subCategory.metadata.label);
                    });
                }
                connectionsCategory.at(0).items = filteredConnectionsCategory;

            }
            const convertedCategories = convertBICategoriesToSidePanelCategories(connectionsCategory);
            if (dependencyMode) {
                if (!convertedCategories.some((category) => category.title === "Connections")) {
                    convertedCategories.unshift({
                        title: "Connections",
                        description: "No connections available. Click below to add a connection.",
                        items: [],
                    });
                }
                convertedCategories.forEach((category) => {
                    if (category.title === "Connections" && category.items.length === 0) {
                        category.description = "No connections available. Click below to add a connection.";
                    }
                    category.items.forEach((item) => {
                        if ("title" in item) {
                            const connectionName = getConnectionFieldName(item.title);
                            if (connectionDependency.connectionOrigins[connectionName]) {
                                item.origin = connectionDependency.connectionOrigins[connectionName];
                            }
                        }
                    });
                });
            }
            console.log("convertedCategories", convertedCategories);

            let filteredCategories: PanelCategory[] = convertedCategories;

            // ALL mode: also fetch functions — CONNECTION mode only needs connections
            if (mode !== NewToolSelectionMode.CONNECTION) {
                const filteredFunctions = await handleSearchFunction("", FUNCTION_TYPE.REGULAR, false);
                filteredCategories = convertedCategories.concat(reorderFunctionCategories(filteredFunctions));
            }

            setCategories(filteredCategories);
            initialCategoriesRef.current = filteredCategories;
        } finally {
            settleLoading();
        }
    };

    useEffect(() => {
        if (!dependencyMode || !agentNode?.codedata?.lineRange) {
            return;
        }
        const newRange = agentNode.codedata.lineRange;
        const cur = targetRef.current;
        const sameRange = cur
            && cur.startLine?.line === newRange.startLine.line
            && cur.startLine?.offset === newRange.startLine.offset
            && cur.endLine?.line === newRange.endLine.line
            && cur.endLine?.offset === newRange.endLine.offset;
        if (!sameRange) {
            targetRef.current = { startLine: newRange.startLine, endLine: newRange.endLine };
        }
        if (!pendingDependencyRefreshRef.current) {
            return;
        }
        pendingDependencyRefreshRef.current = false;
        void fetchNodes().then(() => {
            const pendingField = pendingConnectionFieldRef.current;
            const createdName = pendingCreatedConnectionNameRef.current;
            pendingConnectionFieldRef.current = undefined;
            pendingCreatedConnectionNameRef.current = "";
            pendingField?.onCreated(createdName);
        });
    }, [agentNode, dependencyMode]);

    const handleSearchFunction = async (
        searchText: string,
        functionType: FUNCTION_TYPE,
        isSearching: boolean = true
    ) => {
        if (isSearching && !searchText) {
            setCategories(initialCategoriesRef.current); // Reset the categories list when the search input is empty
            return;
        }
        const request: BISearchRequest = {
            position: {
                startLine: targetRef.current.startLine,
                endLine: targetRef.current.endLine,
            },
            filePath: agentFilePath.current,
            queryMap: searchText.trim()
                ? {
                    q: searchText,
                    limit: 12,
                    offset: 0,
                    includeAvailableFunctions: "true",
                }
                : undefined,
            searchKind: "FUNCTION",
        };
        const response = await rpcClient.getBIDiagramRpcClient().search(request);

        const filteredResponse = response.categories.filter((category) => {
            return category.metadata.label !== "Agent Tools";
        });

        // Remove agent tool functions from integration category
        const currentIntegrationCategory = filteredResponse[0];
        if (currentIntegrationCategory && Array.isArray(currentIntegrationCategory.items)) {
            currentIntegrationCategory.items = currentIntegrationCategory.items.filter((item) => {
                return !(item.metadata?.data as NodeMetadata)?.isAgentTool;
            });
        }

        if (isSearching && searchText) {
            setCategories(ensureStandardLibModules(reorderFunctionCategories(convertFunctionCategoriesToSidePanelCategories(filteredResponse, functionType))));
            return;
        }
        if (!response || !filteredResponse) {
            return [];
        }
        return ensureStandardLibModules(convertFunctionCategoriesToSidePanelCategories(filteredResponse, functionType));
    };

    const isResultTypeField = (field: FormField) =>
        field.key === "type"
        || field.key === "targetType"
        || field.key === "rowType"
        || field.codedata?.kind === "PARAM_FOR_TYPE_INFER"
        || getPrimaryInputType(field.types)?.fieldType === "TYPE";

    const buildGroupedInputFields = (toolInputFields: FormField[], parameterFields: FormField[]): FormField[] =>
        [
            buildIncludeContextField(TOOL_INPUT_GROUP) as FormField,
            ...toolInputFields,
            ...parameterFields.map((field) => ({
                ...field,
                value: typeof field.value === 'string' ? field.value.replace(/^\$/, '') : field.value,
            })),
        ].map((field) => ({
            ...field,
            group: isResultTypeField(field) ? RESULT_TYPE_GROUP : TOOL_INPUT_GROUP,
            advanced: false,
        }));

    // Fetch the project's own module-level functions (excluding the tool's own function, when it is
    // one — connection-based tools have no local function to exclude) as approval-predicate
    // candidates. Reuses the FUNCTION search with an empty queryMap, which returns the current
    // module's functions; stdlib/imported/agent-tool categories are filtered out by the collector.
    // Shared by both the "Use Function" and "Use Connection" tool-creation paths. Return-type/
    // signature compatibility is verified by the compiler after generation.
    // Returns `null` (rather than `[]`) when the fetch itself fails, so callers can tell "search
    // failed" apart from "this project has no eligible functions" and fall back to the plain
    // checkbox instead of silently offering a picker backed by an empty list. See
    // formUtils.buildRequiresApprovalField for why that distinction matters.
    const fetchCompatibleApprovalFunctions = async (toolFunctionSymbol?: string): Promise<string[] | null> => {
        try {
            const request: BISearchRequest = {
                position: {
                    startLine: targetRef.current.startLine,
                    endLine: targetRef.current.endLine,
                },
                filePath: agentFilePath.current,
                queryMap: undefined,
                searchKind: "FUNCTION",
            };
            const response = await rpcClient.getBIDiagramRpcClient().search(request);
            const names = new Set<string>();
            collectLocalFunctionNames((response?.categories ?? []) as (Category | AvailableNode)[], names);
            if (toolFunctionSymbol) {
                names.delete(toolFunctionSymbol);
            }
            return Array.from(names);
        } catch (error) {
            console.error(">>> Error fetching compatible approval functions", error);
            return null;
        }
    };

    const loadFunctionCallFields = async (node: AvailableNode, options?: { suggestedToolName?: string }): Promise<void> => {
        try {
            const functionNodeResponse = await rpcClient.getBIDiagramRpcClient().getFunctionNode({
                functionName: node.codedata.symbol,
                fileName: functionFilePath.current,
                projectPath: projectPath,
            });

            const funcDef = functionNodeResponse.functionDefinition;
            functionNode.current = funcDef;

            let toolInputFields: FormField[] = [];
            if (funcDef?.properties !== undefined) {
                funcDef.properties.parameters.metadata.label = "Tool Inputs";
                funcDef.properties.parameters.metadata.description = "Define the inputs the agent must provide when invoking this tool.";
                toolInputFields = convertConfig(funcDef.properties, ["functionName", "functionNameDescription", "isIsolated", "type", "typeDescription", "isPublic"]);
            }

            const functionNodeTemplate = await rpcClient.getBIDiagramRpcClient().getNodeTemplate({
                position: funcDef?.codedata.lineRange.startLine || { line: 0, offset: 0 },
                filePath: functionFilePath.current,
                id: node.codedata,
            });

            // Remove imports from optional+advanced properties to avoid unnecessary imports in genTool
            if (functionNodeTemplate.flowNode?.properties) {
                for (const key of Object.keys(functionNodeTemplate.flowNode.properties)) {
                    const prop = (functionNodeTemplate.flowNode.properties as Record<string, any>)[key];
                    if (prop.optional && prop.advanced && prop.imports) {
                        delete prop.imports;
                    }
                }
            }

            let functionParameterFields: FormField[] = [];
            if (toolInputFields.length === 0 && functionNodeTemplate.flowNode?.properties) {
                functionParameterFields = convertConfig(functionNodeTemplate.flowNode.properties, ["variable"], false);
                toolInputFields = createToolInputFields(prepareToolInputFields(functionParameterFields));
                functionNode.current = functionNodeTemplate.flowNode as FunctionNode;
            } else if (functionNodeTemplate.flowNode?.properties) {
                functionParameterFields = convertConfig(functionNodeTemplate.flowNode.properties, ["variable"], false);
                functionParameterFields.forEach((field, idx) => {
                    if (getPrimaryInputType(field.types)?.fieldType === "TYPE") {
                        functionParameterFields[idx].documentation = "The data type this tool will return to the agent.";
                        return;
                    }
                    field.label = `${field.label} Mapping`;
                    if (field.optional == false) {
                        field.value = getPrimaryInputType(field.types)?.fieldType === "REPEATABLE_LIST"
                            ? `[${field.key}]` : field.key;
                    }
                });
            }

            const templateDescription = stripCodeFences(functionNodeTemplate.flowNode?.metadata?.description || "");

            const position = funcDef?.codedata.lineRange.startLine || { line: 0, offset: 0 };
            const oauthProperties = await fetchOAuthConfigProperties(rpcClient, functionFilePath.current, position);
            oauthConfigPropertiesRef.current = oauthProperties;
            const oauthFields = buildOAuthFields(oauthProperties);
            setShowOAuthConfig(oauthFields.length > 0);

            const nodeRecordTypeFields = functionNodeTemplate.flowNode?.properties
                ? extractRecordTypeFields(functionNodeTemplate.flowNode.properties)
                : [];
            const oauthRecordTypeFields = extractRecordTypeFieldsFromEntries(oauthProperties);
            setRecordTypeFields([...nodeRecordTypeFields, ...oauthRecordTypeFields]);

            // Build the approval-predicate picker: fetch the project's module-level functions and keep
            // the boolean-returning ones as candidates. Injected into the "Requires Approval" control's
            // "On" branch so the picker sits under the checkbox; free-typed names drive the create path.
            const approvalCandidates = await fetchCompatibleApprovalFunctions(node.codedata?.symbol);
            compatibleApprovalFunctionsRef.current = approvalCandidates ?? [];

            setFields((prevFields) => [
                ...prevFields.map((field) => {
                    if (field.key === "description") {
                        return { ...field, value: templateDescription };
                    }
                    if (field.key === "name" && options?.suggestedToolName) {
                        return { ...field, value: options.suggestedToolName };
                    }
                    if (field.key === "requiresApproval") {
                        return buildRequiresApprovalField(field, approvalCandidates);
                    }
                    return field;
                }),
                ...buildGroupedInputFields(toolInputFields, functionParameterFields),
                ...oauthFields,
            ]);
        } catch (error) {
            console.error(">>> Error fetching function node or template", error);
        }
    };

    const loadConnectionCallFields = async (
        node: AvailableNode,
        options?: { connectionName?: string; suggestedToolName?: string; connector?: AvailableNode }
    ): Promise<void> => {
        try {
            const nodeTemplate = await rpcClient.getBIDiagramRpcClient().getNodeTemplate({
                position: { line: 0, offset: 0 },
                filePath: agentFilePath.current,
                id: node.codedata,
            });

            const connectionProperty = nodeTemplate.flowNode?.properties?.connection as Property | undefined;
            if (options?.connectionName && connectionProperty) {
                connectionProperty.value = options.connectionName;
            }

            if (nodeTemplate.flowNode) {
                // Remove imports from optional+advanced properties to avoid unnecessary imports in genTool
                if (nodeTemplate.flowNode.properties) {
                    for (const key of Object.keys(nodeTemplate.flowNode.properties)) {
                        const prop = (nodeTemplate.flowNode.properties as Record<string, any>)[key];
                        if (prop.optional && prop.advanced && prop.imports) {
                            delete prop.imports;
                        }
                    }
                }
                flowNode.current = nodeTemplate.flowNode;
            } else {
                console.error("Node template flowNode not found", { response: nodeTemplate });
            }

            const nodeParameterFields = nodeTemplate.flowNode?.properties
                ? convertConfig(nodeTemplate.flowNode.properties)
                : [];

            const toolInputFields = createToolInputFields(prepareToolInputFields(nodeParameterFields));
            let connectionField: FormField | undefined;
            if (options?.connector) {
                const connectionIndex = nodeParameterFields.findIndex((field) => field.key === "connection");
                const ballerinaType = getPrimaryInputType(
                    nodeParameterFields[connectionIndex]?.types
                )?.ballerinaType;
                // Dependency mode's live "searchNodes" lookup can't reliably match an existing
                // class field back to a freshly-browsed connector (see connector-type matching
                // below), so seed the field's options from what the class model already knows
                // instead of trusting the search to find them.
                let existingConnections: { name: string; origin: "dependency" | "agent" }[] | undefined;
                if (dependencyMode && connectionDependency) {
                    const cd = options.connector.codedata;
                    const modulePrefix = (cd.module || "").split(".").pop() || cd.module || "";
                    const connectorType = `${modulePrefix}:${cd.object || "Client"}`;
                    existingConnections = connectionDependency.connectionFieldNames
                        .filter((name) => connectionDependency.connectionFieldTypes[name] === connectorType)
                        .map((name) => ({ name, origin: connectionDependency.connectionOrigins[name] }));
                }
                connectionField = buildConnectionSelectField(
                    options.connector.codedata,
                    ballerinaType,
                    options.connectionName ?? String(connectionProperty?.value ?? ""),
                    existingConnections
                ) as unknown as FormField;
                if (connectionIndex >= 0) {
                    nodeParameterFields.splice(connectionIndex, 1);
                }
            }
            const templateDescription = stripCodeFences(
                nodeTemplate.flowNode?.metadata?.description || node.metadata?.description || ""
            );
            const oauthProperties = await fetchOAuthConfigProperties(rpcClient, agentFilePath.current);
            oauthConfigPropertiesRef.current = oauthProperties;
            const oauthFields = buildOAuthFields(oauthProperties);
            setShowOAuthConfig(oauthFields.length > 0);

            const nodeRecordTypeFields = nodeTemplate.flowNode?.properties
                ? extractRecordTypeFields(nodeTemplate.flowNode.properties)
                : [];
            const oauthRecordTypeFields = extractRecordTypeFieldsFromEntries(oauthProperties);
            setRecordTypeFields([...nodeRecordTypeFields, ...oauthRecordTypeFields]);

            const groupedInputFields = buildGroupedInputFields(toolInputFields, nodeParameterFields);

            // Same approval-predicate picker as the function-call path: fetch the project's
            // module-level functions and inject them into the "Requires Approval" control.
            const approvalCandidates = await fetchCompatibleApprovalFunctions();
            compatibleApprovalFunctionsRef.current = approvalCandidates ?? [];

            setFields((prevFields) => {
                const baseFields = prevFields.map((field) => {
                    if (field.key === "description") {
                        return { ...field, value: templateDescription };
                    }
                    if (field.key === "name" && options?.suggestedToolName) {
                        return { ...field, value: options.suggestedToolName };
                    }
                    if (field.key === "requiresApproval") {
                        return buildRequiresApprovalField(field, approvalCandidates);
                    }
                    return field;
                });
                // The connection outranks the approval gate here, so it goes first.
                const approvalField = baseFields.find((field) => field.key === "requiresApproval");
                return [
                    ...baseFields.filter((field) => field.key !== "requiresApproval"),
                    ...(connectionField ? [connectionField] : []),
                    ...(approvalField ? [approvalField] : []),
                    ...groupedInputFields,
                    ...oauthFields,
                ];
            });
        } catch (error) {
            console.error(">>> Error fetching node template", error);
        }
    };

    const suggestToolNameForAction = (codedata: CodeData | undefined): string | undefined => {
        const symbol = codedata?.symbol;
        if (!symbol) {
            return undefined;
        }
        const seed = codedata?.node === RESOURCE_ACTION_CALL && codedata?.resourcePath
            ? resourceToolNameSeed(symbol, codedata.resourcePath)
            : symbol;
        return suggestToolName(seed, getExistingToolNames(agentNode));
    };

    const handleOnSelectNode = async (nodeId: string, metadata?: any) => {
        if (isSelectingNodeRef.current) return;
        isSelectingNodeRef.current = true;
        setLoading(true);

        try {
            const { node } = metadata as { node: AvailableNode };
            setToolNodeId(nodeId);
            selectedNodeRef.current = node;
            setSelectedNodeCodeData(node.codedata);

            if (nodeId === FUNCTION_CALL) {
                await loadFunctionCallFields(node, {
                    suggestedToolName: suggestToolNameForAction(node.codedata),
                });
            } else if (nodeId === REMOTE_ACTION_CALL || nodeId === RESOURCE_ACTION_CALL || nodeId === METHOD_CALL) {
                await loadConnectionCallFields(node, {
                    suggestedToolName: suggestToolNameForAction(node.codedata),
                });
            }

            setSidePanelView(SidePanelView.TOOL_FORM);
        } finally {
            setLoading(false);
            isSelectingNodeRef.current = false;
        }
    };

    const handleWizardSelect = async (selection: ActionSelection) => {
        if (isSelectingNodeRef.current) return;
        isSelectingNodeRef.current = true;
        setLoading(true);

        try {
            const { action, connector, connectionName } = selection;
            connectorRef.current = connector;

            setToolNodeId(action.codedata.node);
            selectedNodeRef.current = action;
            setSelectedNodeCodeData(action.codedata);

            await loadConnectionCallFields(action, {
                connectionName,
                connector,
                suggestedToolName: suggestToolNameForAction(action.codedata),
            });

            setSidePanelView(SidePanelView.TOOL_FORM);
        } finally {
            setLoading(false);
            isSelectingNodeRef.current = false;
        }
    };

    const handleOnAddConnection = () => {
        rpcClient.getVisualizerRpcClient().openView({
            type: EVENT_TYPE.OPEN_VIEW,
            location: {
                view: MACHINE_VIEW.AddConnectionWizard,
                documentUri: agentFilePath.current,
            },
            isPopup: true,
        });
    };

    const handleOnAddFunction = (view: MACHINE_VIEW, artifactType: DIRECTORY_MAP) => {
        rpcClient.getVisualizerRpcClient().openView({
            type: EVENT_TYPE.OPEN_VIEW,
            location: {
                view: view,
                artifactType: artifactType,
            },
            isPopup: true,
        });
    };

    const updateToolParameters = (params: ToolParameterItem[], baseParams?: ToolParameters): ToolParameters => {
        const newToolParameters = baseParams ? cloneDeep(baseParams) : createToolParameters();
        const paramKeys = params.map((param: ToolParameterItem) => param.formValues.variable);

        if (newToolParameters.value && typeof newToolParameters.value === "object" && !Array.isArray(newToolParameters.value)) {
            // Remove keys that are no longer present
            Object.keys(newToolParameters.value).forEach((key) => {
                if (!paramKeys.includes(key)) {
                    delete (newToolParameters.value as ToolParametersValue)[key];
                }
            });

            // Add or update parameters
            paramKeys.forEach((key: string) => {
                const paramData = params.find((param: ToolParameterItem) => param.formValues.variable === key)?.formValues;
                const existingParam = (newToolParameters.value as ToolParametersValue)[key];

                if (existingParam?.value?.variable) {
                    existingParam.value.variable.value = paramData?.variable || key;
                    existingParam.value.parameterDescription.value = paramData?.parameterDescription || "";
                    existingParam.value.type.value = paramData?.type || "";
                } else {
                    (newToolParameters.value as ToolParametersValue)[key] = createDefaultParameterValue({
                        value: paramData?.variable || key,
                        parameterDescription: paramData?.parameterDescription,
                        type: paramData?.type,
                    });
                }
            });
        }
        return newToolParameters;
    };

    const handleToolSubmit = async (data: FormValues, formImports?: FormImports) => {
        if (submittingTool) {
            return;
        }
        // Safely convert name to camelCase, handling any input
        const name = data["name"] || "";
        const cleanName = name.trim().replace(/[^a-zA-Z0-9]/g, "") || "newTool";

        // HACK: Remove code blocks and new lines from description fields
        if (data.description) {
            data.description = stripCodeFencesInline(data.description);
        }

        console.log(">>> handleToolSubmit", { data });
        console.log(">>> toolNodeId", { toolNodeId });
        console.log(">>> functionNode", { functionNode });
        console.log(">>> flowNode", { flowNode });

        let toolParameters: ToolParameters | null = null;
        let clonedFunctionNode: FunctionNode | null = null;
        let clonedFlowNode: FlowNode | null = null;

        if (toolNodeId === FUNCTION_CALL && Array.isArray(data["parameters"])) {
            clonedFunctionNode = functionNode.current ? cloneDeep(functionNode.current) : null;
            const existingParameters = clonedFunctionNode?.properties?.parameters;
            toolParameters = updateToolParameters(data["parameters"], existingParameters as unknown as ToolParameters | undefined);

            if (existingParameters) {
                // User-defined function: update parameter values in the cloned function node
                const parametersValue = existingParameters.value;
                if (parametersValue && typeof parametersValue === "object" && !Array.isArray(parametersValue)) {
                    Object.keys(parametersValue).forEach((key) => {
                        const paramValue = data[key];
                        if ((parametersValue as ToolParametersValue)[key]?.value?.variable) {
                            (parametersValue as ToolParametersValue)[key].value.variable.value = paramValue;
                        }
                    });
                }
            } else if (clonedFunctionNode?.properties) {
                // Library function: the template flowNode has no parameters property,
                // so inject the constructed toolParameters so genTool can read it
                (clonedFunctionNode.properties as any).parameters = toolParameters;
            }

            // Update mapping field values from form data into the function node properties
            if (clonedFunctionNode?.properties) {
                const props = clonedFunctionNode.properties as Record<string, Property>;
                Object.keys(props).forEach((key) => {
                    if (key === "parameters") return; // already handled above
                    const formValue = data[key];
                    if (formValue !== undefined && props[key]) {
                        props[key] = { ...props[key], value: formValue };
                    }
                });
            }
        } else if (toolNodeId === REMOTE_ACTION_CALL || toolNodeId === RESOURCE_ACTION_CALL || toolNodeId === METHOD_CALL) {
            clonedFlowNode = flowNode.current ? cloneDeep(flowNode.current) : null;
            if (Array.isArray(data["parameters"])) {
                toolParameters = updateToolParameters(data["parameters"]);
            }

            // Update flowNode parameter values from data["parameters"]
            if (clonedFlowNode?.properties && typeof clonedFlowNode?.properties === "object" && !Array.isArray(clonedFlowNode?.properties)) {
                const newProperties = { ...clonedFlowNode.properties } as Record<string, Property>;
                Object.keys(newProperties).forEach((key) => {
                    const paramValue = data[key];
                    if (paramValue !== undefined && newProperties[key]) {
                        newProperties[key] = {
                            ...newProperties[key],
                            value: paramValue
                        };
                    }
                    // Update resourcePath for RESOURCE_ACTION_CALL nodes
                    if (toolNodeId === RESOURCE_ACTION_CALL) {
                        const resourcePathProperty = newProperties["resourcePath"];
                        if (resourcePathProperty) {
                            newProperties["resourcePath"] = updateResourcePathProperty(
                                resourcePathProperty,
                                key,
                                paramValue
                            );
                        }
                    }
                });
                clonedFlowNode.properties = newProperties as NodeProperties;
            }
        }

        if (clonedFlowNode?.properties?.variable?.value == "") {
            clonedFlowNode.properties.variable.value = flowNode.current?.properties?.variable?.value || cleanName + "Result";
        }

        const chosenConnection = String(
            data["connection"] ?? clonedFlowNode?.properties?.connection?.value ?? ""
        ).trim();

        // Inject OAuth client config into codedata.data.auth
        const targetNode = clonedFunctionNode || clonedFlowNode;
        if (targetNode && showOAuthConfig) {
            const config: Record<string, string> = {};
            for (const { key } of oauthConfigPropertiesRef.current) {
                const formValue = data[key];
                if (formValue !== undefined && formValue !== "") {
                    config[key] = String(formValue);
                }
            }
            if (Object.keys(config).length > 0) {
                targetNode.codedata.data = {
                    ...targetNode.codedata.data,
                    auth: JSON.stringify(config),
                };
            }
        }

        // Mark the tool as requiring human-in-the-loop approval. This rides along in codedata.data
        // (like `auth` above) and is rendered into the @ai:AgentTool annotation by the language
        // server. The gate is the checkbox itself, not the function field — unchecking it yields an
        // empty object, so a function picked earlier and left registered can't leak (buildApprovalToolData
        // reads the checkbox first), which matters since CheckBoxConditionalEditor doesn't clear the
        // "on"-state sub-field on uncheck.
        if (targetNode) {
            const approvalData = buildApprovalToolData(data, compatibleApprovalFunctionsRef.current);
            if (Object.keys(approvalData).length > 0) {
                targetNode.codedata.data = {
                    ...targetNode.codedata.data,
                    ...approvalData,
                };
            }
        }

        console.log(">>> toolParameters", { toolParameters });
        console.log(">>> clonedFunctionNode", { clonedFunctionNode });
        console.log(">>> clonedFlowNode", { clonedFlowNode });

        // Extract parameter type imports so they can be added after genTool
        const paramImports = formImports ? getImportsForProperty("parameters", formImports) : undefined;

        const toolModel: ExtendedAgentToolRequest = {
            toolName: cleanName,
            description: data["description"],
            includeContext: data[INCLUDE_CONTEXT_KEY] === true,
            selectedCodeData: selectedNodeCodeData,
            toolParameters: toolParameters,
            functionNode: clonedFunctionNode,
            flowNode: clonedFlowNode,
            parameterImports: paramImports,
            connectionName: chosenConnection || undefined,
        };
        setSubmittingTool(true);
        try {
            await onSubmit(toolModel);
        } finally {
            setSubmittingTool(false);
        }
    };

    const toolFormGroups = useMemo(() => buildToolFormGroups(fields), [fields]);

    let searchPlaceholder = "Search";
    let listDescription: string | undefined;
    if (mode === NewToolSelectionMode.CONNECTION) {
        searchPlaceholder = "Search connections";
    } else if (mode === NewToolSelectionMode.FUNCTION) {
        searchPlaceholder = "Search functions";
        listDescription =
            "Pick a function from your integration or from a library. " +
            "The function you choose becomes the tool.";
    }

    return (
        <>
            {loading && (
                <LoaderContainer>
                    <RelativeLoader />
                </LoaderContainer>
            )}
            {connectorFirst && (
                <div
                    style={{
                        display: sidePanelView === SidePanelView.CONNECTOR_WIZARD && !loading ? "contents" : "none",
                    }}
                >
                    <ConnectorBrowser
                        filePath={agentFilePath.current}
                        target={targetRef.current.startLine}
                        existingConnectionCategories={categories}
                        connectorSet="GROUPED"
                        description="Pick an existing connection or a connector to browse its actions."
                        noActionsHint="You can still add it as a connection and create the tool from an action later."
                        onSelect={handleWizardSelect}
                        onStepChange={(step, goBack) => {
                            wizardBackRef.current = goBack;
                            onViewChange?.(
                                step === WizardStep.CONNECTOR_LIST
                                    ? SidePanelView.NODE_LIST
                                    : SidePanelView.CONNECTOR_WIZARD,
                                goBack
                            );
                        }}
                    />
                </div>
            )}
            {!loading && !connectorFirst && sidePanelView !== SidePanelView.TOOL_FORM
                && categories.length > 0 && (
                <NodeList
                    categories={categories}
                    onSelect={handleOnSelectNode}
                    onAddConnection={handleOnAddConnection}
                    onAddFunction={() => handleOnAddFunction(MACHINE_VIEW.BIFunctionForm, DIRECTORY_MAP.FUNCTION)}
                    onSearchTextChange={(searchText) => handleSearchFunction(searchText, FUNCTION_TYPE.REGULAR, true)}
                    title={"Functions"}
                    description={listDescription}
                    searchPlaceholder={searchPlaceholder}
                    panelBodySx={{ height: "calc(100vh - 140px)" }}
                    alwaysCollapsedCategories={["Imported Functions"]}
                />
            )}
            {sidePanelView === SidePanelView.TOOL_FORM && (
                <ArtifactForm
                    preserveFieldOrder={false}
                    fileName={agentFilePath.current}
                    targetLineRange={ZERO_LINE_RANGE}
                    fields={fields}
                    recordTypeFields={recordTypeFields}
                    onSubmit={handleToolSubmit}
                    onCreateNode={handleCreateNode}
                    groups={toolFormGroups}
                    opensPrefilled
                    submitText={"Save Tool"}
                    isSaving={submittingTool}
                    helperPaneSide="left"
                    customDiagnosticFilter={customDiagnosticFilter}
                    onChange={(fieldKey, value) => {
                        if (fieldKey === "parameters") {
                            parameterFieldsRef.current = value as ToolParameterItem[];
                            return;
                        }
                    }}
                    injectedComponents={[
                        {
                            component: (
                                <ImplementationBadge title={getImplementationString(selectedNodeRef.current.codedata)}>
                                    {selectedNodeRef.current.metadata?.icon && (
                                        <img
                                            src={selectedNodeRef.current.metadata.icon}
                                            style={{ width: 14, height: 14 }}
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                        />
                                    )}
                                    {getImplementationString(selectedNodeRef.current.codedata)}
                                </ImplementationBadge>
                            ),
                            index: 0,
                        },
                    ]}
                />
            )}
            {connectionCreationConnector && (
                <ConnectionCreationModal
                    connector={connectionCreationConnector}
                    connectionDependency={connectionDependency}
                    additionalReservedNames={[...addedDepNamesRef.current, ...addedAgentConnectionNamesRef.current]}
                    agentFilePath={agentFilePath.current}
                    targetLineRange={targetRef.current}
                    classFileName={agentNode.codedata.lineRange.fileName}
                    onSaved={(variableName, origin) => {
                        if (origin === "dependency") {
                            addedDepNamesRef.current.push(variableName);
                        } else {
                            addedAgentConnectionNamesRef.current.push(variableName);
                        }
                        pendingCreatedConnectionNameRef.current = variableName;
                        pendingDependencyRefreshRef.current = true;
                        setConnectionCreationConnector(undefined);
                    }}
                    onClose={() => setConnectionCreationConnector(undefined)}
                />
            )}
        </>
    );
}
