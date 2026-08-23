import React from "react";
import Button from "@/components/elements/Button";
import { TrashIcon } from "@heroicons/react/solid";
import { Hit } from "./types";
import { sourceProjectUrl } from "../SourceSelector";

interface ManageRowProps {
    hit: Hit | null | undefined;
    filename: string;
    sizeLabel?: string;
    hasUpdate?: boolean;
    latestVersion?: string | null;
    onUpdate: () => void;
    onUninstall: () => void;
    updating?: boolean;
    uninstalling?: boolean;
    provider?: string;
}

export default function ManageRow({
    hit,
    filename,
    sizeLabel,
    hasUpdate,
    latestVersion,
    onUpdate,
    onUninstall,
    updating,
    uninstalling,
    provider,
}: ManageRowProps) {
    const title = hit?.title ?? filename;
    const description = hit === undefined ? "Looking up details…" : hit === null ? "Not found on this source." : undefined;

    return (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.04]">
            {hit?.icon_url ? (
                <img src={hit.icon_url} alt={title} className="w-10 h-10 rounded-md flex-shrink-0" />
            ) : (
                <div className="w-10 h-10 rounded-md flex-shrink-0 bg-white/10" />
            )}

            <div className="min-w-0 flex-1">
                {hit && provider ? (
                    <a
                        href={sourceProjectUrl(provider, hit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-sm block truncate hover:underline"
                    >
                        {title}
                    </a>
                ) : (
                    <div className="font-semibold text-sm truncate">{title}</div>
                )}
                <div className="text-xs opacity-60 truncate">
                    {description ?? (sizeLabel ? `${sizeLabel} · ${filename}` : filename)}
                    {hasUpdate && latestVersion && (
                        <span className="ml-2 text-yellow-400 font-semibold">Update to {latestVersion}</span>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
                {hit !== null && (
                    <Button
                        isSecondary
                        onClick={onUpdate}
                        disabled={updating}
                        isLoading={updating}
                        aria-label={hasUpdate ? "Update" : "Change version"}
                    >
                        {hasUpdate ? "Update" : "Change version"}
                    </Button>
                )}
                <Button
                    color="red"
                    onClick={onUninstall}
                    disabled={uninstalling}
                    isLoading={uninstalling}
                    aria-label="Uninstall"
                    className="!px-2"
                >
                    <TrashIcon className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}
