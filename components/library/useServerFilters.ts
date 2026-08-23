import { useEffect, useState } from "react";

interface StoredFilters {
    loaders: string[];
    version: string;
}

const keyFor = (uuid: string) => `mclibrarymgr:filters:${uuid}`;

const readStored = (uuid: string): StoredFilters => {
    try {
        const raw = localStorage.getItem(keyFor(uuid));
        if (!raw) return { loaders: [], version: "" };
        const parsed = JSON.parse(raw);
        return {
            loaders: Array.isArray(parsed.loaders) ? parsed.loaders : [],
            version: typeof parsed.version === "string" ? parsed.version : "",
        };
    } catch {
        return { loaders: [], version: "" };
    }
};

const writeStored = (uuid: string, value: StoredFilters) => {
    try {
        localStorage.setItem(keyFor(uuid), JSON.stringify(value));
    } catch {
        // Private browsing / storage full — filters just won't persist.
    }
};

export default function useServerFilters(uuid: string) {
    const [loaders, setLoadersState] = useState<string[]>(() => readStored(uuid).loaders);
    const [version, setVersionState] = useState<string>(() => readStored(uuid).version);

    useEffect(() => {
        const stored = readStored(uuid);
        setLoadersState(stored.loaders);
        setVersionState(stored.version);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid]);

    const setLoaders = (next: string[]) => {
        setLoadersState(next);
        writeStored(uuid, { ...readStored(uuid), loaders: next });
    };

    const setVersion = (next: string) => {
        setVersionState(next);
        writeStored(uuid, { ...readStored(uuid), version: next });
    };

    return { loaders, version, setLoaders, setVersion, hasStored: () => readStored(uuid).loaders.length > 0 || readStored(uuid).version !== "" };
}
