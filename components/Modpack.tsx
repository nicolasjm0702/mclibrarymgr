import React, { useEffect, useRef, useState } from "react";
import { ServerContext } from "@/state/server";
import Button from "@/components/elements/Button";
import Select from "@/components/elements/Select";
import Input from "@/components/elements/Input";
import Spinner from "@/components/elements/Spinner";
import { Dialog } from "@/components/elements/dialog";
import FlashMessageRender from "@/components/FlashMessageRender";
import { SearchIcon, TrashIcon } from "@heroicons/react/solid";
import useFlash from "@/plugins/useFlash";
import http from "@/api/http";
import SourceSelector, { Source, sourceProjectUrl } from "./SourceSelector";
import Pagination from "./Pagination";

interface ModpackHit {
    project_id: string;
    slug: string;
    title: string;
    description: string;
    project_type: string;
    icon_url: string | null;
    author?: string;
    downloads: number;
    loaders?: string[];
}

interface ModpackVersion {
    id: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
}

interface ManifestEntry {
    path: string;
    kind: "download" | "override";
}

interface EntryRow extends ManifestEntry {
    status: "pending" | "ok" | "error";
}

interface InstalledModpack {
    project_id?: string;
    name: string;
    version_number: string;
    slug?: string;
    title?: string;
    description?: string;
    project_type?: string;
    icon_url?: string | null;
    downloads?: number;
}

const LOADERS = ["fabric", "forge", "neoforge", "quilt"];
const INSTALL_ROW_WINDOW = 8;

// Order matters: neoforge/quilt before forge so a substring match (e.g.
// "forge" inside "neoforge-1.20.1-...") doesn't win first.
const LOADER_FILE_CANDIDATES = ["neoforge", "fabric", "quilt", "forge"];

const detectFromFilenames = (
    names: string[],
): { loader: string | null; version: string | null } => {
    for (const loader of LOADER_FILE_CANDIDATES) {
        const match = names.find((n) => n.toLowerCase().includes(loader));
        if (match) {
            const versionMatch = match.match(/\d+\.\d+(?:\.\d+)?/);
            return { loader, version: versionMatch ? versionMatch[0] : null };
        }
    }

    return { loader: null, version: null };
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
    // Check root first — the server jar/installer there (e.g.
    // "forge-1.20.1-[...].jar") names the loader actually running the
    // server. mods/ can be misleading: compat layers (Sinytra Connector, etc.)
    // let fabric-named mod jars run under a Forge server.
    for (const dir of ["/", "/mods"]) {
        const names = await listDirectoryNames(uuid, dir);
        const detected = detectFromFilenames(names);
        if (detected.loader) return detected;
    }

    return { loader: null, version: null };
};

const formatDownloads = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
};

