# Smart PC File Manager (AI-Powered)

A lightweight Windows desktop application built with **Electron**, **Node.js**, and the **Google Gemini API (`@google/genai`)** to organize messy folders, clean system junk, and execute plain-English file management commands.

## Features
- **Natural-Language Command Parser:** Type requests like *"Move all PDFs from Downloads to Documents"* or *"Sort my desktop and clean temp junk"* powered by Gemini.
- **Smart Category Sorting:** Automatically organizes loose files into `Images`, `Documents`, `Videos`, `Audio`, `Archives`, `Installers`, `AndroidApps`, and `Code`.
- **Deep System Cleaner:** Sweeps Windows `%TEMP%` files, deletes empty folders, and sends duplicate files safely to the Recycle Bin.
- **Safety Guardrails:** Includes **Dry Run Mode** to preview changes before execution and a one-click **Undo Move** button.

## Run Locally
```bash
npm install
npm start
