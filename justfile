# Run the complete pipeline (default target)
default:
    bun run main.js

# List all available recipes
help:
    @just --list

# Format all JavaScript and JSON files
format:
    bunx prettier --write *.js *.json

# Serve the html directory using serve from npm (via Bun)
serve:
    bunx serve -l 8000 html

# Download res.json + tmp/*.json from UCAM Cloud
ucam-fetch:
    bun scripts/cli.js fetch

# Select sections per scripts/config.json
ucam-select:
    bun scripts/cli.js select
