# SMM standard PR template (from smm-create-app).
This still needs to be finished. It should remain lightweight, but specific enough to be useful as a baseline checklist.

## What & why

<!-- One or two sentences. Link the ticket/issue. -->

## How to test

<!-- Exact steps a reviewer can follow locally. Include hardware setup if serial is involved. -->

## Screenshots / video

<!-- Required for any visual change. -->

## Checklist

- [ ] Runs locally (`yarn dev`) with no console errors
- [ ] Builds for Workers (`yarn preview`) if deploy-affecting
- [ ] Content pulled/committed if this depends on CMS changes (`yarn pull-content`)
- [ ] No large media committed (use `yarn sync-media`)
