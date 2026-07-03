# Run the complete pipeline (default target)
default:
    bun run main.js

# List all available recipes
help:
    @just --list

# Format all JavaScript and JSON files
format:
    bunx prettier --write *.js package.json
