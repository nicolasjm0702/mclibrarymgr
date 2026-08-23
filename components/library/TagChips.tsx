import React from "react";
import { DotsHorizontalIcon } from "@heroicons/react/solid";
import { Hit } from "./types";

const MAX_VISIBLE_LOADERS = 3;

const LOADER_LABELS: Record<string, string> = {
    fabric: "Fabric",
    forge: "Forge",
    neoforge: "NeoForge",
    quilt: "Quilt",
    paper: "Paper",
    spigot: "Spigot",
    purpur: "Purpur",
    bukkit: "Bukkit",
    folia: "Folia",
    velocity: "Velocity",
    waterfall: "Waterfall",
    bungeecord: "BungeeCord",
};

const Chip = ({ children }: { children: React.ReactNode }) => (
    <span className="px-2 py-0.5 rounded-full bg-neutral-700/60 text-neutral-200 text-[0.65rem] font-semibold whitespace-nowrap">
        {children}
    </span>
);

export default function TagChips({ hit }: { hit: Hit }) {
    if (hit.loaders && hit.loaders.length > 0) {
        const visible = hit.loaders.slice(0, MAX_VISIBLE_LOADERS);
        const overflow = hit.loaders.slice(MAX_VISIBLE_LOADERS);
        return (
            <div className="flex items-center gap-1 overflow-hidden" title={hit.loaders.map((l) => LOADER_LABELS[l] ?? l).join(", ")}>
                {visible.map((l) => (
                    <Chip key={l}>{LOADER_LABELS[l] ?? l}</Chip>
                ))}
                {overflow.length > 0 && (
                    <span
                        title={overflow.map((l) => LOADER_LABELS[l] ?? l).join(", ")}
                        className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-neutral-700/60 text-neutral-200"
                    >
                        <DotsHorizontalIcon className="w-3 h-3" />
                    </span>
                )}
            </div>
        );
    }

    if (hit.latest_version) {
        return (
            <div className="flex flex-wrap gap-1">
                <Chip>v{hit.latest_version}</Chip>
            </div>
        );
    }

    return null;
}
