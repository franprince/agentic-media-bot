export function getAllowedUserIdSet(): Set<number> {
    const raw = process.env.ALLOWED_USER_IDS?.split(",") || [];
    return new Set(
        raw
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isFinite(value))
    );
}

export function isUserAllowed(userId: number | undefined): boolean {
    if (typeof userId !== "number") return false;
    const allowed = getAllowedUserIdSet();
    if (allowed.size === 0) return true;
    return allowed.has(userId);
}
