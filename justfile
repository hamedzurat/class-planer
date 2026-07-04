# Run the complete pipeline (default target)
default:
    bun run main.js

# List all available recipes
help:
    @just --list

# Format all JavaScript, JSON, and Markdown (README) files
format:
    bunx prettier --write "**/*.js" "**/*.json" "**/*.md"


# Serve the html directory using serve from npm (via Bun)
serve:
    bunx serve -l 8000 html

# Download res.json + tmp/*.json from UCAM Cloud
ucam-fetch *flags:
    bun scripts/cli.js fetch {{flags}}

# Select sections per scripts/config.js
ucam-select *flags:
    bun scripts/cli.js select {{flags}}

# Fetch then select (full pipeline)
ucam-all *flags:
    bun scripts/cli.js all {{flags}}

# Pick one section — formal_code + letter (recommended); list UUID auto-converts
ucam-pick *flags:
    bun scripts/cli.js pick {{flags}}

# Pick when formal code contains spaces (just splits "CSE 4326:H" otherwise)
ucam-pick-section formal section *flags:
    bun scripts/cli.js pick --formal-code "{{formal}}" --section {{section}} {{flags}}

# UCAM CLI help (commands + pick usage)
ucam-help:
    bun scripts/cli.js help
