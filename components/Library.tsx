import React, { useEffect, useRef, useState } from "react";
import { ServerContext } from "@/state/server";
import Button from "@/components/elements/Button";
import Select from "@/components/elements/Select";
import Input from "@/components/elements/Input";
import Spinner from "@/components/elements/Spinner";
import { Dialog } from "@/components/elements/dialog";
import FlashMessageRender from "@/components/FlashMessageRender";
import { SearchIcon, DownloadIcon, TrashIcon } from "@heroicons/react/solid";
import useFlash from "@/plugins/useFlash";
import http from "@/api/http";
import { Source } from "./SourceSelector";
import Pagination from "./Pagination";
import { Hit, Version, InstalledEntry, ProjectDetails } from "./library/types";
import { formatSize } from "./library/format";
import useServerFilters from "./library/useServerFilters";
import BrowseCard from "./library/BrowseCard";
import ManageRow from "./library/ManageRow";
import VersionDialog from "./library/VersionDialog";
import DetailsDialog from "./library/DetailsDialog";

const PROJECT_TYPES = ["mod", "plugin", "datapack", "resourcepack"];

const TYPE_LABELS: Record<string, string> = {
    mod: "Mods",
    plugin: "Plugins",
    datapack: "Data Packs",
    resourcepack: "Resource Packs",
};

const LOADERS_BY_TYPE: Record<string, string[]> = {
    mod: ["fabric", "forge", "neoforge", "quilt"],
    plugin: [
        "paper",
        "spigot",
        "purpur",
        "bukkit",
        "folia",
        "velocity",
        "waterfall",
        "bungeecord",
    ],
    datapack: [],
    resourcepack: [],
};

const detectLoaderAndType = (
    dockerImage: string,
    invocation: string,
): { type: string; loader: string | null } => {
    const haystack = `${dockerImage} ${invocation}`.toLowerCase();

    for (const loader of LOADERS_BY_TYPE.plugin) {
        if (haystack.includes(loader)) return { type: "plugin", loader };
    }
    for (const loader of ["neoforge", "fabric", "forge", "quilt"]) {
        if (haystack.includes(loader)) return { type: "mod", loader };
    }

    return { type: "mod", loader: null };
};

const LOADER_FILE_CANDIDATES: { loader: string; type: string }[] = [
    { loader: "neoforge", type: "mod" },
    { loader: "fabric", type: "mod" },
    { loader: "quilt", type: "mod" },
    { loader: "forge", type: "mod" },
    { loader: "paper", type: "plugin" },
    { loader: "purpur", type: "plugin" },
    { loader: "spigot", type: "plugin" },
    { loader: "folia", type: "plugin" },
    { loader: "velocity", type: "plugin" },
    { loader: "waterfall", type: "plugin" },
    { loader: "bungeecord", type: "plugin" },
    { loader: "bukkit", type: "plugin" },
];

const detectFromFilenames = (
    names: string[],
): { type: string | null; loader: string | null; version: string | null } => {
    for (const candidate of LOADER_FILE_CANDIDATES) {
        const match = names.find((n) =>
            n.toLowerCase().includes(candidate.loader),
        );
        if (match) {
            const versionMatch = match.match(/\d+\.\d+(?:\.\d+)?/);
            return {
                type: candidate.type,
                loader: candidate.loader,
                version: versionMatch ? versionMatch[0] : null,
            };
        }
    }

    return { type: null, loader: null, version: null };
};

const listDirectoryNames = async (uuid: string, directory: string) => {
    try {
        const { data } = await http.get(
            `/api/client/servers/${uuid}/files/list`,
            {
                params: { directory },
            },
        );
        return (data.data ?? []).map(
            (entry: any) => entry.attributes?.name ?? "",
        );
    } catch (error) {
        return [] as string[];
    }
};

