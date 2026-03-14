// Tailwind CSS configuration with white-label CSS variable mappings
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary:          "var(--color-primary)",
        secondary:        "var(--color-secondary)",
        background:       "var(--color-background)",
        surface:          "var(--color-surface)",
        "text-primary":   "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "alert-critical": "var(--color-alert-critical)",
        "alert-warning":  "var(--color-alert-warning)",
        "alert-info":     "var(--color-alert-info)",
      },
      textColor: {
        primary:          "var(--color-text-primary)",
        secondary:        "var(--color-text-secondary)",
        "alert-critical": "var(--color-alert-critical)",
        "alert-warning":  "var(--color-alert-warning)",
        "alert-info":     "var(--color-alert-info)",
      },
      backgroundColor: {
        primary:    "var(--color-primary)",
        surface:    "var(--color-surface)",
        background: "var(--color-background)",
      },
      fontFamily: {
        primary: "var(--font-primary)",
      },
    },
  },
  plugins: [],
};
