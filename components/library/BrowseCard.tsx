import React from "react";
import { DownloadIcon, HeartIcon, UserIcon, InformationCircleIcon, DesktopComputerIcon, BanIcon } from "@heroicons/react/solid";
import Button from "@/components/elements/Button";
import { Hit } from "./types";
import { formatDownloads } from "./format";
import { sourceProjectUrl } from "../SourceSelector";
import TagChips from "./TagChips";

interface BrowseCardProps {
    hit: Hit;
    provider: string;
    action: React.ReactNode;
    onDetails: () => void;
    showSourceLink?: boolean;
    providerBadge?: string;
    metaRow?: React.ReactNode;
}

export default function BrowseCard({
    hit,
    provider,
    action,
    onDetails,
    showSourceLink,
    providerBadge,
    metaRow,
}: BrowseCardProps) {
    return (
        <div className="relative flex flex-col gap-2 p-3 rounded-lg bg-white/[0.04] h-full">
            {(hit.client_only || hit.no_direct_download) && (
                <div className="absolute top-2 right-2 flex items-center gap-1">
                    {hit.client_only && (
                        <div
                            className="w-6 h-6 flex items-center justify-center rounded-full bg-neutral-900/80"
                            title="Client-side mod — may not affect the server"
                        >
                            <DesktopComputerIcon className="w-3.5 h-3.5 text-yellow-400" />
                        </div>
                    )}
                    {hit.no_direct_download && (
                        <div
                            className="w-6 h-6 flex items-center justify-center rounded-full bg-neutral-900/80"
                            title="Author disabled third-party downloads — cannot be installed directly"
                        >
                            <BanIcon className="w-3.5 h-3.5 text-red-400" />
                        </div>
                    )}
                </div>
            )}
            <div className="flex items-center gap-3">
                {hit.icon_url ? (
                    <img src={hit.icon_url} alt={hit.title} className="w-10 h-10 rounded-md flex-shrink-0" />
                ) : (
                    <div className="w-10 h-10 rounded-md flex-shrink-0 bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <a
                            href={sourceProjectUrl(provider, hit)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-sm truncate hover:underline"
                        >
                            {hit.title}
                        </a>
                        {providerBadge && (
                            <span className="px-2 py-0.5 rounded-full bg-neutral-700/60 text-[0.65rem] font-semibold flex-shrink-0">
                                {providerBadge}
                            </span>
                        )}
                    </div>
                    {hit.author && (
                        <div className="text-xs opacity-60 flex items-center gap-1 truncate">
                            <UserIcon className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{hit.author}</span>
                        </div>
                    )}
                </div>
            </div>

            <p
                className="text-xs opacity-70 flex-1"
                title={hit.description}
                css={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                {hit.description}
            </p>

            <div className="flex items-center gap-3 text-xs opacity-60">
                <span className="flex items-center gap-1">
                    <DownloadIcon className="w-3.5 h-3.5" /> {formatDownloads(hit.downloads)}
                </span>
                <span className="flex items-center gap-1">
                    <HeartIcon className="w-3.5 h-3.5" /> {formatDownloads(hit.likes)}
                </span>
            </div>

            {metaRow && <div className="pt-2 border-t border-white/10">{metaRow}</div>}

            <div className="flex items-center gap-2">
                {!showSourceLink && (
                    <div className="flex-shrink-0 flex-1 min-w-0">
                        <TagChips hit={hit} />
                    </div>
                )}
                <Button isSecondary onClick={onDetails} aria-label="Details" title="Details" className="flex-shrink-0 !px-2">
                    <InformationCircleIcon className="w-4 h-4" />
                </Button>
                <div className={`flex-shrink-0 flex items-center gap-2 ${showSourceLink ? "ml-auto" : ""}`}>{action}</div>
            </div>
        </div>
    );
}