const detectFromInstalledFiles = async (uuid: string) => {
    for (const dir of ["/", "/mods", "/plugins"]) {
        const names = await listDirectoryNames(uuid, dir);
        const detected = detectFromFilenames(names);
        if (detected.loader) return detected;
    }

    return { type: null, loader: null, version: null };
};

export default () => {
    const uuid = ServerContext.useStoreState(
        (state) => state.server.data!.uuid,
    );
    const dockerImage = ServerContext.useStoreState(
        (state) => state.server.data!.dockerImage,
    );
    const invocation = ServerContext.useStoreState(
        (state) => state.server.data!.invocation,
    );
    const eggVariables = ServerContext.useStoreState(
        (state) => state.server.data!.variables,
    );
    const { addFlash, clearFlashes } = useFlash();

    const {
        loaders,
        version: gameVersion,
        setLoaders,
        setVersion: setGameVersion,
        hasStored,
    } = useServerFilters(uuid);

    const [activeTab, setActiveTab] = useState<"browse" | "manage">("manage");
    const [detailsProjectId, setDetailsProjectId] = useState<string | null>(null);
    const [details, setDetails] = useState<ProjectDetails | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);

    const [query, setQuery] = useState("");
    const [activeQuery, setActiveQuery] = useState("");
    const [type, setType] = useState("mod");
    const [gameVersions, setGameVersions] = useState<string[]>([]);
    const [results, setResults] = useState<Hit[]>([]);
    const [totalHits, setTotalHits] = useState(0);
    const [page, setPage] = useState(1);
    const [installing, setInstalling] = useState<Record<string, boolean>>({});
    const [pendingHit, setPendingHit] = useState<Hit | null>(null);
    const [searching, setSearching] = useState(false);
    const [installedFiles, setInstalledFiles] = useState<InstalledEntry[]>([]);
    const [loadingInstalled, setLoadingInstalled] = useState(false);
    const [identified, setIdentified] = useState<Record<string, Hit | null>>(
        {},
    );
    const [updateInfo, setUpdateInfo] = useState<
        Record<string, { has_update: boolean; latest_version: string | null }>
    >({});
    const [uninstalling, setUninstalling] = useState<Record<string, boolean>>(
        {},
    );
    const [confirmUninstall, setConfirmUninstall] =
        useState<InstalledEntry | null>(null);
    const [justInstalled, setJustInstalled] = useState<Record<string, boolean>>(
        {},
    );
    const [pendingVersions, setPendingVersions] = useState<Version[]>([]);
    const [loadingPendingVersions, setLoadingPendingVersions] = useState(false);
    const [provider, setProvider] = useState("modrinth");
    const [sources, setSources] = useState<Source[]>([]);
    const [enabled, setEnabled] = useState(true);
    const [updateTarget, setUpdateTarget] = useState<{
        file: InstalledEntry;
        hit: Hit | null;
    } | null>(null);
    const [updatingFile, setUpdatingFile] = useState<string | null>(null);
    const searchSeqRef = useRef(0);

    useEffect(() => {
        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/provider`,
        )
            .then(({ data }) => {
                setProvider(data.provider ?? "modrinth");
                setSources(data.sources ?? []);
                setEnabled(data.libraryEnabled ?? true);
            })
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            );

        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/versions`,
        ).then(({ data }) => {
            const validVersions: string[] = data.versions ?? [];
            setGameVersions(validVersions);

            if (hasStored()) return;

            const asRealVersion = (version: string | null) =>
                version && validVersions.includes(version) ? version : null;

            const versionVariable = eggVariables.find((v) =>
                [
                    "MINECRAFT_VERSION",
                    "MC_VERSION",
                    "SERVER_VERSION",
                    "VERSION",
                ].includes(v.envVariable),
            );
            const envVersion = asRealVersion(
                versionVariable?.serverValue &&
                    versionVariable.serverValue !== "latest"
                    ? versionVariable.serverValue
                    : null,
            );

            const docker = detectLoaderAndType(dockerImage, invocation);

            const apply = (
                type: string,
                loader: string | null,
                version: string | null,
            ) => {
                const realVersion = asRealVersion(version);
                setType(type);
                if (loader) setLoaders([loader]);
                if (realVersion) setGameVersion(realVersion);
                search("", {
                    type,
                    loaders: loader ? [loader] : [],
                    version: realVersion ?? "",
                });
            };

            if (docker.loader || envVersion) {
                apply(docker.type, docker.loader, envVersion);
            }

            if (!docker.loader || !envVersion) {
                detectFromInstalledFiles(uuid).then((fromFiles) => {
                    if (!fromFiles.loader && !fromFiles.version) return;

                    apply(
                        fromFiles.type ?? docker.type,
                        fromFiles.loader ?? docker.loader,
                        fromFiles.version ?? envVersion,
                    );
                });
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid]);

    const refreshInstalled = (forType: string) => {
        setLoadingInstalled(true);
        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/installed`,
            {
                params: { type: forType },
            },
        )
            .then(({ data }) => {
                const files: InstalledEntry[] = data.files ?? [];
                setInstalledFiles(files);
            })
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() => setLoadingInstalled(false));
    };

    const refreshInstalledSoon = (forType: string) => {
        refreshInstalled(forType);
        [2000, 5000, 10000].forEach((delay) =>
            setTimeout(() => refreshInstalled(forType), delay),
        );
    };

    const search = (
        q: string,
        overrides?: {
            type?: string;
            loaders?: string[];
            version?: string;
            page?: number;
        },
    ) => {
        const seq = ++searchSeqRef.current;
        const nextPage = overrides?.page ?? 1;
        setActiveQuery(q);
        setPage(nextPage);
        setSearching(true);
        clearFlashes("library");
        http.get(`/api/client/extensions/mclibrarymgr/servers/${uuid}/search`, {
            params: {
                q,
                type: overrides?.type ?? type,
                loaders: (overrides?.loaders ?? loaders).join(","),
                version: overrides?.version ?? gameVersion,
                page: nextPage,
            },
        })
            .then(({ data }) => {
                if (seq === searchSeqRef.current) {
                    setResults(data.hits ?? []);
                    setTotalHits(data.total_hits ?? 0);
                }
            })
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() => setSearching(false));
    };

    const goToPage = (nextPage: number) =>
        search(activeQuery, { page: nextPage });

    useEffect(() => {
        refreshInstalled(type);
        search("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid, type]);

    const changeProvider = (nextProvider: string) => {
        clearFlashes("library");
        http.post(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/provider`,
            {
                provider: nextProvider,
            },
        )
            .then(() => {
                setProvider(nextProvider);
                refreshInstalled(type);
                search(query);
            })
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            );
    };

    useEffect(() => {
        setIdentified({});
        setUpdateInfo({});
    }, [type]);

    const identifiedRef = useRef(identified);
    useEffect(() => {
        identifiedRef.current = identified;
    }, [identified]);

    const loadersRef = useRef(loaders);
    useEffect(() => {
        loadersRef.current = loaders;
    }, [loaders]);

    const gameVersionRef = useRef(gameVersion);
    useEffect(() => {
        gameVersionRef.current = gameVersion;
    }, [gameVersion]);

    useEffect(() => {
        if (type !== "resourcepack") return;
        const file = installedFiles[0];
        if (!file) return;
        if (file.name in identifiedRef.current) return;

        if (!file.project_id) {
            setIdentified((prev) => ({ ...prev, [file.name]: null }));
            return;
        }

        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/details`,
            { params: { project_id: file.project_id } },
        )
            .then(({ data }) => setIdentified((prev) => ({ ...prev, [file.name]: data })))
            .catch(() => setIdentified((prev) => ({ ...prev, [file.name]: null })));
    }, [type, uuid, installedFiles]);

    const typeRef = useRef(type);
    useEffect(() => {
        typeRef.current = type;
    }, [type]);

    // Only mods scrolled into view (see ManageRow's onVisible) get queued here —
    // with 300+ installed mods we don't want to identify all of them up front.
    const pendingIdentifyRef = useRef<Set<string>>(new Set());
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushIdentifyQueue = () => {
        const names = Array.from(pendingIdentifyRef.current);
        pendingIdentifyRef.current.clear();
        if (!names.length) return;

        const forType = typeRef.current;
        const CHUNK_SIZE = 15;
        for (let start = 0; start < names.length; start += CHUNK_SIZE) {
            const chunk = names.slice(start, start + CHUNK_SIZE);

            http.post(
                `/api/client/extensions/mclibrarymgr/servers/${uuid}/identify-batch`,
                {
                    type: forType,
                    filenames: chunk,
                    loaders: loadersRef.current.join(","),
                    version: gameVersionRef.current,
                },
            )
                .then(({ data }) => {
                    const results = data.results ?? {};
                    setIdentified((prev) => ({
                        ...prev,
                        ...Object.fromEntries(
                            chunk.map((name) => [name, results[name] ?? null]),
                        ),
                    }));
                    const updates: Record<
                        string,
                        { has_update: boolean; latest_version: string | null }
                    > = {};
                    chunk.forEach((name) => {
                        if (results[name]) {
                            updates[name] = {
                                has_update: !!results[name].has_update,
                                latest_version: results[name].latest_version ?? null,
                            };
                        }
                    });
                    setUpdateInfo((prev) => ({ ...prev, ...updates }));
                })
                .catch(() => {
                    setIdentified((prev) => ({
                        ...prev,
                        ...Object.fromEntries(chunk.map((name) => [name, null])),
                    }));
                });
        }
    };

    const IDENTIFY_BATCH_SIZE = 15;
    const queueIdentify = (name: string) => {
        if (name in identifiedRef.current || pendingIdentifyRef.current.has(name)) return;
        pendingIdentifyRef.current.add(name);

        // Flush as soon as a full batch of 15 is queued; otherwise wait for
        // scrolling to pause before sending a smaller, final batch.
        if (pendingIdentifyRef.current.size >= IDENTIFY_BATCH_SIZE) {
            if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
            flushIdentifyQueue();
            return;
        }

        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            flushIdentifyQueue();
        }, 400);
    };

    const doInstall = (hit: Hit, params: Record<string, string>) => {
        setInstalling((v) => ({ ...v, [hit.project_id]: true }));
        clearFlashes("library");
        http.post(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/install`,
            {
                project_id: hit.project_id,
                type,
                ...params,
            },
        )
            .then(({ data }) => {
                addFlash(
                    data.warning
                        ? { key: "library", type: "warning", message: data.warning }
                        : {
                              key: "library",
                              type: "success",
                              message: `${hit.title} installed.`,
                          },
                );
                setJustInstalled((v) => ({ ...v, [hit.project_id]: true }));
                refreshInstalledSoon(type);
            })
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() =>
                setInstalling((v) => ({ ...v, [hit.project_id]: false })),
            );
    };

    const install = (hit: Hit) => {
        setPendingHit(hit);
        setLoadingPendingVersions(true);
        http.get(`/api/client/extensions/mclibrarymgr/servers/${uuid}/search`, {
            params: { project_id: hit.project_id },
        })
            .then(({ data }) => setPendingVersions(data.versions ?? []))
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() => setLoadingPendingVersions(false));
    };

    const installVersion = (hit: Hit, version: Version) => {
        setPendingHit(null);
        doInstall(hit, { version_id: version.id });
    };

    const performUninstall = () => {
        const file = confirmUninstall;
        if (!file) return;
        setConfirmUninstall(null);

        const projectId = identified[file.name]?.project_id;

        setUninstalling((v) => ({ ...v, [file.name]: true }));
        clearFlashes("library");
        http.delete(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/uninstall`,
            {
                data: { type, filename: file.name },
            },
        )
            .then(() => {
                addFlash({
                    key: "library",
                    type: "success",
                    message: `${file.name} removed.`,
                });
                if (projectId) {
                    setJustInstalled((v) => ({ ...v, [projectId]: false }));
                }
                refreshInstalled(type);
            })
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() =>
                setUninstalling((v) => ({ ...v, [file.name]: false })),
            );
    };

    const openUpdateDialog = (file: InstalledEntry, hit: Hit | null | undefined) => {
        setUpdateTarget({ file, hit: hit ?? null });
        setPendingHit(
            hit ?? {
                project_id: file.project_id ?? "",
                slug: "",
                title: file.name,
                description: "",
                project_type: type,
                icon_url: null,
                downloads: 0,
                likes: 0,
            },
        );
        setLoadingPendingVersions(true);
        http.get(`/api/client/extensions/mclibrarymgr/servers/${uuid}/search`, {
            params: { project_id: hit?.project_id ?? file.project_id },
        })
            .then(({ data }) => setPendingVersions(data.versions ?? []))
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() => setLoadingPendingVersions(false));
    };

    const applyUpdate = (version: Version) => {
        if (!updateTarget) return;
        const { file } = updateTarget;
        setPendingHit(null);
        setUpdateTarget(null);
        setUpdatingFile(file.name);
        clearFlashes("library");

        const cleanup = () => setUpdatingFile(null);

        if (type === "resourcepack") {
            // No old file to remove — installing just overwrites server.properties.
            doInstall(
                {
                    project_id: file.project_id ?? "",
                    slug: "",
                    title: file.name,
                    description: "",
                    project_type: type,
                    icon_url: null,
                    downloads: 0,
                    likes: 0,
                },
                { version_id: version.id },
            );
            cleanup();
            return;
        }

        http.delete(`/api/client/extensions/mclibrarymgr/servers/${uuid}/uninstall`, {
            data: { type, filename: file.name },
        })
            .then(() =>
                doInstall(
                    {
                        project_id: updateTarget.hit?.project_id ?? "",
                        slug: "",
                        title: file.name,
                        description: "",
                        project_type: type,
                        icon_url: null,
                        downloads: 0,
                        likes: 0,
                    },
                    { version_id: version.id },
                ),
            )
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(cleanup);
    };

    const openDetails = (projectId: string) => {
        setDetailsProjectId(projectId);
        setLoadingDetails(true);
        http.get(`/api/client/extensions/mclibrarymgr/servers/${uuid}/details`, {
            params: { project_id: projectId },
        })
            .then(({ data }) => setDetails(data))
            .catch((error) =>
                addFlash({
                    key: "library",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() => setLoadingDetails(false));
    };

    const matchesCurrentFilters = (v: Version) =>
        (!gameVersion || v.game_versions.includes(gameVersion)) &&
        (loaders.length === 0 || v.loaders.some((l) => loaders.includes(l)));

    const filteredPendingVersions = pendingVersions.filter(
        matchesCurrentFilters,
    );
    const showingAllVersions =
        pendingVersions.length > 0 && filteredPendingVersions.length === 0;

    const installedFileByProjectId = (
        projectId: string,
    ): InstalledEntry | undefined => {
        const filename = Object.entries(identified).find(
            ([, h]) => h?.project_id === projectId,
        )?.[0];
        return filename
            ? installedFiles.find((f) => f.name === filename)
            : undefined;
    };

    if (!enabled) {
        return (
            <div css={{ padding: "1rem", maxWidth: "900px", margin: "0 auto" }}>
                <div css={{ opacity: 0.7 }}>
                    The Library tab has been disabled by an administrator.
                </div>
            </div>
        );
    }

    const isPicking = updateTarget
        ? !!updatingFile
        : pendingHit
          ? !!installing[pendingHit.project_id]
          : false;

    return (
        <div css={{ padding: "1rem", maxWidth: "900px", margin: "0 auto" }}>
            <FlashMessageRender
                byKey="library"
                css={{ marginBottom: "1rem" }}
            />

            <div className="mb-4">
                <div className="text-[0.65rem] uppercase tracking-wide opacity-60 mb-1">
                    Platform
                </div>
                <Select
                    css={{ width: "160px" }}
                    value={provider}
                    onChange={(e) => changeProvider(e.currentTarget.value)}
                >
                    {sources.map(({ id, label, available }) => (
                        <option key={id} value={id} disabled={!available}>
                            {label}
                            {available ? "" : " (not configured)"}
                        </option>
                    ))}
                </Select>
            </div>

            <div className="flex flex-wrap gap-3 mb-4">
                <div className="flex gap-4 bg-white/[0.04] rounded-lg px-3 pt-2">
                    {(["browse", "manage"] as const).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveTab(tab)}
                            className={`pb-2 -mb-px border-0 border-b-2 bg-transparent cursor-pointer text-sm font-semibold capitalize ${
                                activeTab === tab
                                    ? "border-primary-500 text-primary-400"
                                    : "border-transparent text-neutral-400"
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div className="flex gap-4 bg-white/[0.04] rounded-lg px-3 pt-2 flex-wrap">
                    {PROJECT_TYPES.map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => {
                                setType(t);
                                setLoaders([]);
                            }}
                            className={`pb-2 -mb-px border-0 border-b-2 bg-transparent cursor-pointer text-sm font-semibold ${
                                type === t
                                    ? "border-primary-500 text-primary-400"
                                    : "border-transparent text-neutral-400"
                            }`}
                        >
                            {TYPE_LABELS[t]}
                        </button>
                    ))}
                </div>
            </div>

            {activeTab === "browse" && (
                <>
                    <div className="flex flex-col gap-3 bg-white/[0.04] rounded-lg p-3 mb-4">
                        {LOADERS_BY_TYPE[type].length > 0 && (
                            <div>
                                <div className="text-[0.65rem] uppercase tracking-wide opacity-60 mb-1">
                                    Loader
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    {LOADERS_BY_TYPE[type].map((l) => (
                                        <label
                                            key={l}
                                            className="flex items-center gap-1.5 text-sm"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={loaders.includes(l)}
                                                onChange={(e) => {
                                                    const checked = e.currentTarget.checked;
                                                    setLoaders(
                                                        checked
                                                            ? [...loaders, l]
                                                            : loaders.filter((x) => x !== l),
                                                    );
                                                }}
                                            />
                                            {l}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-4">
                            <div>
                                <div className="text-[0.65rem] uppercase tracking-wide opacity-60 mb-1">
                                    Version
                                </div>
                                <Select
                                    css={{ width: "160px" }}
                                    value={gameVersion}
                                    onChange={(e) => setGameVersion(e.currentTarget.value)}
                                >
                                    <option value="">Any version</option>
                                    {gameVersion && !gameVersions.includes(gameVersion) && (
                                        <option value={gameVersion}>{gameVersion}</option>
                                    )}
                                    {gameVersions.map((v) => (
                                        <option key={v} value={v}>
                                            {v}
                                        </option>
                                    ))}
                                </Select>
                            </div>

                            <div className="flex-1 min-w-[200px]">
                                <div className="text-[0.65rem] uppercase tracking-wide opacity-60 mb-1">
                                    Search
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        css={{ flex: 1 }}
                                        value={query}
                                        onChange={(e) => setQuery(e.currentTarget.value)}
                                        onKeyDown={(e) => e.key === "Enter" && search(query)}
                                        placeholder={`Search ${TYPE_LABELS[type].toLowerCase()}...`}
                                    />
                                    <Button
                                        onClick={() => search(query)}
                                        disabled={searching}
                                        aria-label="Search"
                                    >
                                        <SearchIcon css={{ width: "1.1rem", height: "1.1rem" }} />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div
                        css={{
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            marginBottom: "0.5rem",
                        }}
                    >
                        Search
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {results.map((hit) => {
                            const installedFile = installedFileByProjectId(hit.project_id);
                            const isInstalling = installing[hit.project_id];
                            const isPendingConfirm =
                                justInstalled[hit.project_id] && !installedFile;
                            return (
                                <BrowseCard
                                    key={hit.project_id}
                                    hit={hit}
                                    provider={provider}
                                    onDetails={() => openDetails(hit.project_id)}
                                    action={
                                        installedFile ? (
                                            <Button
                                                color="red"
                                                isSecondary
                                                onClick={() => setConfirmUninstall(installedFile)}
                                                aria-label="Uninstall"
                                                title="Uninstall"
                                                className="!px-2"
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </Button>
                                        ) : (
                                            <Button
                                                onClick={() => install(hit)}
                                                disabled={isInstalling || isPendingConfirm}
                                                isLoading={isInstalling || isPendingConfirm}
                                                aria-label="Install"
                                                title="Install"
                                                className="!px-2"
                                            >
                                                <DownloadIcon className="w-4 h-4" />
                                            </Button>
                                        )
                                    }
                                />
                            );
                        })}
                    </div>
                    <Pagination
                        page={page}
                        totalHits={totalHits}
                        onChange={goToPage}
                        disabled={searching}
                    />
                </>
            )}

            {activeTab === "manage" &&
                (loadingInstalled ? (
                    <Spinner size={Spinner.Size.SMALL} centered />
                ) : installedFiles.length === 0 ? (
                    <div className="text-sm opacity-60">Nothing installed yet.</div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {installedFiles.map((f) => {
                            const hit = identified[f.name];
                            const update = updateInfo[f.name];
                            return (
                                <div key={f.name}>
                                    <ManageRow
                                        hit={hit}
                                        filename={f.name}
                                        sizeLabel={type === "resourcepack" ? undefined : formatSize(f.size)}
                                        hasUpdate={update?.has_update}
                                        latestVersion={update?.latest_version}
                                        provider={hit ? provider : undefined}
                                        updating={updatingFile === f.name}
                                        uninstalling={uninstalling[f.name]}
                                        onUpdate={() => openUpdateDialog(f, hit)}
                                        onUninstall={() => setConfirmUninstall(f)}
                                        onVisible={
                                            hit === undefined
                                                ? () => queueIdentify(f.name)
                                                : undefined
                                        }
                                    />
                                </div>
                            );
                        })}
                    </div>
                ))}

            <VersionDialog
                open={!!pendingHit}
                title={`Select a version${pendingHit ? ` — ${pendingHit.title}` : ""}`}
                versions={showingAllVersions ? pendingVersions : filteredPendingVersions}
                loading={loadingPendingVersions}
                onPick={(v) => (updateTarget ? applyUpdate(v) : pendingHit && installVersion(pendingHit, v))}
                onClose={() => {
                    setPendingHit(null);
                    setUpdateTarget(null);
                }}
                picking={isPicking ? "picking" : null}
            />

            <Dialog
                open={!!confirmUninstall}
                onClose={() => setConfirmUninstall(null)}
                title="Delete file?"
            >
                {type === "resourcepack" ? (
                    <>
                        Remove <strong>{confirmUninstall?.name}</strong> as the
                        active resource pack? This clears it from
                        server.properties.
                    </>
                ) : (
                    <>
                        Delete <strong>{confirmUninstall?.name}</strong>? This
                        can&apos;t be undone.
                    </>
                )}
                <Dialog.Footer>
                    <Button
                        isSecondary
                        onClick={() => setConfirmUninstall(null)}
                    >
                        Cancel
                    </Button>
                    <Button color="red" onClick={performUninstall}>
                        Uninstall
                    </Button>
                </Dialog.Footer>
            </Dialog>

            <DetailsDialog
                open={!!detailsProjectId}
                details={details}
                loading={loadingDetails}
                provider={provider}
                onClose={() => {
                    setDetailsProjectId(null);
                    setDetails(null);
                }}
            />
        </div>
    );
};