const HitCard = ({
    hit,
    action,
    provider,
}: {
    hit: ModpackHit;
    action: React.ReactNode;
    provider: string;
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
                {hit.loaders && hit.loaders.length > 0 && (
                    <> &middot; {hit.loaders.join(", ")}</>
                )}
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

export default () => {
    const uuid = ServerContext.useStoreState(
        (state) => state.server.data!.uuid,
    );
    const { addFlash, clearFlashes } = useFlash();

    const [provider, setProvider] = useState("modrinth");
    const [sources, setSources] = useState<Source[]>([]);
    const [enabled, setEnabled] = useState(true);
    const searchSeqRef = useRef(0);
    const [installedModpack, setInstalledModpack] =
        useState<InstalledModpack | null>(null);
    const [query, setQuery] = useState("");
    const [loader, setLoader] = useState("");
    const [gameVersion, setGameVersion] = useState("");
    const [gameVersions, setGameVersions] = useState<string[]>([]);
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<ModpackHit[]>([]);
    const [totalHits, setTotalHits] = useState(0);
    const [page, setPage] = useState(1);

    const [pendingHit, setPendingHit] = useState<ModpackHit | null>(null);
    const [pendingVersions, setPendingVersions] = useState<ModpackVersion[]>(
        [],
    );
    const [loadingPendingVersions, setLoadingPendingVersions] = useState(false);

    const [confirmInstall, setConfirmInstall] = useState<{
        hit: ModpackHit;
        version: ModpackVersion;
    } | null>(null);

    const [installToken, setInstallToken] = useState<string | null>(null);
    const [installName, setInstallName] = useState("");
    const [installVersionNumber, setInstallVersionNumber] = useState("");
    const [entryRows, setEntryRows] = useState<EntryRow[]>([]);
    const [installRunning, setInstallRunning] = useState(false);
    const [installDone, setInstallDone] = useState(false);
    const [installIndex, setInstallIndex] = useState(-1);
    const [installTotal, setInstallTotal] = useState(0);

    const closeInstallDialog = () => {
        setInstallToken(null);
        setInstallRunning(false);
        setInstallDone(false);
    };

    const refreshInstalled = () => {
        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/modpacks/installed`,
        ).then(({ data }) => setInstalledModpack(data.installed ? data : null));
    };

    const [confirmUninstallModpack, setConfirmUninstallModpack] =
        useState(false);
    const [uninstallingModpack, setUninstallingModpack] = useState(false);

    const uninstallModpack = () => {
        setUninstallingModpack(true);
        clearFlashes("modpack");
        http.delete(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/modpacks/uninstall`,
        )
            .then(({ data }) => {
                addFlash({
                    key: "modpack",
                    type: "success",
                    message:
                        (data.removed > 0
                            ? `Removed ${data.removed} file${data.removed === 1 ? "" : "s"}.`
                            : "Modpack cleared (no tracked files to remove).") +
                        " Reloading...",
                });
                setTimeout(() => window.location.reload(), 1200);
            })
            .catch((error) => {
                addFlash({
                    key: "modpack",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                });
                setUninstallingModpack(false);
                setConfirmUninstallModpack(false);
            });
    };

    useEffect(() => {
        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/provider`,
        )
            .then(({ data }) => {
                setProvider(data.provider ?? "modrinth");
                setSources(data.sources ?? []);
                setEnabled(data.modpackEnabled ?? true);
            })
            .catch((error) =>
                addFlash({
                    key: "modpack",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            );

        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/versions`,
        ).then(({ data }) => {
            const validVersions: string[] = data.versions ?? [];
            setGameVersions(validVersions);

            detectFromInstalledFiles(uuid).then((detected) => {
                if (!detected.loader && !detected.version) return;

                const realVersion =
                    detected.version && validVersions.includes(detected.version)
                        ? detected.version
                        : null;

                if (detected.loader) setLoader(detected.loader);
                if (realVersion) setGameVersion(realVersion);
                search("", detected.loader ?? "", realVersion ?? "");
            });
        });

        refreshInstalled();
        search("", "", "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid]);

    const search = (q: string, l: string, v: string, p: number = 1) => {
        const seq = ++searchSeqRef.current;
        setPage(p);
        setSearching(true);
        clearFlashes("modpack");
        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/modpacks/search`,
            {
                params: {
                    q,
                    loader: l || undefined,
                    version: v || undefined,
                    page: p,
                },
            },
        )
            .then(({ data }) => {
                if (seq === searchSeqRef.current) {
                    setResults(data.hits ?? []);
                    setTotalHits(data.total_hits ?? 0);
                }
            })
            .catch((error) =>
                addFlash({
                    key: "modpack",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() => setSearching(false));
    };

    const goToPage = (nextPage: number) =>
        search(query, loader, gameVersion, nextPage);

    const changeProvider = (nextProvider: string) => {
        clearFlashes("modpack");
        http.post(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/provider`,
            {
                provider: nextProvider,
            },
        )
            .then(() => {
                setProvider(nextProvider);
                refreshInstalled();
                search(query, loader, gameVersion);
            })
            .catch((error) =>
                addFlash({
                    key: "modpack",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            );
    };

    const openVersionPicker = (hit: ModpackHit) => {
        setPendingHit(hit);
        setLoadingPendingVersions(true);
        clearFlashes("modpack");
        http.get(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/modpacks/versions`,
            {
                params: { project_id: hit.project_id },
            },
        )
            .then(({ data }) => setPendingVersions(data.versions ?? []))
            .catch((error) =>
                addFlash({
                    key: "modpack",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() => setLoadingPendingVersions(false));
    };

    const matchesCurrentFilters = (v: ModpackVersion) =>
        (!gameVersion || v.game_versions.includes(gameVersion)) &&
        (!loader || v.loaders.map((l) => l.toLowerCase()).includes(loader));

    const filteredPendingVersions = pendingVersions.filter(
        matchesCurrentFilters,
    );
    const showingAllVersions =
        pendingVersions.length > 0 && filteredPendingVersions.length === 0;

    const pickVersion = (version: ModpackVersion) => {
        if (!pendingHit) return;
        setConfirmInstall({ hit: pendingHit, version });
        setPendingHit(null);
    };

    const runInstall = () => {
        if (!confirmInstall) return;
        const { hit, version } = confirmInstall;
        setConfirmInstall(null);
        clearFlashes("modpack");

        http.post(
            `/api/client/extensions/mclibrarymgr/servers/${uuid}/modpacks/manifest`,
            {
                project_id: hit.project_id,
                version_id: version.id,
            },
        )
            .then(async ({ data }) => {
                setInstallToken(data.token);
                setInstallName(data.name);
                setInstallVersionNumber(data.version_number);
                setEntryRows(
                    data.entries.map((e: ManifestEntry) => ({
                        ...e,
                        status: "pending",
                    })),
                );
                setInstallTotal(data.entries.length);
                setInstallIndex(-1);
                setInstallRunning(true);

                let okCount = 0;
                const installedPaths: string[] = [];
                const entries = data.entries as ManifestEntry[];
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    setInstallIndex(i);
                    try {
                        await http.post(
                            `/api/client/extensions/mclibrarymgr/servers/${uuid}/modpacks/install-entry`,
                            { token: data.token, path: entry.path },
                        );
                        okCount += 1;
                        installedPaths.push(entry.path);
                        setEntryRows((rows) =>
                            rows.map((r) =>
                                r.path === entry.path
                                    ? { ...r, status: "ok" }
                                    : r,
                            ),
                        );
                    } catch (error) {
                        setEntryRows((rows) =>
                            rows.map((r) =>
                                r.path === entry.path
                                    ? { ...r, status: "error" }
                                    : r,
                            ),
                        );
                    }
                }

                await http.post(
                    `/api/client/extensions/mclibrarymgr/servers/${uuid}/modpacks/finalize`,
                    {
                        token: data.token,
                        project_id: hit.project_id,
                        name: data.name,
                        version_number: data.version_number,
                        paths: installedPaths,
                    },
                );

                setInstallDone(true);
                addFlash({
                    key: "modpack",
                    type:
                        okCount === data.entries.length ? "success" : "warning",
                    message: `Installed ${data.name} v${data.version_number} — ${okCount}/${data.entries.length} files${
                        okCount === data.entries.length ? "" : ", some failed"
                    }. Reloading...`,
                });

                setTimeout(() => window.location.reload(), 1500);
            })
            .catch((error) =>
                addFlash({
                    key: "modpack",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            );
    };

    if (!enabled) {
        return (
            <div css={{ padding: "1rem", maxWidth: "900px", margin: "0 auto" }}>
                <div css={{ opacity: 0.7 }}>
                    The Modpack tab has been disabled by an administrator.
                </div>
            </div>
        );
    }

    return (
        <div css={{ padding: "1rem", maxWidth: "900px", margin: "0 auto" }}>
            <FlashMessageRender
                byKey="modpack"
                css={{ marginBottom: "1rem" }}
            />

            <SourceSelector
                provider={provider}
                sources={sources}
                onChange={changeProvider}
            />

            {installedModpack && (
                <>
                    <div
                        css={{
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            marginBottom: "0.5rem",
                        }}
                    >
                        Installed
                    </div>
                    <div css={{ marginBottom: "1.5rem" }}>
                        {!installedModpack.project_id ? (
                            <span>
                                No modpack installed. You can install one from
                                the search results below.
                            </span>
                        ) : (
                            <HitCard
                                hit={{
                                    project_id: installedModpack.project_id,
                                    slug: installedModpack.slug ?? "",
                                    title:
                                        installedModpack.title ??
                                        installedModpack.name,
                                    description:
                                        installedModpack.description ?? "",
                                    project_type:
                                        installedModpack.project_type ??
                                        "modpack",
                                    icon_url: installedModpack.icon_url ?? null,
                                    downloads: installedModpack.downloads ?? 0,
                                }}
                                provider={provider}
                                action={
                                    <div
                                        css={{
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "flex-end",
                                            gap: "0.35rem",
                                        }}
                                    >
                                        <div
                                            css={{
                                                fontSize: "0.75rem",
                                                opacity: 0.7,
                                            }}
                                        >
                                            v{installedModpack.version_number}
                                        </div>
                                        <div
                                            css={{
                                                display: "flex",
                                                gap: "0.5rem",
                                            }}
                                        >
                                            <Button
                                                isSecondary
                                                onClick={() =>
                                                    openVersionPicker({
                                                        project_id:
                                                            installedModpack.project_id as string,
                                                        slug:
                                                            installedModpack.slug ??
                                                            "",
                                                        title:
                                                            installedModpack.title ??
                                                            installedModpack.name,
                                                        description:
                                                            installedModpack.description ??
                                                            "",
                                                        project_type:
                                                            installedModpack.project_type ??
                                                            "modpack",
                                                        icon_url:
                                                            installedModpack.icon_url ??
                                                            null,
                                                        downloads:
                                                            installedModpack.downloads ??
                                                            0,
                                                    })
                                                }
                                            >
                                                Change version
                                            </Button>
                                            <Button
                                                color="red"
                                                onClick={() =>
                                                    setConfirmUninstallModpack(
                                                        true,
                                                    )
                                                }
                                                aria-label="Uninstall modpack"
                                            >
                                                <TrashIcon
                                                    css={{
                                                        width: "1rem",
                                                        height: "1rem",
                                                    }}
                                                />
                                            </Button>
                                        </div>
                                    </div>
                                }
                            />
                        )}
                    </div>
                </>
            )}

            <div
                css={{
                    display: "flex",
                    gap: "0.25rem",
                    marginBottom: "0.75rem",
                    flexWrap: "wrap",
                }}
            >
                <Select
                    css={{ width: "160px", flexShrink: 0 }}
                    value={gameVersion}
                    onChange={(e) => {
                        const next = e.currentTarget.value;
                        setGameVersion(next);
                        search(query, loader, next);
                    }}
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
                    onKeyDown={(e) =>
                        e.key === "Enter" && search(query, loader, gameVersion)
                    }
                    placeholder="Search modpacks..."
                />
                <Button
                    onClick={() => search(query, loader, gameVersion)}
                    disabled={searching}
                    aria-label="Search"
                >
                    <SearchIcon css={{ width: "1.1rem", height: "1.1rem" }} />
                </Button>
            </div>

            <div
                css={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.25rem 0.75rem",
                    marginBottom: "1.5rem",
                }}
            >
                {LOADERS.map((l) => (
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
                            checked={loader === l}
                            onChange={(e) => {
                                const next = e.currentTarget.checked ? l : "";
                                setLoader(next);
                                search(query, next, gameVersion);
                            }}
                        />
                        {l}
                    </label>
                ))}
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
            <div
                css={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                }}
            >
                {results.map((hit) => (
                    <HitCard
                        key={hit.project_id}
                        hit={hit}
                        provider={provider}
                        action={
                            <Button onClick={() => openVersionPicker(hit)}>
                                Install
                            </Button>
                        }
                    />
                ))}
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
                                <div css={{ fontWeight: 600 }}>
                                    {v.version_number}
                                </div>
                                <Button onClick={() => pickVersion(v)}>
                                    {installedModpack?.version_number ===
                                    v.version_number
                                        ? "Reinstall"
                                        : "Select"}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </Dialog>

            <Dialog
                open={!!confirmInstall}
                onClose={() => setConfirmInstall(null)}
                title="Install modpack?"
            >
                {confirmInstall && (
                    <>
                        This will write {confirmInstall.hit.title} v
                        {confirmInstall.version.version_number} to this server,
                        without deleting anything else. Continue?
                    </>
                )}
                <Dialog.Footer>
                    <Button isSecondary onClick={() => setConfirmInstall(null)}>
                        Cancel
                    </Button>
                    <Button onClick={runInstall}>Install</Button>
                </Dialog.Footer>
            </Dialog>

            <Dialog
                open={confirmUninstallModpack}
                onClose={() => setConfirmUninstallModpack(false)}
                title="Uninstall modpack?"
            >
                This will remove every file{" "}
                {installedModpack?.title ?? installedModpack?.name} added to
                this server (downloads and overrides). Files it didn't add are
                left alone.
                <Dialog.Footer>
                    <Button
                        isSecondary
                        onClick={() => setConfirmUninstallModpack(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        color="red"
                        onClick={uninstallModpack}
                        disabled={uninstallingModpack}
                        isLoading={uninstallingModpack}
                    >
                        Uninstall
                    </Button>
                </Dialog.Footer>
            </Dialog>

            <Dialog
                open={!!installToken || installRunning}
                onClose={() => installDone && closeInstallDialog()}
                title={`${installDone ? "Installed" : "Installing"} ${installName} v${installVersionNumber}`}
            >
                {installTotal > 0 && (
                    <div
                        css={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "0.75rem",
                            opacity: 0.7,
                            marginBottom: "0.5rem",
                        }}
                    >
                        <span>
                            {Math.min(installIndex + 1, installTotal)}/
                            {installTotal}
                        </span>
                        <span>
                            {Math.round(
                                (Math.min(installIndex + 1, installTotal) /
                                    installTotal) *
                                    100,
                            )}
                            %
                        </span>
                    </div>
                )}
                <div
                    css={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.35rem",
                    }}
                >
                    {entryRows
                        .slice(
                            Math.max(0, installIndex - INSTALL_ROW_WINDOW + 1),
                            installIndex + 1,
                        )
                        .map((row) => (
                            <div
                                key={row.path}
                                css={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    fontSize: "0.85rem",
                                    padding: "0.35rem 0.6rem",
                                    borderRadius: "0.25rem",
                                    backgroundColor:
                                        "rgba(255, 255, 255, 0.03)",
                                }}
                            >
                                <span>{row.path}</span>
                                <span>
                                    {row.status === "pending" && (
                                        <Spinner size={Spinner.Size.SMALL} />
                                    )}
                                    {row.status === "ok" && "✓"}
                                    {row.status === "error" && "✗"}
                                </span>
                            </div>
                        ))}
                </div>
                {installDone && (
                    <Dialog.Footer>
                        <Button onClick={closeInstallDialog}>Close</Button>
                    </Dialog.Footer>
                )}
            </Dialog>
        </div>
    );
};
