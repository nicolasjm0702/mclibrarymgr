export const formatDownloads = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
};

export const formatSize = (bytes: number) => {
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
};

/** strip the project-body markdown down to plain text */
export const stripMarkdown = (body: string) =>
    body
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // ![alt](url) images
        .replace(/\[<img[^>]*>\]\([^)]*\)/gi, "") // [<img ...>](url) badge links
        .replace(/<img[^>]*>/gi, "") // bare <img> tags
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
        .replace(/<\/?[a-z][^>]*>/gi, "") // remaining HTML tags
        .replace(/^>\s?/gm, "") // > blockquotes
        .replace(/^#{1,6}\s+/gm, "") // # headers
        .replace(/(\*\*|__)(.*?)\1/g, "$2") // **bold**/__bold__
        .replace(/(\*|_)(.*?)\1/g, "$2") // *italic*/_italic_
        .replace(/`([^`]*)`/g, "$1") // `code`
        .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs left by stripped images
        .trim();

export const timeAgo = (iso: string) => {
    const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.floor(minutes)} minute${Math.floor(minutes) === 1 ? "" : "s"} ago`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"} ago`;
    const days = hours / 24;
    return `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} ago`;
};
