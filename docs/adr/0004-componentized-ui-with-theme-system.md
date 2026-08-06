# Componentized UI with a theme system; glassmorphism optional

The frontend is built from small reusable components (React + TypeScript + Vite + Tailwind + shadcn/ui + Framer Motion + Zustand) so the UI can be restyled without touching feature logic. A theme layer provides light/dark mode, accent color, radius/glass intensity, and custom CSS injection. Glassmorphism is treated as an optional skin, not a core requirement, so it can be dialed back for performance or readability. The gallery is wrapped in an extensible component so the underlying masonry/lightbox library can be swapped later.
