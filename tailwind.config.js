/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",
    "./public/**/*.js"
  ],
  corePlugins: { preflight: true },
  theme: {
    container: { center: true, padding: { DEFAULT: "1rem", md: "2rem" } },
    screens: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px" },
    extend: {
      colors: {
        primary: {
          50:"#FCE7F3",100:"#FBCFE8",200:"#F9A8D4",300:"#F472B6",400:"#EC4899",
          500:"#DC006B",600:"#BE185D",700:"#9D174D",800:"#831843",900:"#6B1437"
        },
        secondary: {100:"#F3EDEB",200:"#D6C5BF",400:"#A78579",500:"#6C4A3E",600:"#54362C",700:"#3F2620",900:"#2E0200"},
        gray: {50:"#F9FAFB",100:"#F3F4F6",200:"#E5E7EB",300:"#D1D5DB",400:"#9CA3AF",500:"#6B7280",600:"#4B5563",700:"#374151",800:"#1F2937",900:"#111827"},
        success: { 500: "#22C55E" }, warning: { 500: "#EAB308" }, error: { 500: "#EF4444" }
      },
      borderRadius: { sm:"4px", md:"8px", lg:"18px" },
      boxShadow: {
        sm:"0 1px 2px rgba(0,0,0,.05)",
        md:"0 4px 6px rgba(0,0,0,.10)",
        lg:"0 10px 15px rgba(0,0,0,.15)"
      },
      value: { selfdev: "#8A2BE2", basics: "#10B981", attraction: "#F59E0B", vitality: "#06B6D4" }
    }
  },
  plugins: []
};

