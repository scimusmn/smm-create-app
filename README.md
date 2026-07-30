# smm-create-app

Command-line tool for creating new SMM exhibit and experience applications. Each generated application shares a consistent foundation, making projects easier to build and maintain. 

Generated starter applications use Next.js, TypeScript, and Tailwind, with built-in preview deployments to Cloudflare.

## Starting a new project

```bash
nvm use                             # first time
yarn install                        # first time
yarn new ../projects/your-new-app   # path to new project
```

## Project structure

```
packages/cli/    the generator: prompts, C3 scaffolding, overlay engine
base/            applied to every project (e.g., home page, PR template, any scripts we want on every project)
features/        opt-in modules: serial, sheets-cms, kiosk scripts
products/        fully productized applications including any dependencies (e.g. video-selector, flipbook)             
```

## Technical approach
The CLI delegates scaffolding to Cloudflare's C3 (`npm create
cloudflare@latest`) live at creation time. That means new projects always get the latest OpenNext template. 
Everything is added on top via an "overlay" approach, which copies files from this repository into the generated project. 
