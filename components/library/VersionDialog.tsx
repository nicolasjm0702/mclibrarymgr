import React from "react";
import Button from "@/components/elements/Button";
import Spinner from "@/components/elements/Spinner";
import { Dialog } from "@/components/elements/dialog";
import { Version } from "./types";

interface VersionDialogProps {
    open: boolean;
    title: string;
    versions: Version[];
    loading: boolean;
    installedVersionNumber?: string;
    onPick: (v: Version) => void;
    onClose: () => void;
    picking?: string | null;
}

export default function VersionDialog({
    open,
    title,
    versions,
    loading,
    installedVersionNumber,
    onPick,
    onClose,
    picking,
}: VersionDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} title={title}>
            {loading ? (
                <Spinner size={Spinner.Size.SMALL} centered />
            ) : versions.length === 0 ? (
                <div className="text-sm opacity-70">No versions found for this project.</div>
            ) : (
                <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
                    {versions.map((v) => (
                        <div
                            key={v.id}
                            className="flex justify-between items-center gap-2 p-2 px-3 rounded bg-white/[0.04]"
                        >
                            <div className="min-w-0">
                                <div className="font-semibold text-sm">{v.version_number}</div>
                                <div className="text-xs opacity-60 truncate">
                                    {v.loaders.join(", ")} &middot; {v.game_versions.slice(-3).join(", ")}
                                </div>
                            </div>
                            <Button
                                onClick={() => onPick(v)}
                                disabled={!!picking || installedVersionNumber === v.version_number}
                                isLoading={picking === v.id}
                            >
                                {installedVersionNumber === v.version_number ? "Installed" : "Install"}
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </Dialog>
    );
}
