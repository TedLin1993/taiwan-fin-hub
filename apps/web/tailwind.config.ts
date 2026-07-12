import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1200px",
      "2xl": "1536px"
    },
    extend: {
      colors: {
        ink: "#1f2933",
        paper: "#f7f7f2",
        moss: "#556b2f",
        coral: "#b75b45",
        steel: "#3e6f7c",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))"
      }
    }
  },
  plugins: []
} satisfies Config;
