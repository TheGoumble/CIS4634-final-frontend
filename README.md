# React + Vite

# 1. Create and enter the Vite React project
npm create vite@latest secure-frontend --template react
cd secure-frontend
npm install

# 2. Install UI dependencies (required for the secure streaming interface)
npm install framer-motion lucide-react uuid

# 3. Install TailwindCSS (stable v3), PostCSS, Autoprefixer
npm install -D tailwindcss@3 postcss autoprefixer

# 4. Generate Tailwind + PostCSS config files
npx tailwindcss init -p
