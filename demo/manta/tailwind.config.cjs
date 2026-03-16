const path = require("path")

const medusaUI = path.join(
  path.dirname(require.resolve("@medusajs/ui")),
  "**/*.{js,jsx,ts,tsx}"
)

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@medusajs/ui-preset")],
  content: [
    "./src/admin/**/*.{js,ts,jsx,tsx}",
    "../../packages/dashboard-core/src/**/*.{js,ts,jsx,tsx}",
    "../../packages/dashboard/src/**/*.{js,ts,jsx,tsx}",
    medusaUI,
  ],
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
}
