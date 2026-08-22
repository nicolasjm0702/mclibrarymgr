import React from "react";
import Button from "@/components/elements/Button";

const PAGE_SIZE = 15;

interface PaginationProps {
    page: number;
    totalHits: number;
    onChange: (page: number) => void;
    disabled?: boolean;
}

const Pagination = ({
    page,
    totalHits,
    onChange,
    disabled,
}: PaginationProps) => {
    const totalPages = Math.max(1, Math.ceil(totalHits / PAGE_SIZE));
    if (totalPages <= 1) return null;

    return (
        <div
            css={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.75rem",
                marginTop: "1rem",
            }}
        >
            <Button
                onClick={() => onChange(page - 1)}
                disabled={disabled || page <= 1}
            >
                Previous
            </Button>
            <span css={{ fontSize: "0.85rem", opacity: 0.7 }}>
                Page {page} of {totalPages}
            </span>
            <Button
                onClick={() => onChange(page + 1)}
                disabled={disabled || page >= totalPages}
            >
                Next
            </Button>
        </div>
    );
};

export default Pagination;
