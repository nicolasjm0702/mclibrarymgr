import React, { useEffect, useRef, useState } from "react";
import { ServerContext } from "@/state/server";
import Button from "@/components/elements/Button";
import Select from "@/components/elements/Select";
import Input from "@/components/elements/Input";
import Spinner from "@/components/elements/Spinner";
import { Dialog } from "@/components/elements/dialog";
import FlashMessageRender from "@/components/FlashMessageRender";
import { SearchIcon, TrashIcon, ClockIcon } from "@heroicons/react/solid";
import useFlash from "@/plugins/useFlash";
import http from "@/api/http";
import { Source } from "./SourceSelector";
import Pagination from "./Pagination";
import { Hit, Version, ProjectDetails } from "./library/types";
import { timeAgo } from "./library/format";
import useServerFilters from "./library/useServerFilters";
import BrowseCard from "./library/BrowseCard";
import VersionDialog from "./library/VersionDialog";
import DetailsDialog from "./library/DetailsDialog";

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
    likes?: number;
    installed_at?: string;
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

export default () => {
    const uuid = ServerContext.useStoreState(
        (state) => state.server.data!.uuid,
    );
    const { addFlash, clearFlashes } = useFlash();

    const { loaders, version: gameVersion, setLoaders, setVersion: setGameVersion, hasStored } = useServerFilters(uuid);
    const loader = loaders[0] ?? "";

    const [provider, setProvider] = useState("modrinth");
    const [sources, setSources] = useState<Source[]>([]);
    const [enabled, setEnabled] = useState(true);
    const searchSeqRef = useRef(0);
    const [installedModpack, setInstalledModpack] =
        useState<InstalledModpack | null>(null);
    const [query, setQuery] = useState("");
    const [gameVersions, setGameVersions] = useState<string[]>([]);
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<Hit[]>([]);
    const [totalHits, setTotalHits] = useState(0);
    const [page, setPage] = useState(1);

    const [detailsProjectId, setDetailsProjectId] = useState<string | null>(null);
    const [details, setDetails] = useState<ProjectDetails | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);

    const [pendingHit, setPendingHit] = useState<Hit | null>(null);
    const [pendingVersions, setPendingVersions] = useState<Version[]>([]);
    const [loadingPendingVersions, setLoadingPendingVersions] = useState(false);

    const [confirmInstall, setConfirmInstall] = useState<{
        hit: Hit;
        version: Version;
    } | null>(null);

    const [installToken, setInstallToken] = useState<string | null>(null);
    const [installName, setInstallName] = useState("");
    const [installVersionNumber, setInstallVersionNumber] = useState("");
    const [entryRows, setEntryRows] = useState<EntryRow[]>([]);
    const [installRunning, setInstallRunning] = useState(false);
    const [installBusy, setInstallBusy] = useState(false);
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

            if (hasStored()) return;

            detectFromInstalledFiles(uuid).then((detected) => {
                if (!detected.loader && !detected.version) return;

                const realVersion =
                    detected.version && validVersions.includes(detected.version)
                        ? detected.version
                        : null;

                if (detected.loader) setLoaders([detected.loader]);
                if (realVersion) setGameVersion(realVersion);
                search("", detected.loader ?? "", realVersion ?? "");
            });
        });

        refreshInstalled();
        search("", loader, gameVersion);
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

    const openVersionPicker = (hit: Hit) => {
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

    const openDetails = (projectId: string) => {
        setDetailsProjectId(projectId);
        setLoadingDetails(true);
        http.get(`/api/client/extensions/mclibrarymgr/servers/${uuid}/details`, {
            params: { project_id: projectId },
        })
            .then(({ data }) => setDetails(data))
            .catch((error) =>
                addFlash({
                    key: "modpack",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                }),
            )
            .finally(() => setLoadingDetails(false));
    };

    const matchesCurrentFilters = (v: Version) =>
        (!gameVersion || v.game_versions.includes(gameVersion)) &&
        (!loader || v.loaders.map((l) => l.toLowerCase()).includes(loader));

    const filteredPendingVersions = pendingVersions.filter(
        matchesCurrentFilters,
    );
    const showingAllVersions =
        pendingVersions.length > 0 && filteredPendingVersions.length === 0;

    const pickVersion = (v: Version) => {
        if (!pendingHit) return;
        setConfirmInstall({ hit: pendingHit, version: v });
        setPendingHit(null);
    };

    const runInstall = () => {
        if (!confirmInstall) return;
        const { hit, version } = confirmInstall;
        setConfirmInstall(null);
        clearFlashes("modpack");
        setInstallBusy(true);

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
                setInstallBusy(false);
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
            .catch((error) => {
                setInstallBusy(false);
                addFlash({
                    key: "modpack",
                    type: "error",
                    message: error?.response?.data?.message || error.message,
                });
            });
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

            {installedModpack && !installedModpack.project_id && (
                <div className="text-sm opacity-60 mb-6">
                    No modpack installed. You can install one from the search
                    results below.
                </div>
            )}

            {installedModpack?.project_id && (
                <>
                    <div className="text-xs uppercase tracking-wide opacity-60 mb-2">Most recently installed modpack</div>
                    <div className="mb-6">
                        <BrowseCard
                            hit={{
                                project_id: installedModpack.project_id,
                                slug: installedModpack.slug ?? "",
                                title: installedModpack.title ?? installedModpack.name,
                                description: installedModpack.description ?? "",
                                project_type: installedModpack.project_type ?? "modpack",
                                icon_url: installedModpack.icon_url ?? null,
                                downloads: installedModpack.downloads ?? 0,
                                likes: installedModpack.likes ?? 0,
                            }}
                            provider={provider}
                            showSourceLink
                            providerBadge={sources.find((s) => s.id === provider)?.label ?? provider}
                            onDetails={() => openDetails(installedModpack.project_id as string)}
                            metaRow={
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
                                    <span>
                                        {installedModpack.title ?? installedModpack.name} {installedModpack.version_number}
                                    </span>
                                    {installedModpack.installed_at && (
                                        <span className="flex items-center gap-1">
                                            <ClockIcon className="w-3.5 h-3.5" /> Installed {timeAgo(installedModpack.installed_at)}
                                        </span>
                                    )}
                                    {loaders[0] && <span>Loader: {loaders[0].toUpperCase()}</span>}
                                    {gameVersion && <span>Version: {gameVersion}</span>}
                                </div>
                            }
                            action={
                                <div className="flex items-center gap-2">
                                    <Button
                                        isSecondary
                                        onClick={() =>
                                            openVersionPicker({
                                                project_id: installedModpack.project_id as string,
                                                slug: installedModpack.slug ?? "",
                                                title: installedModpack.title ?? installedModpack.name,
                                                description: installedModpack.description ?? "",
                                                project_type: installedModpack.project_type ?? "modpack",
                                                icon_url: installedModpack.icon_url ?? null,
                                                downloads: installedModpack.downloads ?? 0,
                                                likes: installedModpack.likes ?? 0,
                                            })
                                        }
                                    >
                                        Change version
                                    </Button>
                                    <Button color="red" onClick={() => setConfirmUninstallModpack(true)} aria-label="Uninstall modpack" className="!px-2">
                                        <TrashIcon className="w-4 h-4" />
                                    </Button>
                                </div>
                            }
                        />
                    </div>
                </>
            )}

            <div className="flex flex-col gap-3 bg-white/[0.04] rounded-lg p-3 mb-4">
                <div>
                    <div className="text-[0.65rem] uppercase tracking-wide opacity-60 mb-1">
                        Loader
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {LOADERS.map((l) => (
                            <label key={l} className="flex items-center gap-1.5 text-sm">
                                <input
                                    type="checkbox"
                                    checked={loader === l}
                                    onChange={(e) => {
                                        const next = e.currentTarget.checked ? l : "";
                                        setLoaders(next ? [next] : []);
                                        search(query, next, gameVersion);
                                    }}
                                />
                                {l}
                            </label>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap gap-4">
                    <div>
                        <div className="text-[0.65rem] uppercase tracking-wide opacity-60 mb-1">
                            Version
                        </div>
                        <Select
                            css={{ width: "160px" }}
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
                    </div>
                </div>
            </div>

            <div className="text-sm font-semibold mb-2">Search</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {results.map((hit) => (
                    <BrowseCard
                        key={hit.project_id}
                        hit={hit}
                        provider={provider}
                        showSourceLink
                        onDetails={() => openDetails(hit.project_id)}
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

            <VersionDialog
                open={!!pendingHit}
                title={`Select a version${pendingHit ? ` — ${pendingHit.title}` : ""}`}
                versions={showingAllVersions ? pendingVersions : filteredPendingVersions}
                loading={loadingPendingVersions}
                installedVersionNumber={installedModpack?.version_number}
                onPick={pickVersion}
                onClose={() => setPendingHit(null)}
                picking={installBusy ? "installing" : null}
            />

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
