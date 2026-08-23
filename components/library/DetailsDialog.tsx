import React from "react";
import Spinner from "@/components/elements/Spinner";
import { Dialog } from "@/components/elements/dialog";
import { ProjectDetails } from "./types";
import { formatDownloads, stripMarkdown } from "./format";
import { sourceProjectUrl } from "../SourceSelector";
import TagChips from "./TagChips";

interface DetailsDialogProps {
    open: boolean;
    details: ProjectDetails | null;
    loading: boolean;
    provider: string;
    onClose: () => void;
}

export default function DetailsDialog({ open, details, loading, provider, onClose }: DetailsDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} title={details?.title ?? "Details"}>
            {loading || !details ? (
                <Spinner size={Spinner.Size.SMALL} centered />
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        {details.icon_url && (
                            <img src={details.icon_url} alt={details.title} className="w-14 h-14 rounded-md flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                            <a
                                href={sourceProjectUrl(provider, details)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold hover:underline"
                            >
                                {details.title}
                            </a>
                            <div className="text-xs opacity-60">
                                {formatDownloads(details.downloads)} downloads &middot; {formatDownloads(details.likes)} likes
                                {details.author && <> &middot; by {details.author}</>}
                            </div>
                        </div>
                    </div>

                    <p className="text-sm opacity-80 whitespace-pre-wrap">
                        {stripMarkdown(details.body || details.description || "")}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        {details.categories.length > 0 && (
                            <div>
                                <div className="font-semibold mb-1">Categories</div>
                                <div className="flex flex-wrap gap-1">
                                    {details.categories.map((c) => (
                                        <span key={c} className="px-2 py-0.5 rounded-full bg-neutral-700/60 text-xs">
                                            {c}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {(details.loaders?.length || details.latest_version) && (
                            <div>
                                <div className="font-semibold mb-1">Loaders</div>
                                <TagChips hit={details} />
                            </div>
                        )}
                        {details.game_versions.length > 0 && (
                            <div>
                                <div className="font-semibold mb-1">Game versions</div>
                                <div className="flex flex-wrap gap-1">
                                    {details.game_versions.map((v) => (
                                        <span key={v} className="px-2 py-0.5 rounded-full bg-neutral-700/60 text-xs">
                                            {v}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div>
                            <div className="font-semibold mb-1">Details</div>
                            <div className="opacity-70 text-xs">
                                {details.updated && <div>Updated {new Date(details.updated).toLocaleDateString()}</div>}
                                {details.published && <div>Published {new Date(details.published).toLocaleDateString()}</div>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </Dialog>
    );
}
