// Shared motion presets — DESIGN.md §6. Only animate state changes.
export const spring = { type: "spring", stiffness: 400, damping: 35 } as const;
export const fade = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;
export const enterUp = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: fade } as const;
