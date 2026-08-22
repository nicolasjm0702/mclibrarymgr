import React, { useEffect, useRef, useState } from "react";
import { ServerContext } from "@/state/server";
import Button from "@/components/elements/Button";
import Select from "@/components/elements/Select";
import Input from "@/components/elements/Input";
import Spinner from "@/components/elements/Spinner";
import { Dialog } from "@/components/elements/dialog";
import FlashMessageRender from "@/components/FlashMessageRender";
import {
    SearchIcon,
    ChevronDownIcon,
    ChevronRightIcon,
} from "@heroicons/react/solid";
import useFlash from "@/plugins/useFlash";
import http from "@/api/http";
import SourceSelector, { Source, sourceProjectUrl } from "./SourceSelector";
import Pagination from "./Pagination";

interface ModrinthHit {
    project_id: string;
    slug: string;
    title: string;
    description: string;
    project_type: string;
    icon_url: string | null;
    author?: string;
    downloads: number;
}

interface InstalledFile {
    name: string;
    size: number;
}

interface ModrinthVersion {
    id: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
}

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

const formatDownloads = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
};

const formatSize = (bytes: number) => {
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
};

const HitCard = ({
    hit,
    action,
    sizeLabel,
    provider,
}: {
    hit: ModrinthHit;
    action: React.ReactNode;
    sizeLabel?: string;
    provider?: string;
}) => (
    <div
        css={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "1rem",
            borderRadius: "0.5rem",
            backgroundColor: "rgba(255, 255, 255, 0.04)",
        }}
    >
        {hit.icon_url ? (
            <img
                src={hit.icon_url}
                alt={hit.title}
                css={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "0.375rem",
                    flexShrink: 0,
                }}
            />
        ) : (
            <div
                css={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "0.375rem",
                    flexShrink: 0,
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                }}
            />
        )}

        <div css={{ flex: 1, minWidth: 0 }}>
            <div css={{ fontWeight: 600 }}>
                {provider ? (
                    <a
                        href={sourceProjectUrl(provider, hit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        css={{
                            color: "inherit",
                            "&:hover": { textDecoration: "underline" },
                        }}
                    >
                        {hit.title}
                    </a>
                ) : (
                    hit.title
                )}
            </div>
            <div
                css={{
                    fontSize: "0.85rem",
                    opacity: 0.7,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                {hit.description}
            </div>
            <div
                css={{
                    fontSize: "0.75rem",
                    opacity: 0.5,
                    marginTop: "0.25rem",
                }}
            >
                {hit.author && <>by {hit.author} &middot; </>}
                {formatDownloads(hit.downloads)} downloads
                {sizeLabel && <> &middot; {sizeLabel}</>}
            </div>
        </div>

        <div
            css={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flexShrink: 0,
            }}
        >
            {action}
        </div>
    </div>
);

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

    const [query, setQuery] = useState("");
    const [activeQuery, setActiveQuery] = useState("");
    const [type, setType] = useState("mod");
    const [loaders, setLoaders] = useState<string[]>([]);
    const [gameVersion, setGameVersion] = useState("");
    const [gameVersions, setGameVersions] = useState<string[]>([]);
    const [results, setResults] = useState<ModrinthHit[]>([]);
    const [totalHits, setTotalHits] = useState(0);
    const [page, setPage] = useState(1);
    const [installing, setInstalling] = useState<Record<string, boolean>>({});
    const [pendingHit, setPendingHit] = useState<ModrinthHit | null>(null);
    const [searching, setSearching] = useState(false);
    const [installedFiles, setInstalledFiles] = useState<InstalledFile[]>([]);
    const [loadingInstalled, setLoadingInstalled] = useState(false);
    const [installedCollapsed, setInstalledCollapsed] = useState(false);
    const [identified, setIdentified] = useState<
        Record<string, ModrinthHit | null>
    >({});
    const [uninstalling, setUninstalling] = useState<Record<string, boolean>>(
        {},
    );
    const [confirmUninstall, setConfirmUninstall] =
        useState<InstalledFile | null>(null);
    const [justInstalled, setJustInstalled] = useState<Record<string, boolean>>(
        {},
    );
    const [pendingVersions, setPendingVersions] = useState<ModrinthVersion[]>(
        [],
    );
    const [loadingPendingVersions, setLoadingPendingVersions] = useState(false);
    const [provider, setProvider] = useState("modrinth");
    const [sources, setSources] = useState<Source[]>([]);
    const [enabled, setEnabled] = useState(true);
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
            .then(({ data }) => setInstalledFiles(data.files ?? []))
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
    }, [type]);

    const identifiedRef = useRef(identified);
    useEffect(() => {
        identifiedRef.current = identified;
    }, [identified]);

    const installedFilesRef = useRef(installedFiles);
    useEffect(() => {
        installedFilesRef.current = installedFiles;
    }, [installedFiles]);

    const rowObserverRef = useRef<IntersectionObserver | null>(null);
    const rowRefCallbacksRef = useRef<Map<string, (el: HTMLElement | null) => void>>(
        new Map(),
    );
    const rowElementsRef = useRef<Map<string, HTMLElement>>(new Map());

    useEffect(() => {
        rowRefCallbacksRef.current = new Map();
        rowElementsRef.current = new Map();

        const CHUNK_SIZE = 15;
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        const flush = () => {
            const pendingNames = installedFilesRef.current
                .map((f) => f.name)
                .filter((name) => !(name in identifiedRef.current));
            if (pendingNames.length === 0) return;

            const chunk = pendingNames.slice(0, CHUNK_SIZE);

            for (const name of chunk) {
                const el = rowElementsRef.current.get(name);
                if (el) observer.unobserve(el);
            }

            http.post(
                `/api/client/extensions/mclibrarymgr/servers/${uuid}/identify-batch`,
                { type, filenames: chunk },
            )
                .then(({ data }) => {
                    const results = data.results ?? {};
                    setIdentified((prev) => ({
                        ...prev,
                        ...Object.fromEntries(
                            chunk.map((name) => [name, results[name] ?? null]),
                        ),
                    }));
                })
                .catch(() => {
                    setIdentified((prev) => ({
                        ...prev,
                        ...Object.fromEntries(chunk.map((name) => [name, null])),
                    }));
                });
        };

        const observer = new IntersectionObserver(
            (entries) => {
                const sawNew = entries.some((entry) => {
                    if (!entry.isIntersecting) return false;
                    const filename = (entry.target as HTMLElement).dataset
                        .filename;
                    return !!filename && !(filename in identifiedRef.current);
                });

                if (!sawNew) return;
                if (flushTimer) clearTimeout(flushTimer);
                // Debounce so a fast scroll settles before grabbing the chunk.
                flushTimer = setTimeout(flush, 150);
            },
            { rootMargin: "200px" },
        );
        rowObserverRef.current = observer;

        return () => {
            observer.disconnect();
            if (flushTimer) clearTimeout(flushTimer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type, uuid]);

    const getRowRefCallback = (filename: string) => {
        const cache = rowRefCallbacksRef.current;
        let callback = cache.get(filename);
        if (!callback) {
            callback = (el) => {
                if (el) {
                    el.dataset.filename = filename;
                    rowElementsRef.current.set(filename, el);
                    rowObserverRef.current?.observe(el);
                }
            };
            cache.set(filename, callback);
        }
        return callback;
    };

    const doInstall = (hit: ModrinthHit, params: Record<string, string>) => {
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

    const install = (hit: ModrinthHit) => {
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

    const installVersion = (hit: ModrinthHit, version: ModrinthVersion) => {
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

    const matchesCurrentFilters = (v: ModrinthVersion) =>
        (!gameVersion || v.game_versions.includes(gameVersion)) &&
        (loaders.length === 0 || v.loaders.some((l) => loaders.includes(l)));

    const filteredPendingVersions = pendingVersions.filter(
        matchesCurrentFilters,
    );
    const showingAllVersions =
        pendingVersions.length > 0 && filteredPendingVersions.length === 0;

    const installedFileByProjectId = (
        projectId: string,
    ): InstalledFile | undefined => {
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

    return (
        <div css={{ padding: "1rem", maxWidth: "900px", margin: "0 auto" }}>
            <FlashMessageRender
                byKey="library"
                css={{ marginBottom: "1rem" }}
            />

            <SourceSelector
                provider={provider}
                sources={sources}
                onChange={changeProvider}
            />

            <div
                css={{
                    fontSize: "0.75rem",
                    opacity: 0.6,
                    marginBottom: "0.35rem",
                }}
            >
                Type
            </div>
            <div
                css={{
                    display: "flex",
                    gap: "0.25rem",
                    marginBottom: "1.5rem",
                    flexWrap: "wrap",
                }}
            >
                {PROJECT_TYPES.map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => {
                            setType(t);
                            setLoaders([]);
                        }}
                        className={`px-4 py-2 rounded-full border-0 cursor-pointer text-sm font-semibold ${
                            type === t
                                ? "bg-primary-500 text-primary-50"
                                : "bg-transparent text-neutral-300"
                        }`}
                    >
                        {TYPE_LABELS[t]}
                    </button>
                ))}
            </div>

            <div
                css={{
                    fontSize: "0.75rem",
                    opacity: 0.6,
                    marginBottom: "0.35rem",
                }}
            >
                Search filters
            </div>
            <div
                css={{
                    display: "flex",
                    gap: "0.25rem",
                    marginBottom: "1.5rem",
                    flexWrap: "wrap",
                }}
            >
                <Select
                    css={{ width: "160px", flexShrink: 0 }}
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

            {LOADERS_BY_TYPE[type].length > 0 && (
                <div css={{ marginBottom: "1.5rem" }}>
                    <div
                        css={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.25rem 0.75rem",
                            maxWidth: "360px",
                        }}
                    >
                        {LOADERS_BY_TYPE[type].map((l) => (
                            <label
                                key={l}
                                css={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.35rem",
                                    fontSize: "0.85rem",
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={loaders.includes(l)}
                                    onChange={(e) => {
                                        const checked = e.currentTarget.checked;
                                        setLoaders((prev) =>
                                            checked
                                                ? [...prev, l]
                                                : prev.filter((x) => x !== l),
                                        );
                                    }}
                                />
                                {l}
                            </label>
                        ))}
                    </div>
                </div>
            )}

            {!activeQuery.trim() && (
                <div css={{ marginBottom: "1.5rem" }}>
                    <button
                        onClick={() => setInstalledCollapsed((v) => !v)}
                        css={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            marginBottom: "0.5rem",
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            color: "inherit",
                        }}
                    >
                        {installedCollapsed ? (
                            <ChevronRightIcon
                                css={{ width: "1rem", height: "1rem" }}
                            />
                        ) : (
                            <ChevronDownIcon
                                css={{ width: "1rem", height: "1rem" }}
                            />
                        )}
                        Installed {TYPE_LABELS[type].toLowerCase()} (
                        {installedFiles.length})
                    </button>
                    {!installedCollapsed &&
                        (loadingInstalled ? (
                            <Spinner size={Spinner.Size.SMALL} />
                        ) : installedFiles.length === 0 ? (
                            <div css={{ fontSize: "0.85rem", opacity: 0.6 }}>
                                Nothing installed yet.
                            </div>
                        ) : (
                            <div
                                css={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.5rem",
                                }}
                            >
                                {installedFiles.map((f) => {
                                    const hit = identified[f.name];
                                    const deleteButton = (
                                        <Button
                                            color="red"
                                            onClick={() =>
                                                setConfirmUninstall(f)
                                            }
                                            disabled={uninstalling[f.name]}
                                            isLoading={uninstalling[f.name]}
                                        >
                                            Uninstall
                                        </Button>
                                    );
                                    const displayHit = hit ?? {
                                        project_id: f.name,
                                        slug: "",
                                        title: f.name,
                                        description:
                                            hit === null
                                                ? "Not found on this source."
                                                : "Looking up details…",
                                        project_type: type,
                                        icon_url: null,
                                        downloads: 0,
                                    };

                                    return (
                                        <div
                                            key={f.name}
                                            ref={
                                                hit === undefined
                                                    ? getRowRefCallback(f.name)
                                                    : undefined
                                            }
                                        >
                                            <HitCard
                                                hit={displayHit}
                                                sizeLabel={formatSize(f.size)}
                                                action={deleteButton}
                                                provider={hit ? provider : undefined}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                </div>
            )}

            <div
                css={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                }}
            >
                Search
            </div>
            <div
                css={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                }}
            >
                {results.map((hit) => {
                    const installedFile = installedFileByProjectId(
                        hit.project_id,
                    );
                    const isInstalling = installing[hit.project_id];
                    const isPendingConfirm =
                        justInstalled[hit.project_id] && !installedFile;
                    return (
                        <HitCard
                            key={hit.project_id}
                            hit={hit}
                            provider={provider}
                            action={
                                installedFile ? (
                                    <Button
                                        color="red"
                                        onClick={() =>
                                            setConfirmUninstall(installedFile)
                                        }
                                        disabled={
                                            uninstalling[installedFile.name]
                                        }
                                        isLoading={
                                            uninstalling[installedFile.name]
                                        }
                                    >
                                        Uninstall
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={() => install(hit)}
                                        disabled={
                                            isInstalling || isPendingConfirm
                                        }
                                        isLoading={
                                            isInstalling || isPendingConfirm
                                        }
                                    >
                                        Install
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

            <Dialog
                open={!!pendingHit}
                onClose={() => setPendingHit(null)}
                title={`Select a version${pendingHit ? ` — ${pendingHit.title}` : ""}`}
            >
                {loadingPendingVersions ? (
                    <Spinner size={Spinner.Size.SMALL} centered />
                ) : pendingVersions.length === 0 ? (
                    <div css={{ fontSize: "0.85rem", opacity: 0.7 }}>
                        No versions found for this project.
                    </div>
                ) : (
                    <div
                        css={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                            maxHeight: "50vh",
                            overflowY: "auto",
                        }}
                    >
                        {showingAllVersions && (
                            <div
                                css={{
                                    fontSize: "0.8rem",
                                    opacity: 0.6,
                                    marginBottom: "0.25rem",
                                }}
                            >
                                No versions match your selected filters —
                                showing all versions.
                            </div>
                        )}
                        {(showingAllVersions
                            ? pendingVersions
                            : filteredPendingVersions
                        ).map((v) => (
                            <div
                                key={v.id}
                                css={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "0.5rem 0.75rem",
                                    borderRadius: "0.25rem",
                                    backgroundColor:
                                        "rgba(255, 255, 255, 0.04)",
                                }}
                            >
                                <div css={{ minWidth: 0 }}>
                                    <div css={{ fontWeight: 600 }}>
                                        {v.version_number}
                                    </div>
                                    <div
                                        css={{
                                            fontSize: "0.75rem",
                                            opacity: 0.6,
                                        }}
                                    >
                                        {v.loaders.join(", ")} &middot;{" "}
                                        {v.game_versions.slice(-3).join(", ")}
                                    </div>
                                </div>
                                <Button
                                    onClick={() =>
                                        pendingHit &&
                                        installVersion(pendingHit, v)
                                    }
                                    disabled={
                                        pendingHit
                                            ? installing[pendingHit.project_id]
                                            : false
                                    }
                                >
                                    Install
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </Dialog>

            <Dialog
                open={!!confirmUninstall}
                onClose={() => setConfirmUninstall(null)}
                title="Delete file?"
            >
                Delete <strong>{confirmUninstall?.name}</strong>? This
                can&apos;t be undone.
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
        </div>
    );
};
